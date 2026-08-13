import { env } from '../env';
import { logger } from '../logger';

interface ExchangeResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
}

/**
 * Token Exchange — single-step, session token (id_token) → offline access token.
 *
 * Apps created after Apr 1, 2026 should receive an expiring offline token
 * automatically per Shopify's policy. If the response has no `expires_in`,
 * that indicates a Shopify-side bug or org-level legacy flag — file a Partner
 * support ticket; do not attempt to fix in code.
 *
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/exchange
 */
export async function exchangeOfflineAccessToken(input: {
  shop: string;
  sessionToken: string;
}): Promise<{ accessToken: string; scope: string; expiresIn: number | null }> {
  const res = await fetch(`https://${input.shop}/admin/oauth/access_token?expiring=1`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: env.SHOPIFY_API_KEY,
      client_secret: env.SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: input.sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      expiring: 1,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.error({ shop: input.shop, status: res.status, body }, 'Token exchange failed');
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as ExchangeResponse;
  logger.info(
    {
      shop: input.shop,
      scope: json.scope,
      expiresIn: json.expires_in ?? null,
      tokenPrefix: json.access_token.slice(0, 8),
    },
    'Token exchange response',
  );

  return {
    accessToken: json.access_token,
    scope: json.scope,
    expiresIn: json.expires_in ?? null,
  };
}
