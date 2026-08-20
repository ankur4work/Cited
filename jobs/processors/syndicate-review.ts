import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import {
  upsertReviewMetaobject,
  deleteReviewMetaobject,
  MetaobjectError,
} from '@/lib/shopify/metaobjects';
import { reviewMetaobjectInput, shouldHaveMetaobject } from '@/lib/reviews/projection';
import type { SyndicationJobData, SyndicationJobName } from '../queue';

/**
 * Project one review into its Shopify `product_review` metaobject.
 *
 * Postgres is the source of truth; this makes Shopify eventually consistent
 * behind it. The projection is what the server-rendered theme block reads,
 * so a review that fails to syndicate is invisible on the storefront even
 * though it exists in our database — which makes syncStatus a user-visible
 * state, not an internal detail.
 */

export async function syndicateReviewProcessor(
  job: Job<SyndicationJobData, unknown, SyndicationJobName>,
): Promise<void> {
  const { storeId, reviewId } = job.data;
  if (!reviewId) throw new Error('syndicate:review requires reviewId');

  const review = await prisma.review.findFirst({
    where: { id: reviewId, storeId },
    include: {
      product: { select: { shopifyGid: true } },
      media: {
        where: { moderation: 'APPROVED' },
        orderBy: { position: 'asc' },
        select: { r2Key: true, url: true, type: true },
      },
      store: {
        select: {
          id: true,
          shopDomain: true,
          accessToken: true,
          uninstalledAt: true,
          reviewScopeGranted: true,
        },
      },
    },
  });

  if (!review) {
    logger.warn({ storeId, reviewId }, 'Syndication skipped — review not found');
    return;
  }

  const store = review.store;
  if (store.uninstalledAt) {
    logger.warn({ storeId, reviewId }, 'Syndication skipped — store uninstalled');
    return;
  }

  // The restricted scope is not granted yet. Mark SKIPPED and return cleanly
  // rather than throwing: retrying cannot help, and burning six attempts per
  // review against a permission error would flood the DLQ on every store
  // until Shopify approves the app. See PLAN.md §5.2.1.
  if (!store.reviewScopeGranted) {
    await prisma.review.update({
      where: { id: review.id },
      data: { syncStatus: 'SKIPPED', syncError: 'write_product_reviews not yet granted' },
    });
    logger.debug({ storeId, reviewId }, 'Syndication skipped — review scope not granted');
    return;
  }

  const client = new ShopifyClient(store);

  try {
    // A review that is no longer publishable should not linger on the
    // storefront. See shouldHaveMetaobject for why PENDING and HIDDEN keep
    // a DRAFT metaobject instead of being deleted.
    if (!shouldHaveMetaobject(review.status)) {
      if (review.metaobjectGid) {
        await deleteReviewMetaobject(client, review.metaobjectGid);
      }
      await prisma.review.update({
        where: { id: review.id },
        data: { metaobjectGid: null, syncStatus: 'SYNCED', syncedAt: new Date(), syncError: null },
      });
      logger.info({ storeId, reviewId, status: review.status }, 'Review metaobject removed');
      return;
    }

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

    logger.info({ storeId, reviewId, metaobjectGid }, 'Review syndicated');
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const terminal = err instanceof MetaobjectError && err.terminal;

    await prisma.review.update({
      where: { id: review.id },
      data: {
        syncStatus: 'FAILED',
        syncError: message,
        syncAttempts: { increment: 1 },
      },
    });

    if (terminal) {
      // Do not rethrow: BullMQ would retry a request that can never succeed.
      // The FAILED row is the durable record, and it surfaces in the admin.
      logger.error({ storeId, reviewId, err: message }, 'Review syndication failed permanently');
      return;
    }
    throw err;
  }
}

