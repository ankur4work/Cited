import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import { upsertReviewMetaobject, MetaobjectError } from '@/lib/shopify/metaobjects';
import {
  reviewMetaobjectInput,
  shouldHaveMetaobject,
  REVIEW_PROJECTION_SELECT,
  type ProjectableReview,
} from '@/lib/reviews/projection';
import { enqueueSyndicationBackfill, enqueueAggregateSync } from '../enqueue';
import type { SyndicationJobData, SyndicationJobName } from '../queue';

/**
 * Project an entire store's backlog of reviews into Shopify metaobjects.
 *
 * Run once per store when the restricted scope is first granted: every review
 * collected while approval was pending sits at `SKIPPED`, which means it
 * exists in our database but not on the storefront. Syndicating all of them
 * is the obligation the scope was granted for.
 *
 * Two properties matter more than speed here, because a large store can hold
 * six figures of reviews:
 *
 *   * **Resumable.** Each chunk re-enqueues the next with a cursor instead of
 *     looping inside one job. A deploy or crash mid-backfill costs one chunk,
 *     not the whole store, and a job that ran for hours would be killed by the
 *     worker's shutdown drain anyway.
 *   * **Rate-limited.** Reviews are projected one at a time, so ShopifyClient's
 *     own throttle-aware pacing applies to each call, and a delay between
 *     chunks keeps one big store from starving every other tenant's
 *     syndication for the duration.
 */

/**
 * Reviews per chunk. Small enough that a lost chunk is cheap and the job
 * finishes well inside the worker's shutdown drain; large enough that the
 * per-chunk queue overhead stays negligible.
 */
const CHUNK_SIZE = 50;

/** Pause between chunks — leaves Admin API headroom for live syndication. */
const CHUNK_DELAY_MS = 2_000;

type BackfillReview = ProjectableReview & { productId: string };

export async function syndicateBackfillProcessor(
  job: Job<SyndicationJobData, unknown, SyndicationJobName>,
): Promise<void> {
  const { storeId, cursor } = job.data;
  const processedSoFar = job.data.processed ?? 0;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      shopDomain: true,
      accessToken: true,
      uninstalledAt: true,
      reviewScopeGranted: true,
    },
  });

  if (!store || store.uninstalledAt) {
    logger.info({ storeId }, 'Backfill stopped — store uninstalled');
    return;
  }

  // Stop the chain rather than scheduling chunks that would all skip. The
  // backfill is re-triggered when the scope is granted, so nothing is lost.
  if (!store.reviewScopeGranted) {
    logger.warn({ storeId }, 'Backfill stopped — write_product_reviews not granted');
    return;
  }

  const reviews = (await prisma.review.findMany({
    where: {
      storeId,
      // DELETED and SPAM should not exist as metaobjects at all, so they are
      // not backlog — syndicate:review handles their removal on transition.
      status: { notIn: ['DELETED', 'SPAM'] },
      syncStatus: { not: 'SYNCED' },
      ...(cursor ? { id: { gt: cursor } } : {}),
    },
    orderBy: { id: 'asc' },
    take: CHUNK_SIZE,
    select: {
      ...REVIEW_PROJECTION_SELECT,
      productId: true,
      product: { select: { shopifyGid: true } },
      media: {
        where: { moderation: 'APPROVED' as const },
        orderBy: { position: 'asc' as const },
        select: { r2Key: true, url: true },
      },
    },
  })) as BackfillReview[];

  if (reviews.length === 0) {
    logger.info({ storeId, processed: processedSoFar }, 'Backfill complete');
    return;
  }

  const client = new ShopifyClient(store);
  const touchedProductIds = new Set<string>();
  let synced = 0;
  let failed = 0;

  for (const review of reviews) {
    // Defensive: the status filter above should already exclude these.
    if (!shouldHaveMetaobject(review.status)) continue;

    try {
      const { metaobjectGid } = await upsertReviewMetaobject(
        client,
        reviewMetaobjectInput(review),
      );

      await prisma.review.update({
        where: { id: review.id },
        data: {
          metaobjectGid,
          syncStatus: 'SYNCED',
          syncedAt: new Date(),
          syncError: null,
          syncAttempts: { increment: 1 },
        },
      });

      touchedProductIds.add(review.productId);
      synced += 1;
    } catch (err) {
      const terminal = err instanceof MetaobjectError && err.terminal;
      if (!terminal) {
        // Transient — a 429, a 5xx, an expired token. Rethrow so BullMQ
        // retries this chunk. The cursor has not advanced and every write is
        // an idempotent upsert keyed on the review's handle, so the retry
        // redoes work but cannot duplicate anything.
        throw err;
      }

      // Permanent for this one review. Record it and keep going: one bad row
      // must not strand the rest of the store's backlog behind it.
      await prisma.review.update({
        where: { id: review.id },
        data: {
          syncStatus: 'FAILED',
          syncError: (err as Error).message.slice(0, 500),
          syncAttempts: { increment: 1 },
        },
      });
      failed += 1;
      logger.error(
        { storeId, reviewId: review.id, err: (err as Error).message },
        'Backfill: review failed permanently — continuing',
      );
    }
  }

  // Debounced per product, so a chunk touching one product 50 times produces
  // one aggregate write rather than 50.
  for (const productId of touchedProductIds) {
    await enqueueAggregateSync({ storeId, productId });
  }

  const nextCursor = reviews[reviews.length - 1]!.id;
  const processed = processedSoFar + reviews.length;

  logger.info(
    { storeId, chunk: reviews.length, synced, failed, processed },
    'Backfill chunk complete',
  );

  await enqueueSyndicationBackfill({
    storeId,
    cursor: nextCursor,
    processed,
    delayMs: CHUNK_DELAY_MS,
  });
}
