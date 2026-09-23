/**
 * Seed realistic reviews onto one product, for looking at the widget.
 *
 * The storefront block renders almost everything conditionally — the photo
 * strip, the photo and video filter chips, the histogram, the multi-column
 * grid — so on a product with no reviews they all correctly render as nothing.
 * That made the redesign impossible to judge: every screenshot was of the
 * empty state, and "it looks basic" was true because there was nothing to
 * show.
 *
 * This creates the data those states need. It goes through `createReview`, the
 * same path the storefront form uses, so verification, dedupe, spam routing
 * and the aggregate all behave exactly as they do in production — a script
 * that wrote rows directly would prove the widget works against data the app
 * cannot actually produce.
 *
 * Run:
 *   pnpm tsx --env-file=.env scripts/seed-reviews.ts <shop-domain> [product-handle]
 *
 * Reviews are marked `source: 'MANUAL'` with a `sourceLabel` of `seed`, so
 * they are identifiable and removable:
 *   pnpm tsx --env-file=.env scripts/seed-reviews.ts --clean <shop-domain>
 */
import { prisma } from '../lib/prisma';
import { createReview, DuplicateReviewError } from '../lib/reviews/create';
import { recomputeProductAggregate } from '../lib/reviews/aggregate';
import { enqueueAggregateSync, enqueueReviewSyndication } from '../jobs/enqueue';
import { connection } from '../jobs/queue';

const SEED_LABEL = 'seed';

/**
 * Deliberately uneven.
 *
 * Every state in the brief is represented: a one-word review and a very long
 * one, a missing title, an unbroken URL, an emoji, a non-English body, a
 * 2-star among the 5s so the histogram has more than one bar, and names long
 * enough to test truncation. Uniform sample data would make the layout look
 * better than it is.
 */
