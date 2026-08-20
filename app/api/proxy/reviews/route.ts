import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { publicRateLimit } from '@/lib/rate-limit';
import { verifyAppProxyRequest } from '@/lib/shopify/app-proxy';
import { ShopifyClient } from '@/lib/shopify/client';
import {
  createReview,
  DuplicateReviewError,
  ReviewValidationError,
} from '@/lib/reviews/create';
import {
  uploadReviewImage,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_REVIEW,
} from '@/lib/shopify/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Storefront review submission.
 *
 * Reached from the theme block's form at `/apps/cited/reviews` on the
 * merchant's own domain, which Shopify proxies here. Same-origin and
 * server-rendered, so the form works with JavaScript disabled — the block's
 * whole reason for existing is that it does not depend on a script, and a
 * submit path that did would give that back.
 *
 * Everything on this request except the signature and `logged_in_customer_id`
 * is attacker-controlled. The three things that follow from that:
 *   * the signature is checked before anything else touches the database
 *   * the shop comes from the signed query, never from the body
 *   * a typed email is treated as a claim, not as identity (see below)
 */

/** Longest field values we will accept before rejecting outright. */
const MAX_TITLE = 200;
const MAX_BODY = 5_000;
const MAX_NAME = 100;

interface Submission {
  productId: string;
  rating: number;
  title: string;
  body: string;
  authorName: string;
  authorEmail: string;
  honeypot: string;
  returnPath: string;
}

async function readSubmission(
  req: NextRequest,
): Promise<{ fields: Submission; wantsJson: boolean; photos: File[] }> {
  const contentType = req.headers.get('content-type') ?? '';
  const wantsJson =
    contentType.includes('application/json') ||
    (req.headers.get('accept') ?? '').includes('application/json');

  let get: (key: string) => string;
  const photos: File[] = [];
  if (contentType.includes('application/json')) {
    const parsed = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    get = (key) => (typeof parsed[key] === 'string' ? (parsed[key] as string) : String(parsed[key] ?? ''));
  } else {
    const form = await req.formData();
    get = (key) => {
      const value = form.get(key);
      return typeof value === 'string' ? value : '';
    };
    // Capped here rather than later: an unbounded loop over attacker-supplied
    // parts is the cost, not the upload itself. Empty parts are what a browser
    // sends for an untouched file input.
    for (const entry of form.getAll('photos')) {
      if (entry instanceof File && entry.size > 0 && photos.length < MAX_IMAGES_PER_REVIEW) {
        photos.push(entry);
      }
    }
  }

  return {
    wantsJson,
    photos,
    fields: {
      productId: get('product_id').trim(),
      rating: Number.parseInt(get('rating'), 10),
      title: get('title').trim().slice(0, MAX_TITLE),
      body: get('body').trim().slice(0, MAX_BODY),
      authorName: get('author_name').trim().slice(0, MAX_NAME),
      authorEmail: get('author_email').trim().toLowerCase().slice(0, 254),
      honeypot: get('website').trim(),
      returnPath: get('return_path').trim(),
    },
  };
}

/**
 * A signed-in shopper's real address, straight from Shopify.
 *
 * This is the only way a storefront submission can earn a verified badge:
 * Shopify vouches for who the visitor is, and we look the address up rather
 * than believing the form. Failure is not fatal — the review is still accepted,
 * just without the elevated trust.
 */
async function trustedCustomer(
  store: { id: string; shopDomain: string },
  customerId: string,
): Promise<{ email: string | null; name: string | null } | null> {
  try {
    const res = await new ShopifyClient(store).graphql<{
      customer: { email: string | null; displayName: string | null; firstName: string | null } | null;
    }>(
      `query CitedProxyCustomer($id: ID!) {
         customer(id: $id) { email displayName firstName }
       }`,
      { id: `gid://shopify/Customer/${customerId}` },
    );
    const customer = res.data?.customer;
    if (!customer) return null;
    return {
      email: customer.email?.toLowerCase() ?? null,
      // First name alone by preference: a review signed "Priya" reads like a
      // person, and publishing a shopper's full surname next to a purchase is
      // more than they agreed to when they created an account.
      name: customer.firstName || customer.displayName || null,
    };
  } catch (err) {
    logger.warn(
      { shop: store.shopDomain, err: (err as Error).message },
      'Could not resolve logged-in customer for review verification',
    );
    return null;
  }
}

