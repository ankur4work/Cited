import type { Job } from 'bullmq';
import { dlq, type DlqPayload } from './queue';
import { logger } from '@/lib/logger';

/**
 * Move a terminally-failed job to the DLQ for manual inspection and fire a
 * structured alert log line. Downstream alert managers match `dlq=true`.
 */
export async function moveToDlq<T extends { storeId: string }>(
  job: Job<T>,
  err: Error,
): Promise<void> {
  const payload: DlqPayload = {
    ...(job.data as unknown as Record<string, unknown>),
    storeId: job.data.storeId,
    originalError: err.message.slice(0, 1000),
  };
  await dlq.add('dead', payload);
  logger.error(
    {
      dlq: true,
      queue: job.queueName,
      name: job.name,
      jobId: job.id,
      storeId: job.data.storeId,
      err: err.message,
    },
    'Job moved to DLQ after exhausting retries — manual intervention required',
  );
}
