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
export const APP_CLIENT_ID = '0546f9515e4b670f341c8ffc92e2de06';

/** Host portion of `application_url` in shopify.app.toml (no scheme, no path). */
export const APP_HOST = 'gapfinder.solnix.store';

/** Matches `access_scopes.scopes` in shopify.app.toml. Order-insensitive. */
export const APP_SCOPES = 'read_orders,read_products,read_content,read_themes,write_script_tags';

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
