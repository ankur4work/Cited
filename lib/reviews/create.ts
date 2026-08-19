import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { encrypt, hashEmail } from '@/lib/crypto';
import { enqueueReviewSyndication, enqueueAggregateSync } from '@/jobs/enqueue';
import type { Review, VerificationStatus } from '@prisma/client';

/**
 * Review submission.
 *
 * Single entry point for every source — storefront form, email one-click,
 * import, merchant-entered — so verification, spam scoring and the
 * downstream projection can never be bypassed by adding a new caller.
 */

export interface CreateReviewInput {
  storeId: string;
  productId: string;
  rating: number;
  title?: string | null;
  body?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
  language?: string;
  /** Raw IP and UA — hashed here, never stored in the clear. */
  ip?: string | null;
  userAgent?: string | null;
  /** Set when the review came from a verified email link rather than a form. */
  trustedOrderGid?: string | null;
  /**
   * Did we establish this email, or did someone type it into a public form?
   *
   * Defaults to true because every original caller — import, merchant entry,
   * one-click email link — supplies an address the store already held. The
   * anonymous storefront form is the exception and passes false: there, the
   * email is an unauthenticated claim, and matching it against orders would
   * hand out "Verified purchase" to anyone who can guess a customer's address.
   */
  emailIsTrusted?: boolean;
  source?: 'NATIVE' | 'IMPORT' | 'SYNDICATED' | 'MANUAL';
  sourceLabel?: string;
}

export class ReviewValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ReviewValidationError';
  }
}

export class DuplicateReviewError extends Error {
  constructor() {
    super('A review for this product from this email already exists');
    this.name = 'DuplicateReviewError';
  }
}

/** Salted one-way hash for abuse signals we never need to reverse. */
function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/**
 * Verified-buyer determination.
 *
 * verified_buyer requires a real order for THIS product by THIS email.
 * verified_reviewer means we know who they are but not that they bought the
 * item. Getting this wrong in the generous direction is the worst option
 * available: a "verified buyer" badge on an unverified review is exactly the
 * kind of thing that destroys the trust the whole product sells.
 */
async function determineVerification(input: {
  storeId: string;
  productId: string;
  emailHash: string | null;
  trustedOrderGid?: string | null;
  emailIsTrusted: boolean;
}): Promise<{ verification: VerificationStatus; orderGid: string | null }> {
  if (input.trustedOrderGid) {
    return { verification: 'VERIFIED_BUYER', orderGid: input.trustedOrderGid };
  }
  if (!input.emailHash) {
    return { verification: 'UNVERIFIED', orderGid: null };
  }
  // An untrusted address proves nothing, so it earns no badge. The review is
  // still stored with its hash — dedup and any later email confirmation both
  // need it — it simply cannot promote itself past UNVERIFIED.
  if (!input.emailIsTrusted) {
    return { verification: 'UNVERIFIED', orderGid: null };
  }

  const match = await prisma.order.findFirst({
    where: {
      storeId: input.storeId,
      customerEmailHash: input.emailHash,
      cancelledAt: null,
      lineItems: { some: { productId: input.productId } },
    },
    orderBy: { processedAt: 'desc' },
    select: { shopifyGid: true },
  });

  if (match) return { verification: 'VERIFIED_BUYER', orderGid: match.shopifyGid };

  // Known email, no purchase of this product.
  const anyOrder = await prisma.order.findFirst({
    where: { storeId: input.storeId, customerEmailHash: input.emailHash },
    select: { id: true },
  });

  return {
    verification: anyOrder ? 'VERIFIED_REVIEWER' : 'UNVERIFIED',
    orderGid: null,
  };
}

/**
 * Heuristic abuse score, 0..1. Deliberately conservative: it routes a review
 * to moderation, it never rejects one outright. A false positive costs the
 * merchant a click; a false negative publishes spam on their storefront.
 */
