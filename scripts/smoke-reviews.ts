/**
 * Review pipeline smoke test.
 *
 * Exercises the real logic against the real database: verified-buyer
 * matching, duplicate rejection, spam routing, aggregate maths and
 * review-group sharing. None of it needs Shopify, which is the point —
 * these are the rules that decide what a shopper sees, so they should be
 * provable without a store.
 *
 * Creates an isolated store and deletes it at the end (cascade cleans up).
 *
 * Run: pnpm tsx --env-file=.env scripts/smoke-reviews.ts
 */
import { prisma } from '../lib/prisma';
import { encrypt, hashEmail } from '../lib/crypto';
import { createReview, DuplicateReviewError } from '../lib/reviews/create';
import { recomputeProductAggregate } from '../lib/reviews/aggregate';
import { connection } from '../jobs/queue';

let failures = 0;
const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m: string) => {
  failures += 1;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
};
const eq = (actual: unknown, expected: unknown, label: string) =>
  actual === expected ? ok(`${label} → ${String(actual)}`) : bad(`${label}: got ${String(actual)}, expected ${String(expected)}`);

async function main() {
  const shopDomain = `smoke-reviews-${Date.now()}.myshopify.com`;
  const store = await prisma.store.create({ data: { shopDomain } });

  const [pA, pB, pC] = await Promise.all([
    prisma.product.create({
      data: { storeId: store.id, shopifyGid: 'gid://shopify/Product/A', handle: 'a', title: 'Product A' },
    }),
    prisma.product.create({
      data: { storeId: store.id, shopifyGid: 'gid://shopify/Product/B', handle: 'b', title: 'Product B' },
    }),
    prisma.product.create({
      data: { storeId: store.id, shopifyGid: 'gid://shopify/Product/C', handle: 'c', title: 'Product C' },
    }),
  ]);

  // A buyer who purchased product A only.
  const buyer = 'buyer@example.com';
  const order = await prisma.order.create({
    data: {
      storeId: store.id,
      shopifyGid: 'gid://shopify/Order/1001',
      customerEmailEnc: encrypt(buyer),
      customerEmailHash: hashEmail(buyer),
      processedAt: new Date(),
    },
  });
  await prisma.orderLineItem.create({
    data: {
      storeId: store.id,
      orderId: order.id,
      productId: pA.id,
      productShopifyGid: pA.shopifyGid,
      title: 'Product A',
      quantity: 1,
    },
  });

  console.log('\nVerification');

  const r1 = await createReview({
    storeId: store.id,
    productId: pA.id,
    rating: 5,
    body: 'Bought this, love it.',
    authorEmail: buyer,
  });
  eq(r1.verification, 'VERIFIED_BUYER', 'purchased this product');
  eq(r1.orderShopifyGid, order.shopifyGid, 'order linked to review');

  const r2 = await createReview({
    storeId: store.id,
    productId: pB.id,
    rating: 4,
    body: 'Known customer, different product.',
    authorEmail: buyer,
  });
  eq(r2.verification, 'VERIFIED_REVIEWER', 'known email, did not buy this product');

  const r3 = await createReview({
    storeId: store.id,
    productId: pA.id,
    rating: 3,
    body: 'Never bought anything here.',
    authorEmail: 'stranger@example.com',
  });
  eq(r3.verification, 'UNVERIFIED', 'unknown email');

  console.log('\nDuplicate protection');
  try {
    await createReview({
      storeId: store.id,
      productId: pA.id,
      rating: 1,
      body: 'Second review, same product, same person.',
      authorEmail: buyer,
    });
    bad('duplicate review was accepted');
  } catch (e) {
    if (e instanceof DuplicateReviewError) ok('duplicate rejected');
    else bad(`wrong error for duplicate: ${(e as Error).message}`);
  }

  console.log('\nSpam routing');
  const spam = await createReview({
    storeId: store.id,
    productId: pC.id,
    rating: 5,
    body: 'Cheap deals at https://spam.example.com aaaaaaaaaaaaaaaaaaaa',
    authorEmail: 'spammer@example.com',
  });
  eq(spam.status, 'PENDING', 'link + repetition held for moderation');
  if (spam.fraudReasons.includes('contains_link')) ok('flagged contains_link');
  else bad(`missing contains_link, got: ${spam.fraudReasons.join(',')}`);

  console.log('\nAggregates');
  // Product A has one PUBLISHED 5 and one PUBLISHED 3.
  const aggA = await recomputeProductAggregate({ storeId: store.id, productId: pA.id });
  eq(aggA?.ratingCount, 2, 'product A count');
  eq(aggA?.ratingAvg, 4, 'product A average');

  // Pending spam must NOT count toward the aggregate.
  const aggC = await recomputeProductAggregate({ storeId: store.id, productId: pC.id });
  eq(aggC?.ratingCount, 0, 'pending review excluded from aggregate');

  console.log('\nReview groups');
  const group = await prisma.reviewGroup.create({
    data: { storeId: store.id, name: 'A+B shared pool' },
  });
  await prisma.product.updateMany({
    where: { id: { in: [pA.id, pB.id] } },
    data: { groupId: group.id },
  });

  const aggGrouped = await recomputeProductAggregate({ storeId: store.id, productId: pA.id });
  // A(5,3) + B(4) = 3 reviews, mean 4.0
  eq(aggGrouped?.ratingCount, 3, 'grouped count pools both products');
  eq(aggGrouped?.ratingAvg, 4, 'grouped average');

  const bRow = await prisma.product.findUnique({
    where: { id: pB.id },
    select: { ratingCount: true },
  });
  eq(bRow?.ratingCount, 3, 'sibling product received the pooled aggregate');

  console.log('\nSync state');
  const pending = await prisma.review.count({
    where: { storeId: store.id, syncStatus: 'PENDING' },
  });
  eq(pending, 4, 'all reviews queued for syndication');

  // Cleanup.
  await prisma.store.delete({ where: { id: store.id } });

  console.log(
    failures === 0
      ? '\n\x1b[32mReview pipeline checks passed.\x1b[0m\n'
      : `\n\x1b[31m${failures} check(s) failed.\x1b[0m\n`,
  );

  await prisma.$disconnect();
  await connection.quit();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await connection.quit();
  process.exit(1);
});
