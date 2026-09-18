/**
 * Re-publish a store's reviews to Shopify.
 *
 * Syndication normally re-runs on its own: a review changes, a webhook lands,
 * the job republishes that product. There is no trigger for "republish
 * everything" outside the scope-grant path in lib/shopify/store.ts, which only
 * fires on a transition — so a change to what syndication WRITES leaves every
 * existing review sitting in the old shape until someone edits it.
 *
 * That is exactly what the $app:cited → $app namespace correction did. Run this
 * once per store after deploying it, or the storefront block keeps reading an
 * empty list for reviews that were published before the fix.
 *
 *   npx tsx --env-file=.env scripts/resyndicate.ts <shop.myshopify.com>
 */
import { prisma } from '../lib/prisma';
import { enqueueAggregateSync } from '../jobs/enqueue';
import { connection } from '../jobs/queue';

async function main(): Promise<void> {
  const shopDomain = process.argv[2];
  if (!shopDomain) {
    console.error('Usage: tsx scripts/resyndicate.ts <shop.myshopify.com>');
    process.exit(1);
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true, reviewScopeGranted: true, uninstalledAt: true },
  });

  if (!store) {
    console.error(`No store found for ${shopDomain}`);
    process.exit(1);
  }
  if (store.uninstalledAt) {
    console.error(`${shopDomain} is uninstalled — nothing to publish to.`);
    process.exit(1);
  }
  // Without the scope every syndication job returns early, and the run would
  // look like a success while writing nothing at all.
  if (!store.reviewScopeGranted) {
    console.error(
      `${shopDomain} has not granted write_product_reviews — syndication would no-op. ` +
        'Re-authorize the app first.',
    );
    process.exit(1);
  }

  // Aggregate sync, NOT syndicate:backfill. The backfill only picks up reviews
  // whose syncStatus is not SYNCED — it projects reviews into metaobjects, and
  // a store whose reviews are all already projected has nothing for it to do
  // ("Backfill complete, processed: 0"). The product→reviews LIST metafield,
  // which is the thing the storefront block actually reads, is written by the
  // aggregate job. Republishing it means re-running that, per product.
  const products = await prisma.product.findMany({
    where: {
      storeId: store.id,
      reviews: { some: { status: 'PUBLISHED', metaobjectGid: { not: null } } },
    },
    select: { id: true, title: true },
  });

  if (products.length === 0) {
    console.log(`No products with published, syndicated reviews on ${shopDomain}.`);
    return;
  }

  for (const p of products) {
    // No debounce: this is a deliberate one-shot repair, and a 10s window
    // would only delay it.
    await enqueueAggregateSync({ storeId: store.id, productId: p.id, debounceMs: 0 });
    console.log(`  queued ${p.title.slice(0, 50)}`);
  }

  console.log(`\nQueued ${products.length} aggregate sync(s) for ${shopDomain}.`);
  console.log('The worker must be running. Watch its log for "Rating aggregate syndicated".');
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
