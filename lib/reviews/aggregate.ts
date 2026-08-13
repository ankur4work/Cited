import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Recompute a product's rating aggregate from published reviews.
 *
 * Denormalised onto Product because the storefront reads it on every product
 * page render; an aggregate query per page view would be the slowest thing
 * in the app.
 *
 * Review groups complicate this. When products share a pool (variants,
 * bundles, a relaunched SKU), every product in the group must show the
 * group's combined rating — otherwise splitting a product into two listings
 * silently halves its social proof. So the read set is "reviews on any
 * product in my group", not "reviews on me".
 */

export interface AggregateResult {
  ratingAvg: number;
  ratingCount: number;
  ratingBreakdown: Record<string, number>;
  /** Every product whose denormalised aggregate this write updated. */
  affectedProductIds: string[];
}

export async function recomputeProductAggregate(input: {
  storeId: string;
  productId: string;
}): Promise<AggregateResult | null> {
  const { storeId, productId } = input;

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true, groupId: true },
  });

  if (!product) {
    logger.warn({ storeId, productId }, 'Aggregate recompute skipped — product not found');
    return null;
  }

  // Products sharing this pool. Ungrouped products are a pool of one.
  const poolProductIds = product.groupId
    ? (
        await prisma.product.findMany({
          where: { storeId, groupId: product.groupId },
          select: { id: true },
        })
      ).map((p) => p.id)
    : [product.id];

  const grouped = await prisma.review.groupBy({
    by: ['rating'],
    where: {
      storeId,
      productId: { in: poolProductIds },
      status: 'PUBLISHED',
      publishedAt: { not: null },
    },
    _count: { rating: true },
  });

  const breakdown: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  let total = 0;
  let sum = 0;

  for (const row of grouped) {
    const count = row._count.rating;
    breakdown[String(row.rating)] = count;
    total += count;
    sum += row.rating * count;
  }

  // Round to 2dp for storage. The storefront rounds again for display, but
  // the stored value must match what we emit in JSON-LD — a visible 4.5
  // beside a structured-data 4.4732 is a schema mismatch Google flags.
  const avg = total > 0 ? Math.round((sum / total) * 100) / 100 : 0;

  await prisma.product.updateMany({
    where: { id: { in: poolProductIds }, storeId },
    data: { ratingAvg: avg, ratingCount: total, ratingBreakdown: breakdown },
  });

  logger.debug(
    { storeId, productId, poolSize: poolProductIds.length, avg, total },
    'Product aggregate recomputed',
  );

  return {
    ratingAvg: avg,
    ratingCount: total,
    ratingBreakdown: breakdown,
    affectedProductIds: poolProductIds,
  };
}