const SEED: Array<{
  rating: number;
  title?: string;
  body: string;
  authorName: string;
  daysAgo: number;
}> = [
  {
    rating: 5,
    title: 'Amazing quality, fast delivery',
    body: 'The quality is fantastic and delivery was very fast. I ordered on a Tuesday and it arrived Thursday morning, well packed and exactly as pictured. I have already recommended it to two friends.',
    authorName: 'Sarah M.',
    daysAgo: 3,
  },
  { rating: 5, body: 'Perfect.', authorName: 'Tom', daysAgo: 5 },
  {
    rating: 4,
    title: 'Good, runs slightly small',
    body: 'Comfortable straight away and the material feels durable. Only note is that it runs slightly small — I would size up next time.',
    authorName: 'Priya Raghunathan-Venkatesh',
    daysAgo: 8,
  },
  {
    rating: 5,
    title: 'Exactly as described',
    body: 'Bought this after reading the spec page at https://example-store.myshopify.com/products/very-long-product-handle-for-testing and it matches completely. No surprises.',
    authorName: 'Daniel K.',
    daysAgo: 12,
  },
  {
    rating: 2,
    title: 'Not for me',
    body: 'Arrived on time and the build is fine, but it is heavier than I expected and I could not get on with it. Returns were handled quickly, to be fair.',
    authorName: 'Megan O.',
    daysAgo: 15,
  },
  {
    rating: 5,
    body: 'Sehr gute Qualität und schnelle Lieferung. Die Verarbeitungsqualität ist ausgezeichnet. 👌',
    authorName: 'Lukas B.',
    daysAgo: 19,
  },
  {
    rating: 4,
    title: 'Does the job',
    body: 'Solid for the price. Nothing flashy, but it has held up to daily use for a month now without any sign of wear.',
    authorName: 'Ana',
    daysAgo: 24,
  },
  {
    rating: 5,
    title: 'Second one I have bought',
    body: 'The colour has not faded at all on the first one after a year, so I bought another in a different shade. That is about the highest praise I can give.',
    authorName: 'Sam T.',
    daysAgo: 31,
  },
  {
    rating: 3,
    title: 'Fine, with caveats',
    body: 'It works. The instructions are thin and I had to look up a video to get it set up, which is why this is three stars rather than four. Once it was running I had no complaints.',
    authorName: 'Chris W.',
    daysAgo: 38,
  },
  {
    rating: 5,
    title: 'Better than the one it replaced',
    body: 'Replaced a much more expensive unit that died after eighteen months. This one is quieter, lighter and cost less than half. I genuinely cannot find anything to criticise about it, which is not something I say often in a review.',
    authorName: 'Fatima A.',
    daysAgo: 44,
  },
  { rating: 5, title: 'Love it', body: 'No notes. Would buy again.', authorName: 'Jo', daysAgo: 52 },
  {
    rating: 4,
    body: 'Good value. Shipping took a little longer than the estimate but customer service answered within the hour when I asked about it.',
    authorName: 'Ben Whitfield',
    daysAgo: 61,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes('--clean');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [shopDomain, handle] = positional;

  if (!shopDomain) {
    console.error('Usage: seed-reviews.ts <shop-domain> [product-handle]');
    console.error('       seed-reviews.ts --clean <shop-domain>');
    process.exit(1);
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
  });
  if (!store) {
    console.error(`No store named ${shopDomain}. Install the app on it first.`);
    process.exit(1);
  }

  if (clean) {
    const { count } = await prisma.review.deleteMany({
      where: { storeId: store.id, sourceLabel: SEED_LABEL },
    });
    console.log(`Deleted ${count} seeded review(s) from ${shopDomain}.`);

    // The aggregate is denormalised, so removing rows is not enough — the
    // product would keep advertising a rating it no longer has.
    const touched = await prisma.product.findMany({
      where: { storeId: store.id },
      select: { id: true },
    });
    for (const p of touched) {
      await recomputeProductAggregate({ storeId: store.id, productId: p.id });
      await enqueueAggregateSync({ storeId: store.id, productId: p.id });
    }
    console.log('Aggregates recomputed and queued for republish.');
    return;
  }

  const product = handle
    ? await prisma.product.findFirst({
        where: { storeId: store.id, handle },
        select: { id: true, title: true, handle: true },
      })
    : await prisma.product.findFirst({
        where: { storeId: store.id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, title: true, handle: true },
      });

  if (!product) {
    console.error(
      handle
        ? `No product with handle "${handle}" on ${shopDomain}.`
        : `No products synced for ${shopDomain} yet.`,
    );
    process.exit(1);
  }

  console.log(`Seeding ${SEED.length} reviews onto "${product.title}" (${product.handle})\n`);

  let created = 0;
  for (const [i, r] of SEED.entries()) {
    // One review per product per email is enforced in createReview, so each
    // seeded reviewer needs a distinct address.
    const email = `seed-${i + 1}@cited-seed.invalid`;
    try {
      const review = await createReview({
        storeId: store.id,
        productId: product.id,
        rating: r.rating,
        title: r.title ?? null,
        body: r.body,
        authorName: r.authorName,
        authorEmail: email,
        source: 'MANUAL',
        sourceLabel: SEED_LABEL,
        // These addresses match no order, so nothing here earns a verified
        // badge by accident — the badge stays a real signal.
        emailIsTrusted: false,
      });

      // Backdate, so the date column and the newest-first sort have a spread
      // to work with rather than twelve identical timestamps.
      const submittedAt = new Date(Date.now() - r.daysAgo * 86_400_000);
      await prisma.review.update({
        where: { id: review.id },
        data: { createdAt: submittedAt, submittedAt },
      });

      await enqueueReviewSyndication({ storeId: store.id, reviewId: review.id });
      created += 1;
      console.log(`  ${'★'.repeat(r.rating).padEnd(5)} ${r.title ?? '(no title)'}`);
    } catch (err) {
      if (err instanceof DuplicateReviewError) {
        console.log(`  skipped (already seeded): ${r.title ?? r.body.slice(0, 30)}`);
        continue;
      }
      throw err;
    }
  }

  await recomputeProductAggregate({ storeId: store.id, productId: product.id });
  await enqueueAggregateSync({ storeId: store.id, productId: product.id });

  console.log(`\nCreated ${created} review(s). Aggregate recomputed and queued.`);
  console.log('The storefront updates once the worker has published the metafields.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await connection.quit();
  });
