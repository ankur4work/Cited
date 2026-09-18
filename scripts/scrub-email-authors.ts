/**
 * Replace any review author name that is actually an email address.
 *
 * Shopify's `displayName` falls back to the email for a customer with no first
 * or last name, and that value was stored as the review's author and published
 * on the storefront. The proxy now refuses an address at write time; this
 * clears the ones already stored.
 *
 * Nulling rather than guessing a name: the block renders its anonymous label
 * when the author is empty, which is what a shopper who never gave a name
 * should have had all along.
 *
 *   npx tsx --env-file=.env scripts/scrub-email-authors.ts <shop.myshopify.com>
 *   npx tsx --env-file=.env scripts/scrub-email-authors.ts --all
 */
import { prisma } from '../lib/prisma';
import { enqueueReviewSyndication, enqueueAggregateSync } from '../jobs/enqueue';
import { connection } from '../jobs/queue';

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx scripts/scrub-email-authors.ts <shop.myshopify.com> | --all');
    process.exit(1);
  }

  let storeIds: string[] = [];
  if (arg === '--all') {
    storeIds = (
      await prisma.store.findMany({ where: { uninstalledAt: null }, select: { id: true } })
    ).map((s) => s.id);
  } else {
    const store = await prisma.store.findUnique({
      where: { shopDomain: arg },
      select: { id: true },
    });
    if (!store) throw new Error(`no store ${arg}`);
    storeIds = [store.id];
  }

  const affected = await prisma.review.findMany({
    where: { storeId: { in: storeIds }, authorName: { contains: '@' } },
    select: { id: true, storeId: true, productId: true, authorName: true },
  });

  if (affected.length === 0) {
    console.log('No review author names contain an address. Nothing to do.');
    return;
  }

  console.log(`Found ${affected.length} review(s) with an email address as the author name.`);

  await prisma.review.updateMany({
    where: { id: { in: affected.map((r) => r.id) } },
    data: { authorName: null },
  });

  // Republish: the address is already live on Shopify as the metaobject's
  // author_display_name, and clearing our copy alone changes nothing a shopper
  // can see.
  const products = new Set<string>();
  for (const r of affected) {
    await enqueueReviewSyndication({ storeId: r.storeId, reviewId: r.id });
    if (r.productId) products.add(`${r.storeId}:${r.productId}`);
  }
  for (const key of products) {
    const [storeId, productId] = key.split(':') as [string, string];
    await enqueueAggregateSync({ storeId, productId, debounceMs: 0 });
  }

  console.log(`Cleared and queued ${affected.length} review(s) for republication.`);
}

main()
  .catch((err) => {
    console.error('FAILED:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await connection.quit();
  });
