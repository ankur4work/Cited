import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import {
  fetchReviewMetaobject,
  buildReviewFields,
  MetaobjectError,
} from '@/lib/shopify/metaobjects';
import { driftedFieldKeys, reviewIdFromHandle } from '@/lib/shopify/metaobject-payload';
import {
  reviewMetaobjectInput,
  shouldHaveMetaobject,
  expectedPublishableStatus,
  REVIEW_PROJECTION_SELECT,
  type ProjectableReview,
} from '@/lib/reviews/projection';
import { enqueueReviewSyndication, enqueueAggregateSync } from '../enqueue';
import type { SyndicationJobData, SyndicationJobName } from '../queue';

/**
 * Reconcile one `product_review` metaobject against our copy of the review.
 *
 * Policy, stated once here because everything below follows from it:
 * **Postgres is the source of truth and Shopify is a projection of it.** That
 * is the model the whole schema is built on, so when the two disagree the
 * repair is always "rewrite Shopify from Postgres", never "import Shopify
 * into Postgres". The webhook's job is to notice the disagreement.
 *
 * Our own writes also produce webhooks, so the common case by far is an echo
 * of something we just did. That path must cost nothing and must not write
 * anything, or the app rewrites the metaobject, receives a webhook about its
 * own rewrite, and loops forever. Comparison is against the exact serializer
 * used to write (`buildReviewFields`) precisely so an echo compares equal.
 */
