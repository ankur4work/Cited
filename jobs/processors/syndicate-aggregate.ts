import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import { setProductRatingMetafields, MetaobjectError } from '@/lib/shopify/metaobjects';
import { recomputeProductAggregate } from '@/lib/reviews/aggregate';
import type { SyndicationJobData, SyndicationJobName } from '../queue';

/**
 * Recompute a product's rating aggregate and push it to the
 * `reviews.rating` / `reviews.rating_count` product metafields.
 *
 * Two distinct jobs on purpose. Recomputing locally is cheap and must always
 * happen, because our own storefront rendering and admin read the
 * denormalised columns. Pushing to Shopify is the part that needs the
 * restricted scope and can fail. Splitting them means a store awaiting
 * Shopify approval still gets correct local aggregates.
 *
 * Enqueued with a delay so a burst of reviews on one product produces one
 * aggregate write rather than one per review (see enqueueAggregateSync).
 */
export async function syndicateAggregateProcessor(
  job: Job<SyndicationJobData, unknown, SyndicationJobName>,
): Promise<void> {
  const { storeId, productId } = job.data;
  if (!productId) throw new Error('syndicate:aggregate requires productId');

  const result = await recomputeProductAggregate({ storeId, productId });
  if (!result) return;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      shopDomain: true,
      accessToken: true,
      uninstalledAt: true,
      reviewScopeGranted: true,
    },
  });

  if (!store || store.uninstalledAt) return;

  if (!store.reviewScopeGranted) {
    logger.debug(
      { storeId, productId },
      'Aggregate recomputed locally; metafield push skipped — review scope not granted',
    );
    return;
  }

  // The recompute may span a review group, so every product in the pool
  // needs its metafields refreshed, not just the one that triggered this.
  const products = await prisma.product.findMany({
    where: { id: { in: result.affectedProductIds }, storeId },
    select: { id: true, shopifyGid: true },
  });

  const client = new ShopifyClient(store);

  for (const product of products) {
    try {
      await setProductRatingMetafields(client, {
        productGid: product.shopifyGid,
        ratingAvg: result.ratingAvg,
        ratingCount: result.ratingCount,
      });
    } catch (err) {
      if (err instanceof MetaobjectError && err.terminal) {
        logger.error(
          { storeId, productId: product.id, err: err.message },
          'Rating metafield write failed permanently',
        );
        continue;
      }
      throw err;
    }
  }

  logger.info(
    {
      storeId,
      productId,
      ratingAvg: result.ratingAvg,
      ratingCount: result.ratingCount,
      products: products.length,
    },
    'Rating aggregate syndicated',
  );
}
