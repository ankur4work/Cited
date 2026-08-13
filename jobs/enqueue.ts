import { ingestionQueue, syndicationQueue, emailQueue, aiQueue } from './queue';
import { logger } from '@/lib/logger';

/**
 * Typed enqueue helpers.
 *
 * Route handlers and webhook processors call these instead of touching a
 * Queue directly, so job IDs (and therefore idempotency) are defined in one
 * place. Shopify redelivers webhooks and merchants double-click buttons;
 * every helper below is safe to call more than once with the same inputs.
 */

/**
 * Install backfill: pull the catalog, then recent orders.
 *
 * Job IDs are keyed on the store so a reinstall or a duplicated callback
 * collapses into one job rather than running two concurrent backfills
 * against the same Admin API rate-limit bucket.
 */
export async function enqueueInstallBackfill(input: {
  storeId: string;
  shopDomain: string;
}): Promise<void> {
  const { storeId, shopDomain } = input;

  await ingestionQueue.add(
    'ingest:products',
    { storeId, shopDomain, origin: 'install', force: true },
    { jobId: `install:products:${storeId}` },
  );

  await ingestionQueue.add(
    'ingest:orders',
    { storeId, shopDomain, origin: 'install', sinceDays: 90 },
    {
      jobId: `install:orders:${storeId}`,
      // Products first: order→product matching needs the catalog present,
      // and verified-buyer status depends on that match.
      delay: 5_000,
    },
  );

  logger.info({ storeId, shopDomain }, 'Install backfill enqueued');
}

/**
 * Project one review into its Shopify `product_review` metaobject.
 *
 * jobId is the review ID, so N rapid edits to the same review coalesce into
 * a single pending sync instead of racing each other to write.
 */
export async function enqueueReviewSyndication(input: {
  storeId: string;
  reviewId: string;
}): Promise<void> {
  await syndicationQueue.add(
    'syndicate:review',
    { storeId: input.storeId, reviewId: input.reviewId },
    { jobId: `syndicate:review:${input.reviewId}` },
  );
}

/**
 * Recompute a product's rating aggregate and push it to the
 * `reviews.rating` / `reviews.rating_count` metafields Shopify requires.
 *
 * Debounced: a burst of new reviews on one product should produce one
 * aggregate write, not one per review.
 */
export async function enqueueAggregateSync(input: {
  storeId: string;
  productId: string;
  debounceMs?: number;
}): Promise<void> {
  await syndicationQueue.add(
    'syndicate:aggregate',
    { storeId: input.storeId, productId: input.productId },
    {
      jobId: `syndicate:aggregate:${input.productId}`,
      delay: input.debounceMs ?? 10_000,
    },
  );
}

/**
 * Queue a review-request email for one order.
 *
 * jobId is (campaign, order, reminder) — the same triple that uniquely keys
 * RequestSend in the schema. Duplicate blasts are therefore blocked twice:
 * once at the queue and once at the database. Given a competitor shipped
 * 3,620 unintended emails on a default template, one guard is not enough.
 */
export async function enqueueReviewRequest(input: {
  storeId: string;
  campaignId: string;
  orderShopifyGid: string;
  reminderIndex?: number;
  delayMs?: number;
}): Promise<void> {
  const reminder = input.reminderIndex ?? 0;
  const orderKey = input.orderShopifyGid.split('/').pop() ?? input.orderShopifyGid;

  await emailQueue.add(
    reminder === 0 ? 'email:request' : 'email:reminder',
    {
      storeId: input.storeId,
      campaignId: input.campaignId,
      orderShopifyGid: input.orderShopifyGid,
    },
    {
      jobId: `email:${input.campaignId}:${orderKey}:${reminder}`,
      delay: input.delayMs ?? 0,
    },
  );
}

/** Regenerate a product's AI review summary. Debounced per product. */
export async function enqueueProductSummary(input: {
  storeId: string;
  productId: string;
}): Promise<void> {
  await aiQueue.add(
    'ai:summarize-product',
    { storeId: input.storeId, productId: input.productId },
    { jobId: `ai:summary:${input.productId}`, delay: 30_000 },
  );
}
