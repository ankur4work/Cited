import { Worker, type Job } from 'bullmq';
import {
  connection,
  QUEUES,
  type IngestionJobData,
  type IngestionJobName,
  type SyndicationJobData,
  type SyndicationJobName,
} from './queue';
import { ingestProductsProcessor } from './processors/ingest-products';
import { ingestOrdersProcessor } from './processors/ingest-orders';
import { syndicateReviewProcessor } from './processors/syndicate-review';
import { syndicateAggregateProcessor } from './processors/syndicate-aggregate';
import { reconcileMetaobjectProcessor } from './processors/reconcile-metaobject';
import { syndicateBackfillProcessor } from './processors/syndicate-backfill';
import { moveToDlq } from './dlq';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

/**
 * Background worker.
 *
 * Runs as its own process (`pnpm worker`), never inside the Next.js server:
 * a bulk import must not compete with merchant-facing requests for the event
 * loop, and the web tier needs to scale on request volume while the worker
 * scales on job volume.
 *
 * Only the ingestion queue has processors so far. Other queues are declared
 * in queue.ts and are intentionally left unconsumed rather than stubbed —
 * a no-op processor would silently ACK real work as done.
 */

type IngestionHandler = (job: Job<IngestionJobData, unknown, IngestionJobName>) => Promise<void>;

const ingestionHandlers: Record<IngestionJobName, IngestionHandler> = {
  'ingest:products': ingestProductsProcessor,
  'ingest:orders': ingestOrdersProcessor,
};

const ingestionWorker = new Worker<IngestionJobData, unknown, IngestionJobName>(
  QUEUES.INGESTION,
  async (job) => {
    const handler = ingestionHandlers[job.name];
    if (!handler) throw new Error(`No handler for job name ${job.name}`);
    return handler(job);
  },
  {
    connection,
    // Deliberately low. Each job drives a Shopify bulk operation, and a shop
    // may only run ONE bulk query at a time — high concurrency here would
    // mostly produce conflicts against the same shop, not throughput.
    concurrency: 5,
  },
);

ingestionWorker.on('failed', async (job, err) => {
  if (!job) return;
  logger.error(
    {
      queue: QUEUES.INGESTION,
      name: job.name,
      jobId: job.id,
      storeId: job.data?.storeId,
      attempt: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      err: err.message,
    },
    'Ingestion job failed',
  );

  // Only DLQ once retries are genuinely exhausted, or every transient
  // failure would raise a false alert.
  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await moveToDlq(job, err).catch((e) =>
      logger.error({ err: (e as Error).message }, 'Failed to move job to DLQ'),
    );
  }
});

ingestionWorker.on('completed', (job) => {
  logger.info(
    { queue: QUEUES.INGESTION, name: job.name, jobId: job.id, storeId: job.data?.storeId },
    'Ingestion job completed',
  );
});

// ── Syndication ──────────────────────────────────────────────
// Mirrors reviews into Shopify metaobjects. Concurrency is much higher than
// ingestion because these are ordinary GraphQL mutations, not bulk
// operations, so they are limited by the Admin API cost budget the client
// already throttles against rather than by a one-at-a-time constraint.

type SyndicationHandler = (
  job: Job<SyndicationJobData, unknown, SyndicationJobName>,
) => Promise<void>;

const syndicationHandlers: Record<SyndicationJobName, SyndicationHandler> = {
  'syndicate:review': syndicateReviewProcessor,
  'syndicate:aggregate': syndicateAggregateProcessor,
  // Inbound half of the same projection: detects metaobjects changed outside
  // the app and repairs them from Postgres. Shares this queue on purpose —
  // reconciliation and syndication write the same records, and keeping them
  // on one queue means one concurrency budget rather than two that can race.
  'reconcile:metaobject': reconcileMetaobjectProcessor,
  // Bulk re-projection of an entire store, used after Shopify grants the
  // restricted scope. Chunked and cursor-resumable — see the processor.
  'syndicate:backfill': syndicateBackfillProcessor,
};

const syndicationWorker = new Worker<SyndicationJobData, unknown, SyndicationJobName>(
  QUEUES.SYNDICATION,
  async (job) => {
    const handler = syndicationHandlers[job.name];
    if (!handler) throw new Error(`No handler for job name ${job.name}`);
    return handler(job);
  },
  { connection, concurrency: 20 },
);

syndicationWorker.on('failed', async (job, err) => {
  if (!job) return;
  logger.error(
    {
      queue: QUEUES.SYNDICATION,
      name: job.name,
      jobId: job.id,
      storeId: job.data?.storeId,
      reviewId: job.data?.reviewId,
      attempt: job.attemptsMade,
      err: err.message,
    },
    'Syndication job failed',
  );

  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await moveToDlq(job, err).catch((e) =>
      logger.error({ err: (e as Error).message }, 'Failed to move job to DLQ'),
    );
  }
});

logger.info({ queues: [QUEUES.INGESTION, QUEUES.SYNDICATION] }, 'Cited worker started');

/**
 * Graceful shutdown.
 *
 * `close()` lets in-flight jobs finish instead of killing them mid-write —
 * a half-applied order batch would leave line items detached from their
 * order. Coolify sends SIGTERM on redeploy, so this runs on every release.
 */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutting down — draining in-flight jobs');
  try {
    await Promise.all([ingestionWorker.close(), syndicationWorker.close()]);
    await prisma.$disconnect();
    await connection.quit();
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Error during worker shutdown');
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
