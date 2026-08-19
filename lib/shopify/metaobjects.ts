import type { ShopifyClient } from './client';
import { logger } from '../logger';
import { PRODUCT_REVIEW_TYPE } from './metaobject-payload';

/**
 * Projection into Shopify's standard `product_review` metaobject.
 *
 * This is the mechanism behind the server-rendered review block: once a
 * review exists as a metaobject on the shop, the theme app extension renders
 * it in Liquid, inside Shopify's own HTML response, with no JavaScript and
 * no request to us. See PLAN.md §5.2.
 *
 * Syndicating every valid review — plus the `reviews.rating` and
 * `reviews.rating_count` product metafields — is not optional. Shopify
 * REQUIRES it of approved product review apps, and those same metafields are
 * what surface ratings in the Shop app.
 *
 * ACCESS: `product_review` is a RESTRICTED definition. Every function here
 * fails until Shopify approves the app and grants `write_product_reviews`.
 * Callers must check Store.reviewScopeGranted first and mark the projection
 * SKIPPED rather than burning retries against a permission error.
 */

// Re-exported so callers keep importing the type name from here, while the
// definition lives in the dependency-free module the webhook path can use.
export { PRODUCT_REVIEW_TYPE };
export const REVIEWS_NAMESPACE = 'reviews';

const METAOBJECT_UPSERT = /* GraphQL */ `
  mutation CitedMetaobjectUpsert(
    $handle: MetaobjectHandleInput!
    $metaobject: MetaobjectUpsertInput!
  ) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field message code }
    }
  }
`;

