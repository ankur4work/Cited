/**
 * Canonical identity of THIS app, mirrored from `shopify.app.toml`. The runtime
 * environment (SHOPIFY_API_KEY / SHOPIFY_APP_URL / SHOPIFY_SCOPES) is validated
 * against these constants in the `/api/health` probe so that a deploy pointed at
 * the WRONG app or domain fails loudly (Coolify health check → rollback) instead
 * of silently hanging on the embedded App Bridge skeleton screen.
 *
 * Why this can't be derived from env alone: Zod already rejects *missing* vars,
 * but it cannot catch a var that is present yet wrong — e.g. the previous app's
 * client_id left over after re-creating the app, or the old domain in APP_URL.
 *
 * ⚠️ If you re-create, rename, or re-domain the app, update BOTH this file and
 * `shopify.app.toml` (and the Coolify env vars) so they agree.
 */

/** Matches `client_id` in shopify.app.toml. Public identifier — safe to commit. */
export const APP_CLIENT_ID = 'd7e7cc14dd8022014fdaff06422f2542';

/**
 * Host portion of `application_url` in shopify.app.toml (no scheme, no path).
 *
 * TODO: placeholder following the existing solnix.store convention. Change
 * this together with shopify.app.toml and the Coolify env when the real
 * domain is live.
 */
export const APP_HOST = 'cited.solnix.store';

/**
 * Matches `access_scopes.scopes` in shopify.app.toml. Order-insensitive.
 *
 * Includes the restricted `write_product_reviews` scope, granted 2026-08-14
 * (test access, dev store only — final approval still pending). This must
 * stay in step with shopify.app.toml and SHOPIFY_SCOPES in the environment
 * or the health check below fails every production deploy.
 */
export const APP_SCOPES =
  'read_products,read_orders,read_customers,read_metaobjects,write_product_reviews';

/** Normalize a comma-separated scope string for order-insensitive comparison. */
function normalizeScopes(raw: string): string {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

/**
 * Compare the live env against the canonical identity above. Returns the list of
 * mismatches (empty = healthy). Intended to run only in production — dev uses a
 * throwaway tunnel URL (and possibly a separate dev app) that will never match.
 */
export function checkAppIdentity(env: {
  SHOPIFY_API_KEY: string;
  SHOPIFY_APP_URL: string;
  SHOPIFY_SCOPES: string;
}): string[] {
  const issues: string[] = [];

  if (env.SHOPIFY_API_KEY !== APP_CLIENT_ID) {
    issues.push(
      `SHOPIFY_API_KEY (${env.SHOPIFY_API_KEY.slice(0, 8)}…) does not match expected client_id ${APP_CLIENT_ID.slice(0, 8)}…`,
    );
  }

  let host = '';
  try {
    host = new URL(env.SHOPIFY_APP_URL).host;
  } catch {
    // Zod already guarantees a valid URL; this is belt-and-suspenders.
    host = '(unparseable)';
  }
  if (host !== APP_HOST) {
    issues.push(`SHOPIFY_APP_URL host '${host}' does not match expected '${APP_HOST}'`);
  }

  if (normalizeScopes(env.SHOPIFY_SCOPES) !== normalizeScopes(APP_SCOPES)) {
    issues.push(
      `SHOPIFY_SCOPES '${env.SHOPIFY_SCOPES}' does not match shopify.app.toml scopes '${APP_SCOPES}'`,
    );
  }

  return issues;
}
