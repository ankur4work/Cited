import { ingestionQueue, syndicationQueue, emailQueue, aiQueue, maintenanceQueue } from './queue';
import type {
  SyndicationJobData,
  SyndicationJobName,
  MaintenanceJobData,
  IngestionJobName,
} from './queue';
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
 * Debounced incremental catalog/order pull, triggered by a webhook.
 *
 * Webhooks arrive one per record; the ingestion processors run Shopify **bulk**
 * operations, and a shop may only have one bulk query in flight at a time. One
 * job per webhook would therefore mostly produce conflicts against the same
 * shop rather than throughput — a hundred orders in a flash sale would be a
 * hundred jobs competing for one slot.
 *
 * So a burst collapses into a single delayed pull per store. The delay is the
 * debounce window: while a job sits waiting, BullMQ discards duplicate IDs, so
 * every further webhook in that window is absorbed by the run already
 * scheduled. `sinceDays: 1` keeps the pull narrow while still overlapping
 * generously with the window, so nothing is missed at the boundary.
 *
 * Finished jobs are cleared first for the same reason as the syndication
 * helpers: a completed record survives in the completed set for days, and
 * would otherwise silently swallow every later enqueue.
 */
async function enqueueDebouncedIngestion(
  name: IngestionJobName,
  input: { storeId: string; shopDomain: string; delayMs?: number },
): Promise<void> {
  const jobId = `webhook:${name}:${input.storeId}`;

  const existing = await ingestionQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove().catch((err: unknown) =>
        logger.warn(
          { jobId, err: (err as Error).message },
          'Could not clear finished ingestion job before re-enqueue',
        ),
      );
    }
  }

  await ingestionQueue.add(
    name,
    { storeId: input.storeId, shopDomain: input.shopDomain, origin: 'webhook', sinceDays: 1 },
    { jobId, delay: input.delayMs ?? 60_000 },
  );
}

/** Order changed on the shop — pull recent orders once the burst settles. */
export async function enqueueOrderSync(input: {
  storeId: string;
  shopDomain: string;
}): Promise<void> {
  await enqueueDebouncedIngestion('ingest:orders', input);
}

/** Catalog changed — same debounce, so a bulk edit is one pull, not hundreds. */
export async function enqueueProductSync(input: {
  storeId: string;
  shopDomain: string;
}): Promise<void> {
  await enqueueDebouncedIngestion('ingest:products', input);
}

/**
 * Add to the syndication queue under a coalescing job ID.
 *
 * BullMQ treats a job ID that already exists as a duplicate and silently
 * returns without enqueuing anything (see `handleDuplicatedJob` in its Lua
 * scripts). That is exactly what we want while a job is waiting or delayed —
 * it is what makes the shared ID a debounce. It is emphatically NOT what we
 * want once the job has finished, because the record survives in the
 * completed set (`removeOnComplete: {count: 500, age: 7d}`) and in the failed
 * set for 30 days. Without this, editing a review a week after its first sync
 * would enqueue nothing at all, and a review whose first sync FAILED could
 * never be retried for a month — silently, with no error anywhere.
 *
 * Since syndicating every valid review is a compliance obligation rather than
 * a best effort, finished records are cleared before re-adding.
 */
async function addCoalescedSyndication(
  name: SyndicationJobName,
  data: SyndicationJobData,
  opts: { jobId: string; delay?: number },
): Promise<void> {
  const existing = await syndicationQueue.getJob(opts.jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      // `remove()` refuses to touch a locked job, so a job that became active
      // between the two calls is left alone — the add below then no-ops, and
      // the in-flight run covers this trigger anyway.
      await existing.remove().catch((err: unknown) =>
        logger.warn(
          { jobId: opts.jobId, err: (err as Error).message },
          'Could not clear finished job before re-enqueue',
        ),
      );
    }
  }

  await syndicationQueue.add(name, data, { jobId: opts.jobId, delay: opts.delay });
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
  /**
   * Bypasses coalescing with a distinct job ID.
   *
   * Used by drift repair: a metaobject webhook telling us Shopify's copy no
   * longer matches ours must never be swallowed by an in-flight or
   * just-completed job under the shared ID, because there is no second
   * webhook coming to try again.
   */
  repairKey?: string;
}): Promise<void> {
  const jobId = input.repairKey
    ? `syndicate:review:${input.reviewId}:repair:${input.repairKey}`
    : `syndicate:review:${input.reviewId}`;

  await addCoalescedSyndication('syndicate:review', {
    storeId: input.storeId,
    reviewId: input.reviewId,
  }, { jobId });
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
  await addCoalescedSyndication('syndicate:aggregate', {
    storeId: input.storeId,
    productId: input.productId,
  }, {
    jobId: `syndicate:aggregate:${input.productId}`,
    delay: input.debounceMs ?? 10_000,
  });
}