const METAOBJECT_DELETE = /* GraphQL */ `
  mutation CitedMetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation CitedMetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

export class MetaobjectError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    /**
     * True when retrying cannot help — a permission problem, a validation
     * failure, or a dangling reference. The caller marks the row FAILED
     * instead of consuming its retry budget.
     */
    public readonly terminal = false,
  ) {
    super(message);
    this.name = 'MetaobjectError';
  }
}

/** Verification values accepted by the standard definition, verbatim. */
export type AppVerificationStatus = 'verified_buyer' | 'verified_reviewer' | 'unverified';

export interface ReviewMetaobjectInput {
  /** Our review ID. Used as the metaobject handle so upserts are idempotent. */
  handle: string;
  productGid: string;
  rating: number;
  scaleMin?: number;
  scaleMax?: number;
  submittedAt: Date;
  verification: AppVerificationStatus;
  /** Provenance, e.g. "cited" or "cited:import:judge_me". */
  source: string;
  title?: string | null;
  body?: string | null;
  /**
   * The reviewer's name as shown to shoppers. Goes to `author_display_name`,
   * NOT `author` — see buildFields.
   */
  author?: string | null;
  /**
   * Customer GID, when the reviewer was a signed-in customer. This is the only
   * thing the standard definition's `author` field accepts.
   */
  authorCustomerGid?: string | null;
  orderGid?: string | null;
  variantGid?: string | null;
  merchantReply?: string | null;
  /** ISO 639-1. */
  language?: string | null;
  mediaUrls?: string[];
  publishedAt?: Date | null;
}

/**
 * The `rating` field is a JSON document, not a number, and Shopify expects
 * its members as STRINGS. Sending `{"value": 5}` is rejected where
 * `{"value": "5.0"}` is accepted — an easy and very confusing failure.
 */
function ratingValue(rating: number, scaleMin: number, scaleMax: number): string {
  return JSON.stringify({
    scale_min: scaleMin.toFixed(1),
    scale_max: scaleMax.toFixed(1),
    value: rating.toFixed(1),
  });
}

/**
 * The exact field set we would write for a review.
 *
 * Exported because drift detection has to compare Shopify's stored values
 * against *this* serialization, not a re-derivation of it. Comparing against
 * a second implementation would report drift on every formatting difference —
 * `5` vs `5.0`, a trailing `Z` — and rewrite the metaobject forever.
 */
export function buildReviewFields(
  input: ReviewMetaobjectInput,
): Array<{ key: string; value: string }> {
  return buildFields(input);
}

function buildFields(input: ReviewMetaobjectInput): Array<{ key: string; value: string }> {
  const scaleMin = input.scaleMin ?? 1;
  const scaleMax = input.scaleMax ?? 5;

  const fields: Array<{ key: string; value: string }> = [
    { key: 'rating', value: ratingValue(input.rating, scaleMin, scaleMax) },
    { key: 'submitted_at', value: input.submittedAt.toISOString() },
    { key: 'source', value: input.source },
    { key: 'product', value: input.productGid },
    { key: 'app_verification_status', value: input.verification },
  ];

  // Optional fields are omitted entirely when empty rather than sent blank.
  // A present-but-empty value overwrites whatever is already stored, which
  // silently erases data on a partial update.
  // `author` is a customer_reference in the standard product_review
  // definition, not a name. Writing "Priya S" into it fails the whole upsert
  // with "Value must be a valid customer reference", which took every review
  // ever submitted down with it — the row saved, the storefront aggregate
  // updated, and nothing ever reached Shopify. The name belongs in
  // `author_display_name`; `author` only ever gets a real customer GID.
  const optional: Array<[string, string | null | undefined]> = [
    ['title', input.title],
    ['body', input.body],
    ['author_display_name', input.author],
    ['author', input.authorCustomerGid],
    ['order', input.orderGid],
    ['product_variant', input.variantGid],
    ['merchant_reply', input.merchantReply],
    ['language', input.language],
  ];
  for (const [key, value] of optional) {
    if (value != null && value !== '') fields.push({ key, value });
  }

  if (input.mediaUrls?.length) {
    fields.push({ key: 'media_urls', value: JSON.stringify(input.mediaUrls) });
  }
  if (input.publishedAt) {
    fields.push({ key: 'published_at', value: input.publishedAt.toISOString() });
  }

  return fields;
}

/** True for errors where retrying is pointless. */
function isTerminalCode(code?: string, message?: string): boolean {
  if (code && ['ACCESS_DENIED', 'INVALID', 'INVALID_VALUE', 'NOT_FOUND', 'TAKEN'].includes(code)) {
    return true;
  }
  const m = (message ?? '').toLowerCase();
  return (
    m.includes('access denied') ||
    m.includes('not authorized') ||
    m.includes('does not exist') ||
    m.includes('required scope')
  );
}

/**
 * Create or update the metaobject for one review.
 *
 * Keyed on OUR review ID as the handle, so this is idempotent: a retry after
 * an ambiguous timeout updates the same record instead of creating a
 * duplicate review on the merchant's storefront.
 */
export async function upsertReviewMetaobject(
  client: ShopifyClient,
  input: ReviewMetaobjectInput,
): Promise<{ metaobjectGid: string }> {
  const resp = await client.graphql<{
    metaobjectUpsert: {
      metaobject: { id: string; handle: string } | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    };
  }>(METAOBJECT_UPSERT, {
    handle: { type: PRODUCT_REVIEW_TYPE, handle: input.handle },
    metaobject: {
      fields: buildFields(input),
      // Only published reviews should be storefront-visible. A hidden or
      // pending review still gets a metaobject so moderation state can flip
      // without a create/delete cycle, but it stays DRAFT.
      capabilities: {
        publishable: { status: input.publishedAt ? 'ACTIVE' : 'DRAFT' },
      },
    },
  });

  const errors = resp.data?.metaobjectUpsert.userErrors ?? [];
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new MetaobjectError(
      `metaobjectUpsert: ${errors.map((e) => e.message).join('; ')}`,
      first.code,
      isTerminalCode(first.code, first.message),
    );
  }

  const gid = resp.data?.metaobjectUpsert.metaobject?.id;
  if (!gid) {
    throw new MetaobjectError('metaobjectUpsert returned no metaobject', undefined, false);
  }

  return { metaobjectGid: gid };
}

const METAOBJECT_BY_ID = /* GraphQL */ `
  query CitedMetaobject($id: ID!) {
    metaobject(id: $id) {
      id
      handle
      type
      updatedAt
      fields { key value }
      capabilities { publishable { status } }
    }
  }
