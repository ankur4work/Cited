import { Worker, Queue, type Job } from 'bullmq';
import {
  connection,
  QUEUES,
  maintenanceQueue,
  type IngestionJobData,
  type IngestionJobName,
} from './queue';
import { ingestSearchProcessor } from './processors/ingest-search';
import { ingestOrdersProcessor } from './processors/ingest-orders';
import { ingestProductsProcessor } from './processors/ingest-products';
import { redactPurgeProcessor } from './processors/redact-purge';
import { classifyProcessor } from './processors/classify';
import { digestProcessor } from './processors/digest';
import { seedCronJobs } from './schedule';
import { moveToDlq } from './dlq';
import { logger } from '@/lib/logger';

type IngestionHandler = (job: Job<IngestionJobData, unknown, IngestionJobName>) => Promise<void>;

const handlers: Record<IngestionJobName, IngestionHandler> = {
  'ingest:search': ingestSearchProcessor,
  'ingest:orders': ingestOrdersProcessor,
  'ingest:products': ingestProductsProcessor,
};

const ingestionWorker = new Worker<IngestionJobData, unknown, IngestionJobName>(
  QUEUES.INGESTION,
  async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`No handler for job name ${job.name}`);
    return handler(job);
  },
  { connection, concurrency: 10 },
);

ingestionWorker.on('failed', async (job, err) => {
  logger.error(
    {
      queue: QUEUES.INGESTION,
      name: job?.name,
      jobId: job?.id,
      storeId: job?.data?.storeId,
      attemptsMade: job?.attemptsMade,
      err: err.message,
    },
    'Ingestion job failed',
  );
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await moveToDlq(job, err);
  }
});

ingestionWorker.on('completed', (job) => {
  logger.debug(
    { queue: QUEUES.INGESTION, name: job.name, jobId: job.id, storeId: job.data?.storeId },
    'Ingestion job completed',
  );
});

const classifyWorker = new Worker(
  QUEUES.CLASSIFY,
  async (job) => classifyProcessor(job),
  { connection, concurrency: 4 },
);
classifyWorker.on('failed', async (job, err) => {
  logger.error(
    { queue: QUEUES.CLASSIFY, jobId: job?.id, storeId: job?.data?.storeId, err: err.message },
    'Classification job failed',
  );
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    await moveToDlq(job, err);
  }
});

const digestWorker = new Worker(
  QUEUES.DIGEST,
  async (job) => digestProcessor(job),
  { connection, concurrency: 4 },
);
digestWorker.on('failed', (job, err) => {
  logger.error(
    { queue: QUEUES.DIGEST, jobId: job?.id, storeId: job?.data?.storeId, err: err.message },
    'Digest job failed',
  );
});

const maintenanceWorker = new Worker(
  QUEUES.MAINTENANCE,
  async (job) => {
    if (job.name === 'redact-purge') return redactPurgeProcessor();
    throw new Error(`unknown maintenance job: ${job.name}`);
  },
  { connection, concurrency: 1 },
);
maintenanceWorker.on('failed', (job, err) => {
  logger.error({ name: job?.name, err: err.message }, 'Maintenance job failed');
});

async function shutdown(): Promise<void> {
  logger.info('Worker shutting down');
  await Promise.all([
    ingestionWorker.close(),
    classifyWorker.close(),
    digestWorker.close(),
    maintenanceWorker.close(),
  ]);
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// On startup, clear stale state left by a crashed worker process.
// Since we're single-instance, no live job can hold a mutex or be mid-run.
void (async () => {
  try {
    // 1. Clear Redis mutex keys (TTL up to 30 min for products).
    const IORedis = (await import('ioredis')).default;
    const { env } = await import('@/lib/env');
    const r = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
    await r.connect();
    const keys = await r.keys('mutex:store:*');
    if (keys.length > 0) {
      await r.del(...keys);
      logger.info({ count: keys.length }, 'Cleared stale store mutexes on startup');
    }
    await r.quit();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Mutex cleanup on startup failed — continuing');
  }

  try {
    // 2. Drain all waiting/delayed jobs from the ingestion queue.
    // Before the fixed-jobId retry patch, each locked-mutex attempt enqueued
    // a NEW job with a unique Date.now() jobId — hundreds of stale retry jobs
    // can accumulate. Draining on startup clears the flood so fresh Sync Now
    // jobs get processed immediately. seedCronJobs() re-seeds repeatable crons.
    const ingestionQ = new Queue(QUEUES.INGESTION, { connection });
    const classifyQ = new Queue(QUEUES.CLASSIFY, { connection });
    await Promise.all([ingestionQ.drain(), classifyQ.drain()]);
    await Promise.all([ingestionQ.close(), classifyQ.close()]);
    logger.info('Drained ingestion + classify queues on startup');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Queue drain on startup failed — continuing');
  }

  try {
    // 3. Reset IngestionRun rows stuck in RUNNING state. If the worker crashed
    //    mid-job, these rows never transition to DONE/FAILED. onboarding.status
    //    queries the latest run per type — a stuck RUNNING row causes the
    //    dashboard to show "Waiting…" forever on every page load.
    const { prisma } = await import('@/lib/prisma');
    const { count } = await prisma.ingestionRun.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'FAILED', errorMessage: 'Worker restarted — run interrupted' },
    });
    if (count > 0) {
      logger.info({ count }, 'Reset stuck RUNNING IngestionRun records to FAILED on startup');
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'IngestionRun cleanup on startup failed — continuing');
  }
})();

void seedCronJobs().catch((err) => {
  logger.error({ err: (err as Error).message }, 'seedCronJobs failed');
});

// Daily redact purge at 01:00 UTC.
void maintenanceQueue
  .add('redact-purge', {}, { repeat: { pattern: '0 1 * * *' }, jobId: 'cron:redact-purge' })
  .catch((err) => {
    logger.error({ err: (err as Error).message }, 'redact-purge cron seeding failed');
  });

logger.info('BullMQ workers online (ingestion=10, classify=4, digest=4, maintenance=1)');