/**
 * Start — or continue — a store-wide backfill of the metaobject projection.
 *
 * The job ID carries the cursor rather than just the store. That is required,
 * not cosmetic: a chunk enqueues its successor while it is still ACTIVE, and
 * a store-scoped ID would collide with the running job and be discarded,
 * stopping the backfill dead after one chunk. Keying on the cursor also makes
 * re-triggering the same chunk idempotent.
 */
export async function enqueueSyndicationBackfill(input: {
  storeId: string;
  cursor?: string;
  processed?: number;
  delayMs?: number;
}): Promise<void> {
  await syndicationQueue.add(
    'syndicate:backfill',
    { storeId: input.storeId, cursor: input.cursor, processed: input.processed },
    {
      jobId: `syndicate:backfill:${input.storeId}:${input.cursor ?? 'start'}`,
      delay: input.delayMs ?? 0,
    },
  );
}

/**
 * Reconcile one metaobject against our copy of the review, in response to a
 * `metaobjects/*` webhook.
 *
 * jobId is the Shopify webhook ID, which is stable across Shopify's own
 * redeliveries. Here a retained completed job is the CORRECT behaviour and no
 * clearing is wanted: a redelivered webhook we have already reconciled should
 * do nothing. That is the opposite of the syndication helpers above, and the
 * difference is deliberate — this ID identifies one delivery, theirs identify
 * a subject that keeps changing.
 */
export async function enqueueMetaobjectReconcile(input: {
  storeId: string;
  webhookId: string;
  webhookEventId: string;
  topic: string;
  metaobjectGid: string;
  metaobjectHandle?: string | null;
  metaobjectFields?: Record<string, string> | null;
}): Promise<void> {
  await syndicationQueue.add(
    'reconcile:metaobject',
    {
      storeId: input.storeId,
      metaobjectGid: input.metaobjectGid,
      metaobjectHandle: input.metaobjectHandle ?? undefined,
      metaobjectFields: input.metaobjectFields ?? undefined,
      webhookTopic: input.topic,
      webhookEventId: input.webhookEventId,
    },
    { jobId: `reconcile:metaobject:${input.webhookId}` },
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

/**
 * Run a GDPR/CCPA compliance request — data export or erasure.
 *
 * jobId is the ledger row, which is itself uniquely keyed on Shopify's webhook
 * ID, so a redelivered compliance webhook cannot schedule a second purge. A
 * retained completed job is correct here for the same reason it is for
 * metaobject reconciliation: this ID identifies one request, not a subject
 * that keeps changing.
 *
 * Note this deliberately does not coalesce by store. Two erasure requests for
 * two customers of the same shop are two obligations, and collapsing them
 * would silently discharge only one.
 */
export async function enqueueCompliancePurge(input: {
  complianceRequestId: string;
  storeId: string | null;
  shopDomain: string;
  type: MaintenanceJobData['type'];
  customerEmail: string | null;
  orderGids: string[];
}): Promise<void> {
  await maintenanceQueue.add(
    'compliance:purge',
    {
      complianceRequestId: input.complianceRequestId,
      storeId: input.storeId,
      shopDomain: input.shopDomain,
      type: input.type,
      customerEmail: input.customerEmail,
      orderGids: input.orderGids,
    },
    { jobId: `compliance:${input.complianceRequestId}` },
  );

  logger.info(
    { shopDomain: input.shopDomain, type: input.type, requestId: input.complianceRequestId },
    'Compliance request enqueued',
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
