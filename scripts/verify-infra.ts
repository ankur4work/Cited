/**
 * Infrastructure smoke test.
 *
 * Proves the things that are easy to assume and expensive to get wrong:
 * Postgres reachable, migration applied, pgvector actually installed
 * (the schema declares a vector column, so a missing extension is a
 * deploy-time failure rather than a compile-time one), and Redis
 * reachable with auth.
 *
 * Run: pnpm tsx --env-file=.env scripts/verify-infra.ts
 */
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

async function main() {
  let failures = 0;
  const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
  const bad = (m: string) => {
    failures += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
  };

  console.log('\nPostgres');
  try {
    const [{ version }] = await prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    ok(version.split(',')[0]!);
  } catch (e) {
    bad(`connection: ${(e as Error).message}`);
  }

  try {
    const rows = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;
    const names = rows.map((r) => r.table_name);
    const expected = [
      'stores',
      'products',
      'reviews',
      'review_media',
      'review_attributes',
      'request_campaigns',
      'request_sends',
      'import_jobs',
      'summaries',
      'insights',
      'aeo_probes',
      'webhook_events',
    ];
    const missing = expected.filter((t) => !names.includes(t));
    if (missing.length) bad(`missing tables: ${missing.join(', ')}`);
    else ok(`${names.length} tables present, all ${expected.length} core tables found`);
  } catch (e) {
    bad(`table introspection: ${(e as Error).message}`);
  }

  try {
    const ext = await prisma.$queryRaw<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `;
    if (ext.length) ok(`pgvector ${ext[0]!.extversion} installed`);
    else bad('pgvector NOT installed — embeddings and insight clustering will fail');
  } catch (e) {
    bad(`pgvector check: ${(e as Error).message}`);
  }

  try {
    const cols = await prisma.$queryRaw<{ udt_name: string }[]>`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'reviews' AND column_name = 'embedding'
    `;
    if (cols.length && cols[0]!.udt_name === 'vector') ok('reviews.embedding is a real vector column');
    else bad(`reviews.embedding has unexpected type: ${cols[0]?.udt_name ?? 'absent'}`);
  } catch (e) {
    bad(`vector column check: ${(e as Error).message}`);
  }

  console.log('\nWrite path');
  try {
    const shop = `verify-${Date.now()}.myshopify.com`;
    const store = await prisma.store.create({ data: { shopDomain: shop } });
    const product = await prisma.product.create({
      data: { storeId: store.id, shopifyGid: 'gid://shopify/Product/1', handle: 'test', title: 'Test' },
    });
    const review = await prisma.review.create({
      data: { storeId: store.id, productId: product.id, rating: 5, body: 'smoke test' },
    });
    // Cascade delete must clean up children — GDPR erasure depends on it.
    await prisma.store.delete({ where: { id: store.id } });
    const orphan = await prisma.review.findUnique({ where: { id: review.id } });
    if (orphan) bad('cascade delete left an orphaned review — GDPR erasure would leak');
    else ok('create + cascade delete clean (store → product → review)');
  } catch (e) {
    bad(`write path: ${(e as Error).message}`);
  }

  console.log('\nRedis');
  const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2, lazyConnect: true });
  try {
    await redis.connect();
    const pong = await redis.ping();
    ok(`ping → ${pong}`);
    await redis.set('cited:verify', '1', 'EX', 10);
    const v = await redis.get('cited:verify');
    if (v === '1') ok('set/get round trip');
    else bad('set/get mismatch');
    await redis.del('cited:verify');
  } catch (e) {
    bad(`redis: ${(e as Error).message}`);
  } finally {
    redis.disconnect();
  }

  console.log(
    failures === 0
      ? '\n\x1b[32mAll infrastructure checks passed.\x1b[0m\n'
      : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
  );
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
