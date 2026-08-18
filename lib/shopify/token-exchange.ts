import { env } from '../env';
import { logger } from '../logger';

interface ExchangeResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

/**
 * What every grant in this file returns, whatever the grant type.
 *
 * `expiresIn` and `refreshToken` are non-optional by design — see
 * `assertExpiring` for why a response without them is treated as a failure
 * rather than something to store.
 */
export interface IssuedToken {
  accessToken: string;
  scope: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number | null;
}

/**
 * Thrown when Shopify hands back a NON-EXPIRING token.
 *
 * Distinct from a network or credential failure because the cause and the fix
 * are different: nothing is wrong with the request, but the token is useless.
 * The Admin API has rejected non-expiring tokens outright since Dec 2025 —
 * every call returns 403 "Non-expiring access tokens are no longer accepted".
 *
 * Storing one produces an install that looks perfect (row written, scopes
 * recorded, merchant redirected into the app) and then fails every single API
 * call afterwards. That is precisely what happened on 2026-08-18: the install
 * succeeded, both backfill jobs died on 403, and the app reported "0 products
 * synced" as though the store were empty.
 *
 * So the grant fails loudly instead. A failed install is visible in a minute;
 * a silently dead token costs a day.
 */
export class NonExpiringTokenError extends Error {
  constructor(shop: string) {
    super(
      `Shopify issued a non-expiring offline token for ${shop}. ` +
        `The Admin API rejects these — the app must request expiring tokens (expiring=1).`,
    );
    this.name = 'NonExpiringTokenError';
  }
}

function assertExpiring(shop: string, json: ExchangeResponse): IssuedToken {
  if (!json.expires_in || !json.refresh_token) {
    logger.error(
      {
        shop,
        hasExpiresIn: Boolean(json.expires_in),
        hasRefreshToken: Boolean(json.refresh_token),
        tokenPrefix: json.access_token?.slice(0, 6),
      },
      'Shopify returned a non-expiring token — refusing to store it',
    );
    throw new NonExpiringTokenError(shop);
  }

  return {
    accessToken: json.access_token,
    scope: json.scope,
    expiresIn: json.expires_in,
    refreshToken: json.refresh_token,
    refreshTokenExpiresIn: json.refresh_token_expires_in ?? null,
  };
}

/**
 * POST to a shop's OAuth endpoint and parse the result.
 *
 * `expiring: 1` is included by every caller. It is the flag that decides
 * whether Shopify mints a modern 60-minute token with a refresh token or the
 * legacy permanent one the Admin API no longer honours — a single field, and
 * the whole install works or silently doesn't.
 */
async function postOAuth(
  shop: string,
  body: Record<string, unknown>,
  what: string,
): Promise<ExchangeResponse> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Deliberately does NOT log the code or refresh token in the request —
    // both are bearer credentials, and logs are where secrets leak.
    logger.error({ shop, status: res.status, body: text.slice(0, 300) }, `${what} failed`);
    throw new Error(`${what} failed: ${res.status}`);
  }

  return (await res.json()) as ExchangeResponse;
}

/**
 * Authorization-code grant — the classic OAuth callback path, and the one
 * every install currently takes.
 *
 * With managed installation (`use_legacy_install_flow = false`) an embedded
 * app can also authenticate via token exchange below. Keeping both means an
 * install never dead-ends because one path is unavailable.
 */
export async function exchangeAuthorizationCode(input: {
  shop: string;
  code: string;
}): Promise<IssuedToken> {
  const json = await postOAuth(
    input.shop,
    {
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      code: input.code,
      expiring: 1,
    },
    'Code exchange',
  );

  return assertExpiring(input.shop, json);
}

/**
 * Token Exchange — session token (id_token) → offline access token.
 *
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */
export async function exchangeOfflineAccessToken(input: {
  shop: string;
  sessionToken: string;
}): Promise<IssuedToken> {
  const json = await postOAuth(
    input.shop,
    {
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: input.sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      expiring: 1,
    },
    'Token exchange',
  );

  return assertExpiring(input.shop, json);
}

/**
 * Refresh grant — trade the stored refresh token for a fresh access token.
 *
 * Runs with no merchant present, so it is the only thing standing between a
 * 60-minute token and a background worker that needs to talk to Shopify at
 * 3am. Both tokens rotate: the response carries a NEW refresh token, and the
 * old one must be replaced, not kept.
 *
 * Concurrency is safe without a lock. Two workers refreshing the same store at
 * once both get the same response — Shopify replays a refresh result for up to
 * an hour — so the second writer stores the same pair rather than invalidating
 * the first.
 */
export async function refreshOfflineAccessToken(input: {
  shop: string;
  refreshToken: string;
}): Promise<IssuedToken> {
  const json = await postOAuth(
    input.shop,
    {
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
    'Token refresh',
  );

  return assertExpiring(input.shop, json);
}
