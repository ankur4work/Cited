import { Worker, type Job } from 'bullmq';
import {
  connection,
  maintenanceQueue,
  QUEUES,
  type IngestionJobData,
  type IngestionJobName,
  type MaintenanceJobData,
  type MaintenanceJobName,
  type SyndicationJobData,
  type SyndicationJobName,
  type AiJobData,
  type AiJobName,
} from './queue';
import { compliancePurgeProcessor } from './processors/compliance-purge';
import { retentionSweepProcessor } from './processors/retention-sweep';
import { ingestProductsProcessor } from './processors/ingest-products';
import { ingestOrdersProcessor } from './processors/ingest-orders';
import { syndicateReviewProcessor } from './processors/syndicate-review';
import { syndicateAggregateProcessor } from './processors/syndicate-aggregate';
import { reconcileMetaobjectProcessor } from './processors/reconcile-metaobject';
import { syndicateBackfillProcessor } from './processors/syndicate-backfill';
import { summarizeProductProcessor } from './processors/summarize-product';
import { mediaBackfillProcessor } from './processors/media-backfill';
import { translateReviewProcessor } from './processors/translate-review';
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
 * Consumes ingestion, syndication, AI and maintenance. The email, import and
 * AEO queues are declared in queue.ts and intentionally left unconsumed rather
 * than stubbed — a no-op processor would silently ACK real work as done.
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

// ── Maintenance ──────────────────────────────────────────────
// GDPR/CCPA erasure and the retention sweep. Concurrency of 2 on purpose:
// these jobs delete across many tables and there is no throughput argument for
// running a dozen at once, while there is a clear argument for keeping the
// blast radius of a bug small.

// ── AI ───────────────────────────────────────────────────────
// Low concurrency on purpose. These jobs are the only ones that spend money
// per execution, and they are never latency-critical — a summary that lands
// thirty seconds later is indistinguishable to a shopper. Capping the fleet
// here bounds how fast a bug can burn through a store's monthly AI budget.

type AiHandler = (job: Job<AiJobData, unknown, AiJobName>) => Promise<void>;

const aiHandlers: Record<AiJobName, AiHandler> = {
  'ai:summarize-product': summarizeProductProcessor,
  'ai:translate-review': translateReviewProcessor,
  // Declared in queue.ts, not yet built. Throwing beats a no-op handler, which
  // would ACK the work as done and leave the feature silently absent.
  'ai:moderate-review': async () => {
    throw new Error('ai:moderate-review processor not implemented');
  },
  'ai:mine-insights': async () => {
    throw new Error('ai:mine-insights processor not implemented');
  },
};

const aiWorker = new Worker<AiJobData, unknown, AiJobName>(
  QUEUES.AI,
  async (job) => {
    const handler = aiHandlers[job.name];
    if (!handler) throw new Error(`No handler for job name ${job.name}`);
    return handler(job);
  },
  { connection, concurrency: 2 },
);

aiWorker.on('failed', async (job, err) => {
  if (!job) return;
  logger.error(
    {
      queue: QUEUES.AI,
      name: job.name,
      jobId: job.id,
      storeId: job.data?.storeId,
      productId: job.data?.productId,
      attempt: job.attemptsMade,
      err: err.message,
    },
    'AI job failed',
  );

  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await moveToDlq(job as Job<{ storeId: string }>, err).catch((e) =>
      logger.error({ err: (e as Error).message }, 'Failed to move job to DLQ'),
    );
  }
});

type MaintenanceHandler = (
  job: Job<MaintenanceJobData, unknown, MaintenanceJobName>,
) => Promise<void>;

const maintenanceHandlers: Record<MaintenanceJobName, MaintenanceHandler> = {
  'compliance:purge': compliancePurgeProcessor,
  'retention:sweep': retentionSweepProcessor,
  'media:backfill': mediaBackfillProcessor,
  // Declared in queue.ts but not yet built. Throwing beats a no-op handler,
  // which would ACK real work as done and silently retain media forever.
  'media-lifecycle': async () => {
    throw new Error('media-lifecycle processor not implemented');
  },
};

const maintenanceWorker = new Worker<MaintenanceJobData, unknown, MaintenanceJobName>(
  QUEUES.MAINTENANCE,
  async (job) => {
    const handler = maintenanceHandlers[job.name];
    if (!handler) throw new Error(`No handler for job name ${job.name}`);
    return handler(job);
  },
  { connection, concurrency: 2 },
);

maintenanceWorker.on('failed', async (job, err) => {
  if (!job) return;
  logger.error(
    {
      queue: QUEUES.MAINTENANCE,
      name: job.name,
      jobId: job.id,
      storeId: job.data?.storeId,
      complianceRequestId: job.data?.complianceRequestId,
      attempt: job.attemptsMade,
      err: err.message,
    },
    'Maintenance job failed',
  );

  if (job.attemptsMade >= (job.opts.attempts ?? 1)) {
    // A compliance job that exhausts its retries is an unmet legal obligation
    // on a 30-day clock, not just a failed job. It goes to the DLQ like
    // anything else, but at a severity that should page someone.
    if (job.name === 'compliance:purge') {
      logger.error(
        {
          alert: true,
          complianceRequestId: job.data?.complianceRequestId,
          shopDomain: job.data?.shopDomain,
          type: job.data?.type,
        },
        'COMPLIANCE REQUEST FAILED after all retries — must be completed manually before its due date',
      );
    }
    await moveToDlq(
      job as Job<{ storeId: string }>,
      err,
    ).catch((e) => logger.error({ err: (e as Error).message }, 'Failed to move job to DLQ'));
  }
});

/**
 * Daily retention sweep.
 *
 * Registered here rather than by an external cron so that retention cannot be
 * silently switched off by forgetting to configure a scheduler — if the worker
 * is running, the sweep is scheduled. BullMQ keys repeatable jobs by name and
 * pattern, so re-registering on every boot replaces rather than accumulates.
 */
async function scheduleRecurringJobs(): Promise<void> {
  await maintenanceQueue.add(
    'retention:sweep',
    {},
    {
      repeat: { pattern: '17 3 * * *' }, // 03:17 daily — off the hour, away from peak
      jobId: 'retention:sweep:daily',
    },
  );
  logger.info('Retention sweep scheduled (daily 03:17)');

  // Safety net for media URL resolution. The per-review job fired at upload
  // time handles the common case; this catches a transcode slower than that
  // job's delay, a worker restart mid-job, or a transient Admin API failure.
  // Without it those rows keep a null URL forever and the shopper's video is
  // simply never seen — the failure is invisible from both sides.
  //
  // Every five minutes: frequent enough that a slow transcode still surfaces
  // while the shopper might plausibly look again, cheap enough that it costs
  // nothing when there is nothing pending (the processor returns on an empty
  // query before touching Shopify at all).
  await maintenanceQueue.add(
    'media:backfill',
    {},
    { repeat: { pattern: '*/5 * * * *' }, jobId: 'media:backfill:sweep' },
  );
  logger.info('Media URL backfill scheduled (every 5 minutes)');
}

void scheduleRecurringJobs().catch((err) =>
  logger.error({ err: (err as Error).message }, 'Failed to schedule recurring maintenance jobs'),
);

logger.info(
  { queues: [QUEUES.INGESTION, QUEUES.SYNDICATION, QUEUES.AI, QUEUES.MAINTENANCE] },
  'Cited worker started',
);

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
    await Promise.all([
      ingestionWorker.close(),
      syndicationWorker.close(),
      aiWorker.close(),
      maintenanceWorker.close(),
    ]);
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
