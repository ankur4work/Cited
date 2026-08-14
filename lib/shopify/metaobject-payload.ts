/**
 * Pure parsing and comparison helpers for the metaobject webhook feed.
 *
 * Deliberately free of imports that touch env, Prisma, Redis or the network,
 * so the logic that decides "is this our review, and has it drifted?" can be
 * unit-tested without standing up the world. Everything with a side effect
 * lives in the route or the processor.
 */

export const PRODUCT_REVIEW_TYPE = 'product_review';

/** Prefix that marks a metaobject handle as written by this app. */
const HANDLE_PREFIX = 'cited-';

/**
 * Metaobject handles are constrained to lowercase alphanumerics and dashes.
 * cuid() satisfies that already, but normalising here means an imported
 * review carrying a foreign ID format can never produce an invalid handle.
 *
 * This is the single definition of the handle format. The syndication
 * processor writes it and the reconcile processor reads it back to decide
 * ownership, so the two must never drift apart.
 */
export function reviewMetaobjectHandle(reviewId: string): string {
  return `${HANDLE_PREFIX}${reviewId.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

/**
 * Recover the review ID from a handle we wrote, or null if the handle isn't
 * ours.
 *
 * Note the asymmetry with `reviewMetaobjectHandle`: normalisation there is
 * lossy, so this returns a *candidate* ID that the caller must still look up.
 * For cuid()-generated IDs — every review we create — the round trip is
 * exact, because cuids are already lowercase alphanumeric.
 */
export function reviewIdFromHandle(handle: string): string | null {
  if (!handle.startsWith(HANDLE_PREFIX)) return null;
  const candidate = handle.slice(HANDLE_PREFIX.length);
  return candidate.length > 0 ? candidate : null;
}

/**
 * Coerce whatever the webhook calls a metaobject ID into an Admin API GID.
 *
 * Shopify is not consistent about this across payload versions — some feeds
 * carry a bare numeric ID, others the full `gid://` form — and we store the
 * GID on Review.metaobjectGid, so a numeric ID would silently fail to match
 * any row and every webhook would look like a foreign metaobject.
 */
export function normalizeMetaobjectGid(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return `gid://shopify/Metaobject/${raw}`;
  }
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;
  if (value.startsWith('gid://')) return value;
  if (/^\d+$/.test(value)) return `gid://shopify/Metaobject/${value}`;
  return null;
}

export interface MetaobjectEnvelope {
  gid: string;
  type: string | null;
  handle: string | null;
  /**
   * Field values keyed by field name. Null — not empty — when the payload
   * carried no field data at all, which is the signal for the processor to
   * fetch the metaobject instead of assuming it has nothing in it. An empty
   * object would be indistinguishable from "every field was cleared".
   */
  fields: Record<string, string> | null;
  updatedAt: string | null;
}

/**
 * Normalise a metaobject webhook body.
 *
 * The `fields` member is accepted in both shapes Shopify has used — a plain
 * object and an array of `{key, value}` — because the review-app docs and the
 * general metaobject docs disagree, and guessing wrong would turn every
 * webhook into a spurious "drift detected" and an infinite rewrite loop.
 * Unrecognised shapes yield `fields: null`, which costs one Admin API read
 * and stays correct.
 */
export function parseMetaobjectWebhookPayload(payload: unknown): MetaobjectEnvelope | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;

  const gid = normalizeMetaobjectGid(body.id ?? body.admin_graphql_api_id);
  if (!gid) return null;

  return {
    gid,
    type: typeof body.type === 'string' ? body.type : null,
    handle: typeof body.handle === 'string' ? body.handle : null,
    fields: parseFields(body.fields),
    updatedAt: typeof body.updated_at === 'string' ? body.updated_at : null,
  };
}

function parseFields(raw: unknown): Record<string, string> | null {
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { key, value } = entry as { key?: unknown; value?: unknown };
      if (typeof key !== 'string') continue;
      // A null value means the field exists but is unset. Represent it as an
      // empty string so it compares equal to "we would not send this field",
      // rather than dropping the key and hiding a real difference.
      out[key] = typeof value === 'string' ? value : value == null ? '' : String(value);
    }
    return out;
  }

  if (typeof raw === 'object' && raw !== null) {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      out[key] = typeof value === 'string' ? value : value == null ? '' : String(value);
    }
    return out;
  }

  return null;
}

/**
 * Field names whose stored value differs from what we would write.
 *
 * One-directional on purpose: only the fields WE manage are compared. A
 * merchant or another app adding an unrelated field to the metaobject is not
 * drift, and treating it as drift would make us fight them forever over a
 * field we have no opinion about.
 *
 * Returns keys only, never values — the caller logs the result, and review
 * bodies and author names must not end up in log aggregation.
 */
export function driftedFieldKeys(
  expected: Array<{ key: string; value: string }>,
  actual: Record<string, string>,
): string[] {
  const drifted: string[] = [];
  for (const { key, value } of expected) {
    const current = actual[key];
    if (current === undefined || current !== value) drifted.push(key);
  }
  return drifted;
}
