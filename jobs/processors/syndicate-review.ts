import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import {
  upsertReviewMetaobject,
  deleteReviewMetaobject,
  MetaobjectError,
  type AppVerificationStatus,
} from '@/lib/shopify/metaobjects';
import type { SyndicationJobData, SyndicationJobName } from '../queue';

/**
 * Project one review into its Shopify `product_review` metaobject.
 *
 * Postgres is the source of truth; this makes Shopify eventually consistent
 * behind it. The projection is what the server-rendered theme block reads,
 * so a review that fails to syndicate is invisible on the storefront even
 * though it exists in our database — which makes syncStatus a user-visible
 * state, not an internal detail.
 */

const VERIFICATION_MAP: Record<string, AppVerificationStatus> = {
  VERIFIED_BUYER: 'verified_buyer',
  VERIFIED_REVIEWER: 'verified_reviewer',
  UNVERIFIED: 'unverified',
};

export async function syndicateReviewProcessor(
  job: Job<SyndicationJobData, unknown, SyndicationJobName>,
): Promise<void> {
  const { storeId, reviewId } = job.data;
  if (!reviewId) throw new Error('syndicate:review requires reviewId');

  const review = await prisma.review.findFirst({
    where: { id: reviewId, storeId },
    include: {
      product: { select: { shopifyGid: true } },
      media: {
        where: { moderation: 'APPROVED' },
        orderBy: { position: 'asc' },
        select: { r2Key: true, type: true },
      },
      store: {
        select: {
          id: true,
          shopDomain: true,
          accessToken: true,
          uninstalledAt: true,
          reviewScopeGranted: true,
        },
      },
    },
  });

  if (!review) {
    logger.warn({ storeId, reviewId }, 'Syndication skipped — review not found');
    return;
  }

  const store = review.store;
  if (store.uninstalledAt) {
    logger.warn({ storeId, reviewId }, 'Syndication skipped — store uninstalled');
    return;
  }

  // The restricted scope is not granted yet. Mark SKIPPED and return cleanly
  // rather than throwing: retrying cannot help, and burning six attempts per
  // review against a permission error would flood the DLQ on every store
  // until Shopify approves the app. See PLAN.md §5.2.1.
  if (!store.reviewScopeGranted) {
    await prisma.review.update({
      where: { id: review.id },
      data: { syncStatus: 'SKIPPED', syncError: 'write_product_reviews not yet granted' },
    });
    logger.debug({ storeId, reviewId }, 'Syndication skipped — review scope not granted');
    return;
  }

  const client = new ShopifyClient(store);

  try {
    // A review that is no longer publishable should not linger on the
    // storefront. Deleting is correct for DELETED/SPAM; PENDING and HIDDEN
    // keep their metaobject as a DRAFT so moderation can flip visibility
    // without a create/delete cycle (and without losing the handle).
    if (review.status === 'DELETED' || review.status === 'SPAM') {
      if (review.metaobjectGid) {
        await deleteReviewMetaobject(client, review.metaobjectGid);
      }
      await prisma.review.update({
        where: { id: review.id },
        data: { metaobjectGid: null, syncStatus: 'SYNCED', syncedAt: new Date(), syncError: null },
      });
      logger.info({ storeId, reviewId, status: review.status }, 'Review metaobject removed');
      return;
    }

    const mediaUrls = review.media
      .map((m) => mediaPublicUrl(m.r2Key))
      .filter((u): u is string => u !== null);

    const { metaobjectGid } = await upsertReviewMetaobject(client, {
      handle: metaobjectHandle(review.id),
      productGid: review.product.shopifyGid,
      rating: review.rating,
      submittedAt: review.submittedAt,
      verification: VERIFICATION_MAP[review.verification] ?? 'unverified',
      source: review.sourceLabel,
      title: review.title,
      body: review.body,
      author: review.authorName,
      orderGid: review.orderShopifyGid,
      variantGid: review.variantShopifyGid,
      merchantReply: review.merchantReply,
      language: review.language,
      mediaUrls,
      publishedAt: review.status === 'PUBLISHED' ? review.publishedAt : null,
    });

    await prisma.review.update({
      where: { id: review.id },
      data: {
        metaobjectGid,
        syncStatus: 'SYNCED',
        syncedAt: new Date(),
        syncError: null,
        syncAttempts: { increment: 1 },
      },
    });

    logger.info({ storeId, reviewId, metaobjectGid }, 'Review syndicated');
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    const terminal = err instanceof MetaobjectError && err.terminal;

    await prisma.review.update({
      where: { id: review.id },
      data: {
        syncStatus: 'FAILED',
        syncError: message,
        syncAttempts: { increment: 1 },
      },
    });

    if (terminal) {
      // Do not rethrow: BullMQ would retry a request that can never succeed.
      // The FAILED row is the durable record, and it surfaces in the admin.
      logger.error({ storeId, reviewId, err: message }, 'Review syndication failed permanently');
      return;
    }
    throw err;
  }
}

/**
 * Metaobject handles are constrained to lowercase alphanumerics and dashes.
 * cuid() satisfies that already, but normalising here means an imported
 * review carrying a foreign ID format can never produce an invalid handle.
 */
function metaobjectHandle(reviewId: string): string {
  return `cited-${reviewId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

/**
 * Public URL for a stored media object.
 *
 * Returns null when R2 has no public base configured, so a half-provisioned
 * environment syndicates the review text without media rather than emitting
 * broken image URLs onto the merchant's storefront.
 */
function mediaPublicUrl(r2Key: string): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${r2Key}`;
}