export async function reconcileMetaobjectProcessor(
  job: Job<SyndicationJobData, unknown, SyndicationJobName>,
): Promise<void> {
  const { storeId, metaobjectGid, metaobjectHandle, metaobjectFields, webhookTopic, webhookEventId } =
    job.data;

  if (!metaobjectGid) throw new Error('reconcile:metaobject requires metaobjectGid');

  try {
    await reconcile({ storeId, metaobjectGid, metaobjectHandle, metaobjectFields, webhookTopic });
    if (webhookEventId) {
      await prisma.webhookEvent
        .update({ where: { id: webhookEventId }, data: { processedAt: new Date() } })
        .catch(() => undefined);
    }
  } catch (err) {
    // Record the failure but keep processedAt null: BullMQ still has retries
    // to spend, and a row that reads "processed" after a failure would hide a
    // stale metaobject from anyone auditing the feed.
    if (webhookEventId) {
      await prisma.webhookEvent
        .update({
          where: { id: webhookEventId },
          data: {
            failedAt: new Date(),
            attempts: { increment: 1 },
            error: (err as Error).message.slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
    throw err;
  }
}

async function reconcile(input: {
  storeId: string;
  metaobjectGid: string;
  metaobjectHandle?: string;
  metaobjectFields?: Record<string, string>;
  webhookTopic?: string;
}): Promise<void> {
  const { storeId, metaobjectGid, metaobjectHandle, metaobjectFields, webhookTopic } = input;
  const isDelete = webhookTopic === 'metaobjects/delete';

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
    logger.info({ storeId, metaobjectGid }, 'Reconcile skipped — store uninstalled');
    return;
  }

  const review = await findOwnedReview({ storeId, metaobjectGid, metaobjectHandle });

  if (!review) {
    // Not ours. A merchant-authored review, or one written by another
    // approved review app on the same shop. Deliberately NOT imported: our
    // rating aggregates are computed from our own reviews and pushed to the
    // shop-wide `reviews.rating` metafields, so ingesting a foreign
    // metaobject would double-count it against a total we also write.
    logger.debug(
      { storeId, metaobjectGid, topic: webhookTopic },
      'Metaobject is not ours — no reconciliation',
    );
    return;
  }

  if (isDelete) {
    await reconcileDeletion({ storeId, review });
    return;
  }

  // Without the restricted scope we cannot read or repair the metaobject, and
  // every attempt would fail identically. Returning cleanly beats burning six
  // attempts per webhook into the DLQ.
  if (!store.reviewScopeGranted) {
    logger.debug(
      { storeId, reviewId: review.id },
      'Reconcile skipped — write_product_reviews not granted',
    );
    return;
  }

  await reconcileUpsert({ store, review, metaobjectGid, metaobjectFields });
}

type OwnedReview = ProjectableReview & {
  metaobjectGid: string | null;
  /** Local Product.id — what the aggregate queue keys on, NOT the Shopify GID. */
  productId: string;
};

/**
 * Find the review this metaobject belongs to.
 *
 * Two lookups, because the GID alone is not enough. We learn a metaobject's
 * GID only after our upsert returns, and Shopify's create webhook can arrive
 * before that write lands — so a create for a review we genuinely own would
 * look foreign. The handle is ours by construction (`cited-<reviewId>`), so
 * it identifies the review even when the GID isn't on file yet.
 */
async function findOwnedReview(input: {
  storeId: string;
  metaobjectGid: string;
  metaobjectHandle?: string;
}): Promise<OwnedReview | null> {
  const select = {
    ...REVIEW_PROJECTION_SELECT,
    metaobjectGid: true,
    productId: true,
    product: { select: { shopifyGid: true } },
    media: {
      where: { moderation: 'APPROVED' as const },
      orderBy: { position: 'asc' as const },
      select: { r2Key: true, url: true },
    },
  };

  const byGid = await prisma.review.findFirst({
    where: { storeId: input.storeId, metaobjectGid: input.metaobjectGid },
    select,
  });
  if (byGid) return byGid;

  const reviewId = input.metaobjectHandle ? reviewIdFromHandle(input.metaobjectHandle) : null;
  if (!reviewId) return null;

  return prisma.review.findFirst({
    where: { id: reviewId, storeId: input.storeId },
    select,
  });
}

/**
 * Our metaobject was deleted outside the app.
 *
 * The stored GID is now dangling either way, so it is always cleared. Whether
 * we put the review back depends on whether it should be on the storefront:
 * if it should, this is drift and we restore it, because syndicating every
 * valid review is the obligation the restricted scope was granted for. If it
 * shouldn't, the deletion agrees with us and the projection is simply
 * complete.
 */
async function reconcileDeletion(input: { storeId: string; review: OwnedReview }): Promise<void> {
  const { storeId, review } = input;
  const shouldExist = shouldHaveMetaobject(review.status);

  await prisma.review.update({
    where: { id: review.id },
    data: {
      metaobjectGid: null,
      syncStatus: shouldExist ? 'PENDING' : 'SYNCED',
      syncedAt: shouldExist ? null : new Date(),
      syncError: null,
    },
  });

  if (!shouldExist) {
    logger.info(
      { storeId, reviewId: review.id, status: review.status },
      'Metaobject deleted externally — matches review state, nothing to restore',
    );
    return;
  }

  await enqueueReviewSyndication({
    storeId,
    reviewId: review.id,
    repairKey: `deleted-${review.id}`,
  });

  logger.warn(
    { storeId, reviewId: review.id, status: review.status },
    'Metaobject for a live review deleted externally — restoring',
  );
}

/**
 * Compare Shopify's stored metaobject against what we would write.
 *
 * Uses the field values carried on the webhook when they are present, and
 * falls back to reading the metaobject when they are not — one Admin API call
 * per delivery is affordable as an exception but not as the rule, given every
 * write we make generates a webhook back to here.
 */
async function reconcileUpsert(input: {
  store: { id: string; shopDomain: string; accessToken: string | null };
  review: OwnedReview;
  metaobjectGid: string;
  metaobjectFields?: Record<string, string>;
}): Promise<void> {
  const { store, review, metaobjectGid } = input;
  const storeId = store.id;

  // Heal the create-webhook race described in findOwnedReview: we matched by
  // handle, so this metaobject is ours even though the GID wasn't recorded.
  if (review.metaobjectGid !== metaobjectGid) {
    await prisma.review.update({
      where: { id: review.id },
      data: { metaobjectGid },
    });
    logger.info({ storeId, reviewId: review.id, metaobjectGid }, 'Recorded metaobject GID');
  }

  // The review shouldn't have a metaobject at all — it was deleted or marked
  // spam here, and something recreated it. Let the syndication processor
  // remove it; it already owns that path.
  if (!shouldHaveMetaobject(review.status)) {
    await enqueueReviewSyndication({
      storeId,
      reviewId: review.id,
      repairKey: `resurrected-${metaobjectGid}`,
    });
    logger.warn(
      { storeId, reviewId: review.id, status: review.status },
      'Metaobject exists for a non-publishable review — removing',
    );
    return;
  }

  let actualFields = input.metaobjectFields ?? null;
  let actualPublishable: string | null = null;

  if (!actualFields) {
    const client = new ShopifyClient(store);
    let stored;
    try {
      stored = await fetchReviewMetaobject(client, metaobjectGid);
    } catch (err) {
      if (err instanceof MetaobjectError && err.terminal) {
        logger.error(
          { storeId, reviewId: review.id, metaobjectGid, err: err.message },
          'Cannot read metaobject for reconciliation — giving up on this delivery',
        );
        return;
      }
      throw err;
    }

    if (!stored) {
      // Gone between the webhook and this read. The delete webhook for it is
      // either already queued or on its way, and that path owns the repair.
      logger.info(
        { storeId, reviewId: review.id, metaobjectGid },
        'Metaobject no longer exists — deferring to the delete webhook',
      );
      return;
    }

    actualFields = stored.fields;
    actualPublishable = stored.publishableStatus;
  }

  const expected = buildReviewFields(reviewMetaobjectInput(review));
  const drifted = driftedFieldKeys(expected, actualFields);

  const wantPublishable = expectedPublishableStatus(review);
  const publishableDrift = actualPublishable !== null && actualPublishable !== wantPublishable;

  if (drifted.length === 0 && !publishableDrift) {
    // The overwhelmingly common case: the echo of our own write.
    logger.debug({ storeId, reviewId: review.id }, 'Metaobject matches — no drift');
    return;
  }

  await prisma.review.update({
    where: { id: review.id },
    data: { syncStatus: 'PENDING', syncError: null },
  });

  // repairKey is keyed on WHAT drifted, so repeated identical drift coalesces
  // while a new kind of change always gets its own job.
  await enqueueReviewSyndication({
    storeId,
    reviewId: review.id,
    repairKey: `drift-${[...drifted].sort().join('.')}${publishableDrift ? '.publishable' : ''}`,
  });

  // A changed rating moves the product's average, and the aggregate
  // metafields are the values Shopify reads for the Shop app.
  if (drifted.includes('rating')) {
    await enqueueAggregateSync({ storeId, productId: review.productId });
  }

  // Field KEYS only — values carry review text and author names.
  logger.warn(
    { storeId, reviewId: review.id, metaobjectGid, drifted, publishableDrift },
    'Metaobject drifted from our copy — re-syndicating from Postgres',
  );
}