/**
 * Store review photos in the merchant's Shopify Files and record them.
 *
 * Never throws. The review is already committed by the time this runs, and a
 * storage problem is not a reason to tell someone their review failed — they
 * would resubmit, hit the one-per-product constraint, and conclude the app is
 * broken. Failures are logged; what uploaded is kept.
 */
async function attachPhotos(
  store: { id: string; shopDomain: string },
  reviewId: string,
  photos: File[],
): Promise<string[]> {
  if (photos.length === 0) return [];

  const client = new ShopifyClient(store);
  const urls: string[] = [];
  let position = 0;

  for (const photo of photos.slice(0, MAX_IMAGES_PER_REVIEW)) {
    if (!ALLOWED_IMAGE_TYPES.includes(photo.type) || photo.size > MAX_IMAGE_BYTES) {
      logger.info(
        { shop: store.shopDomain, reviewId, type: photo.type, size: photo.size },
        'Review photo rejected before upload',
      );
      continue;
    }

    try {
      const uploaded = await uploadReviewImage(client, {
        filename: photo.name,
        mimeType: photo.type,
        bytes: Buffer.from(await photo.arrayBuffer()),
      });

      await prisma.reviewMedia.create({
        data: {
          storeId: store.id,
          reviewId,
          type: 'IMAGE',
          // The GID is the durable handle; the URL can still be resolved from
          // it if Shopify was mid-processing when we asked.
          r2Key: uploaded.fileGid,
          url: uploaded.url,
          width: uploaded.width,
          height: uploaded.height,
          bytes: BigInt(photo.size),
          mimeType: photo.type,
          moderation: 'APPROVED',
          position: position++,
        },
      });

      if (uploaded.url) urls.push(uploaded.url);
    } catch (err) {
      logger.error(
        { shop: store.shopDomain, reviewId, err: (err as Error).message },
        'Review photo upload failed — review kept without it',
      );
    }
  }

  return urls;
}

