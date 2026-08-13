/**
 * Queue round-trip smoke test.
 *
 * Enqueues a real ingestion job for a store that does not exist. The
 * processor's first action is a store lookup, so it returns early — which
 * means this exercises enqueue → Redis → worker pickup → handler dispatch →
 * completion without needing a Shopify store or a valid access token.
 *
 * Run the worker in another terminal first: pnpm worker
 * Then: pnpm tsx --env-file=.env scripts/smoke-queue.ts
 */
import { ingestionQueue, connection } from '../jobs/queue';

async function main() {
  const storeId = `smoke-${Date.now()}`;

  const job = await ingestionQueue.add('ingest:products', {
    storeId,
    shopDomain: 'smoke-test.myshopify.com',
    origin: 'manual',
  });

  console.log(`enqueued job ${job.id} (storeId=${storeId})`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const state = await job.getState();
    if (state === 'completed') {
      console.log('\x1b[32mPASS\x1b[0m  worker picked up and completed the job');
      await cleanup();
      process.exit(0);
    }
    if (state === 'failed') {
      const fresh = await ingestionQueue.getJob(job.id!);
      console.log(`\x1b[31mFAIL\x1b[0m  job failed: ${fresh?.failedReason}`);
      await cleanup();
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log('\x1b[31mFAIL\x1b[0m  timed out — is the worker running? (pnpm worker)');
  await cleanup();
  process.exit(1);
}

async function cleanup() {
  await ingestionQueue.close();
  await connection.quit();
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  process.exit(1);
});