async function scoreForAbuse(input: {
  storeId: string;
  ipHash: string | null;
  body?: string | null;
}): Promise<{ score: number; reasons: string[] }> {
  const reasons: string[] = [];
  let score = 0;

  if (input.ipHash) {
    const recent = await prisma.review.count({
      where: {
        storeId: input.storeId,
        ipHash: input.ipHash,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recent >= 3) {
      score += 0.5;
      reasons.push(`velocity:${recent}/hour`);
    }
  }

  const body = input.body ?? '';
  if (/https?:\/\//i.test(body)) {
    score += 0.3;
    reasons.push('contains_link');
  }
  if (body.length > 20 && /(.)\1{9,}/.test(body)) {
    score += 0.2;
    reasons.push('repeated_characters');
  }

  return { score: Math.min(score, 1), reasons };
}

export async function createReview(input: CreateReviewInput): Promise<Review> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new ReviewValidationError('Rating must be an integer from 1 to 5', 'rating');
  }
  if (input.body && input.body.length > 10_000) {
    throw new ReviewValidationError('Review body is too long', 'body');
  }

  const product = await prisma.product.findFirst({
    where: { id: input.productId, storeId: input.storeId },
    select: { id: true },
  });
  if (!product) throw new ReviewValidationError('Unknown product', 'productId');

  const emailHash = input.authorEmail ? hashEmail(input.authorEmail) : null;

  // One review per product per email. Checked before insert for a clean
  // error message; the caller may still race, which is fine — this is a UX
  // guard, not an integrity guarantee.
  if (emailHash) {
    const existing = await prisma.review.findFirst({
      where: {
        storeId: input.storeId,
        productId: input.productId,
        authorEmailHash: emailHash,
        status: { notIn: ['DELETED'] },
      },
      select: { id: true },
    });
    if (existing) throw new DuplicateReviewError();
  }

  const ipHash = input.ip ? digest(input.ip) : null;
  const [{ verification, orderGid }, abuse] = await Promise.all([
    determineVerification({
      storeId: input.storeId,
      productId: input.productId,
      emailHash,
      trustedOrderGid: input.trustedOrderGid,
      emailIsTrusted: input.emailIsTrusted !== false,
    }),
    scoreForAbuse({ storeId: input.storeId, ipHash, body: input.body }),
  ]);

  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { settings: true },
  });
  const settings = (store?.settings ?? {}) as { autoPublish?: boolean };
  const autoPublish = settings.autoPublish !== false;

  // Suspicious reviews always go to moderation regardless of the merchant's
  // auto-publish preference — auto-publish is a convenience setting, not a
  // reason to put likely spam on a storefront.
  const publish = autoPublish && abuse.score < 0.5;

  const review = await prisma.review.create({
    data: {
      storeId: input.storeId,
      productId: input.productId,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body ?? null,
      authorName: input.authorName ?? null,
      authorEmailEnc: input.authorEmail ? encrypt(input.authorEmail) : null,
      authorEmailHash: emailHash,
      orderShopifyGid: orderGid,
      language: input.language ?? 'en',
      verification,
      source: input.source ?? 'NATIVE',
      sourceLabel: input.sourceLabel ?? 'cited',
      status: publish ? 'PUBLISHED' : 'PENDING',
      publishedAt: publish ? new Date() : null,
      ipHash,
      userAgentHash: input.userAgent ? digest(input.userAgent) : null,
      fraudScore: abuse.score,
      fraudReasons: abuse.reasons,
    },
  });

  // Projection and aggregate are queued, never awaited inline: the reviewer
  // gets their confirmation immediately, and a Shopify outage delays the
  // storefront update rather than losing the review.
  await enqueueReviewSyndication({ storeId: input.storeId, reviewId: review.id });
  if (publish) {
    await enqueueAggregateSync({ storeId: input.storeId, productId: input.productId });
  }

  logger.info(
    {
      storeId: input.storeId,
      reviewId: review.id,
      rating: review.rating,
      verification,
      published: publish,
      fraudScore: abuse.score,
    },
    'Review created',
  );

  return review;
}
