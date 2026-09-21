import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import { setStorefrontDigest } from '@/lib/shopify/shop-metafields';
import { publicAuthorName } from '@/lib/reviews/author-name';
import type { MaintenanceJobData } from '../queue';

/**
 * Publish store-wide review data for the widgets that have no product.
 *
 * A carousel on the home page, a testimonial strip in a footer, a review
 * counter in a header: none of them have a `product` in scope, so the
 * per-product metafields the product block reads are of no use to them. There
 * is no request to our server in the storefront path either, which is the
 * whole point of the architecture. So the data has to be on the shop.
 *
 * Denormalised into ONE metafield rather than metaobject references. These
 * blocks render a quote and a name; resolving fifty metaobject references in
 * Liquid to show twelve short quotes would cost a great deal for nothing, and
 * the review text is already public on the product page.
 */

/** Enough to fill a carousel without bloating every page's HTML. */
const DIGEST_SIZE = 12;

/** A quote longer than this is a paragraph, not a pull quote. */
const MAX_QUOTE = 240;

export async function storefrontDigestProcessor(
  job: Job<MaintenanceJobData, unknown, 'storefront:digest'>,
): Promise<void> {
  const storeId = job.data.storeId;
  if (!storeId) return;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, shopDomain: true, accessToken: true, uninstalledAt: true },
  });
  if (!store || store.uninstalledAt) return;

  // Store-wide aggregate, computed from reviews rather than by averaging the
  // per-product averages — a product with one 5-star review would otherwise
  // weigh as heavily as one with four hundred.
  const totals = await prisma.review.aggregate({
    where: { storeId, status: 'PUBLISHED', publishedAt: { not: null } },
    _count: { _all: true },
    _avg: { rating: true },
  });

  const count = totals._count._all;
  const avg = totals._avg.rating ?? 0;

  const top = await prisma.review.findMany({
    where: {
      storeId,
      status: 'PUBLISHED',
      publishedAt: { not: null },
      // A carousel of ratings with no words is a carousel of nothing.
      body: { not: null },
      // Only reviews a shopper would be glad to have surfaced. The widgets
      // that read this are promotional by nature, so the floor is explicit
      // rather than "whatever sorts highest".
      rating: { gte: 4 },
    },
    orderBy: [{ relevanceScore: 'desc' }, { publishedAt: 'desc' }],
    take: DIGEST_SIZE,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      publishedAt: true,
      verification: true,
      product: { select: { title: true, handle: true, imageUrl: true } },
      media: {
        where: { moderation: 'APPROVED' },
        orderBy: { position: 'asc' },
        take: 1,
        select: { url: true },
      },
    },
  });

  const digest = {
    rating: Math.round(avg * 100) / 100,
    count,
    reviews: top.map((r) => ({
      rating: r.rating,
      title: r.title ?? '',
      // Truncated here rather than in Liquid: this value is embedded in every
      // page that renders the widget, and shipping full review bodies in the
      // HTML of a home page is a real weight for text nobody will read.
      body: (r.body ?? '').slice(0, MAX_QUOTE),
      // Never the email — see publicAuthorName. Shared with the other
      // publication paths so one rule governs every public surface.
      author: publicAuthorName(r.authorName) ?? '',
      date: r.publishedAt ? r.publishedAt.toISOString().slice(0, 10) : '',
      verified: r.verification === 'VERIFIED_BUYER',
      product: r.product?.title ?? '',
      handle: r.product?.handle ?? '',
      image: r.media[0]?.url ?? r.product?.imageUrl ?? '',
    })),
  };

  await setStorefrontDigest(new ShopifyClient(store), digest);

  logger.info(
    { storeId, shopDomain: store.shopDomain, count, quotes: digest.reviews.length },
    'Storefront digest published',
  );
}
