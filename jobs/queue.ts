import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@/lib/env';

// `lazyConnect: true` — do NOT open a TCP connection at module import.
// Next.js evaluates route modules during build-time analysis, when Redis
// isn't running; an eager connect turns every build into a failure.
export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

export const QUEUES = {
  INGESTION: 'ingestion',
  SYNDICATION: 'syndication',
  EMAIL: 'email',
  IMPORT: 'import',
  AI: 'ai',
  AEO: 'aeo',
  MAINTENANCE: 'maintenance',
  DLQ: 'dead-letter',
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 15_000 },
  removeOnComplete: { count: 500, age: 7 * 86_400 },
  removeOnFail: { count: 1000, age: 30 * 86_400 },
};

// ── Catalog ingestion ────────────────────────────────────────
export type IngestionJobName = 'ingest:products' | 'ingest:orders';

export interface IngestionJobData {
  storeId: string;
  shopDomain: string;
  sinceDays?: number;
  force?: boolean;
  origin: 'install' | 'cron' | 'manual' | 'webhook';
}

export const ingestionQueue = new Queue<IngestionJobData, unknown, IngestionJobName>(
  QUEUES.INGESTION,
  { connection, defaultJobOptions },
);

// ── Metaobject syndication ───────────────────────────────────
// Shopify REQUIRES approved review apps to mirror every valid review into
// `product_review` metaobjects plus the rating/rating_count product
// metafields. This queue owns that projection. Postgres stays the source of
// truth; Shopify is eventually consistent behind it.
export type SyndicationJobName =
  | 'syndicate:review'
  | 'syndicate:aggregate'
  | 'syndicate:backfill'
  | 'reconcile:metaobject';

export interface SyndicationJobData {
  storeId: string;
  reviewId?: string;
  productId?: string;

  // ── reconcile:metaobject only ──────────────────────────────
  /** Metaobject the webhook fired for, always in `gid://` form. */
  metaobjectGid?: string;
  /** Handle from the payload. Recovers ownership when the GID isn't on file yet. */
  metaobjectHandle?: string;
  /** Full topic, e.g. `metaobjects/update` — delete is handled differently. */
  webhookTopic?: string;
  /** WebhookEvent row to close out once reconciliation finishes. */
  webhookEventId?: string;

  // ── syndicate:backfill only ────────────────────────────────
  /**
   * Resume point: the last review ID projected. Each chunk re-enqueues itself
   * with a new cursor rather than looping in one job, so a worker restart
   * costs one chunk instead of the whole store.
   */
  cursor?: string;
  /** Running total across chunks, for progress logging. */
  processed?: number;
  /**
   * Field values lifted from the webhook body, when it carried them. Present
   * means the processor can detect drift without an Admin API read — which
   * matters because our own writes generate webhooks, so this is the hot path,
   * not the exception.
   */
  metaobjectFields?: Record<string, string>;
}

export const syndicationQueue = new Queue<SyndicationJobData, unknown, SyndicationJobName>(
  QUEUES.SYNDICATION,
  {
    connection,
    defaultJobOptions: {
      ...defaultJobOptions,
      // More attempts than default: this projection is a compliance
      // obligation, not a nicety, so transient Admin API failures should
      // keep retrying well past the point we'd give up on other work.
      attempts: 6,
    },
  },
);

// ── Review request email ─────────────────────────────────────
export type EmailJobName = 'email:request' | 'email:reminder' | 'email:schedule-batch';

export interface EmailJobData {
  storeId: string;
  campaignId?: string;
  sendId?: string;
  orderShopifyGid?: string;
}

export const emailQueue = new Queue<EmailJobData, unknown, EmailJobName>(QUEUES.EMAIL, {
  connection,
  defaultJobOptions,
});

// ── Migration / import ───────────────────────────────────────
export interface ImportJobData {
  storeId: string;
  importJobId: string;
  /** Resume offset. Chunked so a crash never costs merchant progress. */
  cursor?: string;
}

export const importQueue = new Queue<ImportJobData, unknown, 'import:process'>(QUEUES.IMPORT, {
  connection,
  // Imports are long and resumable; retrying the whole job on failure would
  // redo work. The processor checkpoints its cursor and is re-enqueued
  // explicitly instead.
  defaultJobOptions: { ...defaultJobOptions, attempts: 1 },
});

// ── AI ───────────────────────────────────────────────────────
export type AiJobName = 'ai:summarize-product' | 'ai:moderate-review' | 'ai:mine-insights';

export interface AiJobData {
  storeId: string;
  productId?: string;
  reviewId?: string;
}

export const aiQueue = new Queue<AiJobData, unknown, AiJobName>(QUEUES.AI, {
  connection,
  defaultJobOptions,
});

// ── AEO visibility probes ────────────────────────────────────
export interface AeoJobData {
  storeId: string;
  promptSetId?: string;
}

export const aeoQueue = new Queue<AeoJobData, unknown, 'aeo:probe-store'>(QUEUES.AEO, {
  connection,
  defaultJobOptions,
});

// ── Maintenance ──────────────────────────────────────────────
export const maintenanceQueue = new Queue<
  Record<string, unknown>,
  unknown,
  'redact-purge' | 'media-lifecycle'
>(QUEUES.MAINTENANCE, { connection, defaultJobOptions });

// ── Dead letter ──────────────────────────────────────────────
// Accepts ANY failed job shape. Typed loosely on purpose: strict typing here
// would force every queue's payload to conform to the DLQ's signature.
export interface DlqPayload extends Record<string, unknown> {
  storeId: string;
  originalError: string;
}

export const dlq = new Queue<DlqPayload, unknown, string>(QUEUES.DLQ, {
  connection,
  defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
});
