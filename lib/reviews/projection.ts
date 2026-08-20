import type { ReviewStatus, VerificationStatus } from '@prisma/client';
import type { AppVerificationStatus, ReviewMetaobjectInput } from '@/lib/shopify/metaobjects';
import { reviewMetaobjectHandle } from '@/lib/shopify/metaobject-payload';

/**
 * The single definition of what a review looks like as a Shopify metaobject.
 *
 * Two callers depend on this agreeing with itself: the syndication processor,
 * which writes the projection, and the reconcile processor, which compares
 * Shopify's stored copy against it to decide whether something changed the
 * metaobject behind our back. If the two built their inputs separately, every
 * benign difference between the two implementations would read as drift and
 * trigger a rewrite, which would emit another webhook, which would look like
 * drift again.
 */

/**
 * Prisma selection required to build the projection. Kept next to the builder
 * so adding a projected field can't silently produce `undefined` at the call
 * site that forgot to select it.
 */
export const REVIEW_PROJECTION_SELECT = {
  id: true,
  rating: true,
  title: true,
  body: true,
  authorName: true,
  orderShopifyGid: true,
  variantShopifyGid: true,
  merchantReply: true,
  language: true,
  submittedAt: true,
  publishedAt: true,
  verification: true,
  sourceLabel: true,
  status: true,
} as const;

/**
 * Structural, not `Prisma.ReviewGetPayload`. Any query that selects at least
 * these fields satisfies it, so callers stay free to select more without
 * fighting a generated type.
 */
export interface ProjectableReview {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
  orderShopifyGid: string | null;
  variantShopifyGid: string | null;
  merchantReply: string | null;
  language: string;
  submittedAt: Date;
  publishedAt: Date | null;
  verification: VerificationStatus;
  sourceLabel: string;
  status: ReviewStatus;
  product: { shopifyGid: string };
  media: Array<{ r2Key: string; url?: string | null }>;
}

const VERIFICATION_MAP: Record<VerificationStatus, AppVerificationStatus> = {
  VERIFIED_BUYER: 'verified_buyer',
  VERIFIED_REVIEWER: 'verified_reviewer',
  UNVERIFIED: 'unverified',
};

/**
 * Public URL for a stored media object.
 *
 * Returns null when R2 has no public base configured, so a half-provisioned
 * environment syndicates the review text without media rather than emitting
 * broken image URLs onto the merchant's storefront.
 */
export function mediaPublicUrl(r2Key: string): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/${r2Key}`;
}

/**
 * True when this review should exist as a live metaobject on the storefront.
 *
 * DELETED and SPAM lose their metaobject outright. PENDING and HIDDEN keep
 * one as a DRAFT so moderation can flip visibility without a create/delete
 * cycle — and without losing the handle, which is what makes our upserts
 * idempotent.
 */
export function shouldHaveMetaobject(status: ReviewStatus): boolean {
  return status !== 'DELETED' && status !== 'SPAM';
}

/** Expected publishable capability status for a review's metaobject. */
export function expectedPublishableStatus(review: {
  status: ReviewStatus;
  publishedAt: Date | null;
}): 'ACTIVE' | 'DRAFT' {
  return review.status === 'PUBLISHED' && review.publishedAt ? 'ACTIVE' : 'DRAFT';
}

export function reviewMetaobjectInput(review: ProjectableReview): ReviewMetaobjectInput {
  // An absolute URL wins over a derived one: Shopify Files hands back a CDN
  // URL we cannot rebuild from a key, so a stored url means the object does
  // not live in our bucket at all.
  const mediaUrls = review.media
    .map((m) => m.url ?? mediaPublicUrl(m.r2Key))
    .filter((u): u is string => u !== null);

  return {
    handle: reviewMetaobjectHandle(review.id),
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
  };
}