/** Rendered by Shopify inside the merchant's own theme layout. */
function liquidResponse(status: number, heading: string, message: string, returnPath: string) {
  const back = returnPath.startsWith('/') ? returnPath : '/';
  return new NextResponse(
    `<div class="cited-reviews cited-reviews--notice">
  <h2 class="cited-reviews__heading">${escapeHtml(heading)}</h2>
  <p>${escapeHtml(message)}</p>
  <p><a href="${escapeHtml(back)}">Back to the product</a></p>
</div>`,
    { status, headers: { 'Content-Type': 'application/liquid; charset=utf-8' } },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function POST(req: NextRequest) {
  const context = verifyAppProxyRequest(new URL(req.url));
  if (!context) {
    // Deliberately terse: an unsigned caller learns nothing about why.
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const limit = await publicRateLimit(req, 'review-submit');
  if (!limit.ok) return limit.response;

  const { fields, wantsJson, photos } = await readSubmission(req);

  /*
   * Reviews require a customer account.
   *
   * The theme hides the form from signed-out visitors, but the form is not the
   * gate — this is. Everything a signed-out shopper could tell us about
   * themselves is an unverifiable claim, which makes "one review per customer"
   * unenforceable, "verified purchase" meaningless, and photo upload an open
   * door to anyone who finds this URL.
   */
  if (!context.loggedInCustomerId) {
    const message = 'Please sign in to your account to write a review.';
    return wantsJson
      ? NextResponse.json({ error: message, requiresLogin: true }, { status: 401 })
      : liquidResponse(401, 'Sign in to review', message, fields.returnPath);
  }

  // Honeypot: a field no human sees and every naive bot fills. Answered with
  // the same success surface a real submission gets, so the bot cannot tell it
  // was caught and start probing for what gave it away.
  if (fields.honeypot) {
    logger.info({ shop: context.shop }, 'Review submission rejected by honeypot');
    return wantsJson
      ? NextResponse.json({ ok: true })
      : liquidResponse(200, 'Thanks for your review', 'It has been received.', fields.returnPath);
  }

  const store = await prisma.store.findFirst({
    where: { shopDomain: context.shop, uninstalledAt: null },
    select: { id: true, shopDomain: true },
  });
  if (!store) {
    return wantsJson
      ? NextResponse.json({ error: 'store not found' }, { status: 404 })
      : liquidResponse(404, 'Reviews unavailable', 'This store is not set up for reviews.', fields.returnPath);
  }

  // The form sends the numeric id Liquid exposes as `product.id`.
  const numericId = fields.productId.replace(/^gid:\/\/shopify\/Product\//, '');
  const product = /^\d+$/.test(numericId)
    ? await prisma.product.findFirst({
        where: { storeId: store.id, shopifyGid: `gid://shopify/Product/${numericId}` },
        select: { id: true, handle: true },
      })
    : null;

  if (!product) {
    return wantsJson
      ? NextResponse.json({ error: 'unknown product' }, { status: 400 })
      : liquidResponse(400, 'Review not saved', 'We could not match this product.', fields.returnPath);
  }

  let email = fields.authorEmail || null;
  let name = fields.authorName || null;
  let emailIsTrusted = false;
  if (context.loggedInCustomerId) {
    const known = await trustedCustomer(store, context.loggedInCustomerId);
    if (known?.email) {
      // Shopify's answer wins over anything posted here. A signed-in shopper
      // is not asked for their name or address at all, so this is also the
      // only place those values can come from.
      email = known.email;
      name = known.name ?? name;
      emailIsTrusted = true;
    }
  }

  try {
    const review = await createReview({
      storeId: store.id,
      productId: product.id,
      rating: fields.rating,
      title: fields.title || null,
      body: fields.body || null,
      authorName: name,
      authorEmail: email,
      emailIsTrusted,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
      source: 'NATIVE',
      sourceLabel: 'cited:storefront',
    });

    // Photos are attached after the review exists, and a failure here never
    // costs the shopper their words: the review is already saved, so a photo
    // that will not upload is logged and dropped rather than rolled back into
    // "your review could not be saved".
    const photoUrls = await attachPhotos(store, review.id, photos);

    const pending = review.status !== 'PUBLISHED';
    const message = pending
      ? 'Thanks — your review has been sent to the store for approval.'
      : 'Thanks — your review is now live on this product.';

    logger.info(
      { shop: store.shopDomain, reviewId: review.id, verified: review.verification, pending },
      'Storefront review submitted',
    );

    // The rendered review comes back with the response so the page can show it
    // immediately. Syndication to Shopify is queued and takes a moment, and
    // the product metafield the block reads from will not have caught up yet —
    // so without this the shopper submits and appears to have changed nothing.
    //
    // Only what is already public: no email, no IP, no fraud score.
    const rendered = pending
      ? null
      : {
          rating: review.rating,
          body: review.body,
          author: review.authorName || null,
          submittedAt: review.submittedAt.toISOString(),
          verified: review.verification === 'VERIFIED_BUYER',
          photos: photoUrls,
        };

    return wantsJson
      ? NextResponse.json({ ok: true, pending, message, review: rendered })
      : liquidResponse(200, 'Thanks for your review', message, fields.returnPath);
  } catch (err) {
    if (err instanceof DuplicateReviewError) {
      const message = 'You have already reviewed this product.';
      return wantsJson
        ? NextResponse.json({ error: message }, { status: 409 })
        : liquidResponse(409, 'Already reviewed', message, fields.returnPath);
    }
    if (err instanceof ReviewValidationError) {
      return wantsJson
        ? NextResponse.json({ error: err.message, field: err.field }, { status: 400 })
        : liquidResponse(400, 'Review not saved', err.message, fields.returnPath);
    }
    throw err;
  }
}
