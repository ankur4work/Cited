import { Worker, type Job } from 'bullmq';
import { connection, QUEUES, type IngestionJobData, type IngestionJobName } from './queue';
import { ingestProductsProcessor } from './processors/ingest-products';
import { ingestOrdersProcessor } from './processors/ingest-orders';
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

logger.info({ queues: [QUEUES.INGESTION] }, 'Cited worker started');

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
    await ingestionWorker.close();
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