`;

export interface StoredMetaobject {
  gid: string;
  handle: string;
  type: string;
  updatedAt: string | null;
  fields: Record<string, string>;
  /** 'ACTIVE' | 'DRAFT', or null when the definition has no publishable capability. */
  publishableStatus: string | null;
}

/**
 * Read a metaobject back from Shopify.
 *
 * Only used by the reconcile path, and only when the webhook payload didn't
 * carry field values — a metaobject webhook that already contains its fields
 * lets us detect drift without spending an Admin API call per delivery, which
 * matters because our own writes generate webhooks too.
 *
 * Returns null when the metaobject no longer exists. That is an ordinary
 * outcome, not an error: a create and a delete can arrive out of order, and
 * Shopify retries deliveries for days.
 */
export async function fetchReviewMetaobject(
  client: ShopifyClient,
  gid: string,
): Promise<StoredMetaobject | null> {
  const resp = await client.graphql<{
    metaobject: {
      id: string;
      handle: string;
      type: string;
      updatedAt: string | null;
      fields: Array<{ key: string; value: string | null }>;
      capabilities: { publishable: { status: string } | null } | null;
    } | null;
  }>(METAOBJECT_BY_ID, { id: gid });

  if (resp.errors?.length) {
    const message = resp.errors.map((e) => e.message).join('; ');
    throw new MetaobjectError(`metaobject query: ${message}`, undefined, isTerminalCode(undefined, message));
  }

  const node = resp.data?.metaobject;
  if (!node) return null;

  const fields: Record<string, string> = {};
  for (const field of node.fields) {
    fields[field.key] = field.value ?? '';
  }

  return {
    gid: node.id,
    handle: node.handle,
    type: node.type,
    updatedAt: node.updatedAt,
    fields,
    publishableStatus: node.capabilities?.publishable?.status ?? null,
  };
}

/** Remove a review's metaobject — used when a review is deleted or redacted. */
export async function deleteReviewMetaobject(
  client: ShopifyClient,
  metaobjectGid: string,
): Promise<void> {
  const resp = await client.graphql<{
    metaobjectDelete: {
      deletedId: string | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    };
  }>(METAOBJECT_DELETE, { id: metaobjectGid });

  const errors = resp.data?.metaobjectDelete.userErrors ?? [];
  if (errors.length > 0) {
    const first = errors[0]!;
    // Already gone is success, not failure — deletion is idempotent by intent.
    if (isTerminalCode(first.code, first.message) && /not.*exist|not found/i.test(first.message)) {
      return;
    }
    throw new MetaobjectError(
      `metaobjectDelete: ${errors.map((e) => e.message).join('; ')}`,
      first.code,
      isTerminalCode(first.code, first.message),
    );
  }
}

/**
 * Write the aggregate rating metafields Shopify requires on the product.
 *
 * These are the values the theme app extension reads for the summary, and
 * the values Shopify reads to show ratings in the Shop app. They are
 * API-only and never appear in the Shopify admin UI, so a mismatch here is
 * invisible to the merchant and has to be caught by us.
 */
export async function setProductRatingMetafields(
  client: ShopifyClient,
  input: {
    productGid: string;
    ratingAvg: number;
    ratingCount: number;
    scaleMin?: number;
    scaleMax?: number;
  },
): Promise<void> {
  const scaleMin = input.scaleMin ?? 1;
  const scaleMax = input.scaleMax ?? 5;

  // Guard the zero case explicitly. A `rating` metafield must hold a value
  // within its scale, and 0 is outside a 1–5 scale, so writing an average of
  // 0 for a product with no reviews is rejected. Callers should clear
  // instead; this returns early so a legitimate "no reviews yet" state
  // doesn't look like a sync failure.
  if (input.ratingCount <= 0) {
    logger.debug({ productGid: input.productGid }, 'No reviews — skipping rating metafield write');
    return;
  }

  const clamped = Math.min(Math.max(input.ratingAvg, scaleMin), scaleMax);

  const resp = await client.graphql<{
    metafieldsSet: {
      metafields: Array<{ id: string }> | null;
      userErrors: Array<{ field: string[] | null; message: string; code?: string }>;
    };
  }>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: input.productGid,
        namespace: REVIEWS_NAMESPACE,
        key: 'rating',
        type: 'rating',
        value: ratingValue(clamped, scaleMin, scaleMax),
      },
      {
        ownerId: input.productGid,
        namespace: REVIEWS_NAMESPACE,
        key: 'rating_count',
        type: 'number_integer',
        value: String(input.ratingCount),
      },
    ],
  });

  // `data.metafieldsSet` is null when the mutation failed at the GraphQL level
  // rather than validation — a missing scope being the case that matters here.
  // Reading `.userErrors` straight off it turned "Access denied for
  // metafieldsSet" into "Cannot read properties of null", which is how a
  // missing `write_products` scope stayed hidden behind a TypeError.
  if (!resp.data?.metafieldsSet) {
    const message = resp.errors?.map((e) => e.message).join('; ') ?? 'metafieldsSet returned no data';
    const denied = /access denied|required access/i.test(message);
    throw new MetaobjectError(`metafieldsSet: ${message}`, denied ? 'ACCESS_DENIED' : undefined, denied);
  }

  const errors = resp.data.metafieldsSet.userErrors ?? [];
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new MetaobjectError(
      `metafieldsSet: ${errors.map((e) => e.message).join('; ')}`,
      first.code,
      isTerminalCode(first.code, first.message),
    );
  }
}
