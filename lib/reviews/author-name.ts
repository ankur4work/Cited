/**
 * The author name we are willing to make public.
 *
 * Shopify's customer `displayName` falls back to the email address when a
 * customer has no first or last name set. A signed-in shopper is never asked
 * for a name — `app/api/proxy/reviews/route.ts` takes Shopify's answer as
 * authoritative — so an account with no name attaches its owner's email
 * address to the review, and every publication path then prints it on a page
 * anyone can read. That is exactly what happened on ptguyn-cg.
 *
 * Applied at each publication boundary rather than only where the value is
 * captured, because rows written before that source fix exists still hold an
 * address, and those are the ones already published.
 */

/**
 * `null` for anything unsafe or empty, so callers pick their own fallback —
 * 'Anonymous' in the admin, `''` in a metafield, omitted in JSON.
 */
export function publicAuthorName(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Deliberately not an address parser. Anything carrying an `@` is refused
  // rather than risk printing a real address because it failed some RFC
  // nicety — a person's display name has no business containing one, so the
  // false-positive cost is a review that shows as anonymous.
  if (trimmed.includes('@')) return null;

  return trimmed;
}
