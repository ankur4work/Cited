import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { verifyOAuthHmac } from '@/lib/shopify/hmac';
import { consumeOAuthState } from '@/lib/shopify/oauth-state';
import { exchangeAuthorizationCode } from '@/lib/shopify/token-exchange';
import { upsertStoreWithToken } from '@/lib/shopify/store';
import { OAuthCallbackSchema } from '@/lib/shopify/validators';
import { enqueueInstallBackfill } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OAuth callback.
 *
 * Order of checks matters and is deliberate:
 *
 *   1. Shape/type validation first — cheapest, and it canonicalises the
 *      shop domain before that value is used anywhere else.
 *   2. HMAC over the RAW query params, before state lookup. Verifying the
 *      signature first means an unsigned request can never cause a Redis
 *      round-trip, so this endpoint can't be used to probe state keys.
 *   3. State consumed with GETDEL (atomic, single-use) — a replayed
 *      callback finds an empty key and is rejected.
 *   4. The shop bound to the state must equal the shop in the callback.
 *      Without this check an attacker could pair their own state nonce
 *      with a victim's shop parameter.
 *
 * Only then is the code redeemed.
 */
export async function GET(req: NextRequest) {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());

  const parsed = OAuthCallbackSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'OAuth callback rejected: bad params');
    return NextResponse.json({ error: 'invalid callback parameters' }, { status: 400 });
  }
  const { shop, code, state } = parsed.data;

  if (!verifyOAuthHmac(raw)) {
    logger.warn({ shop }, 'OAuth callback rejected: HMAC mismatch');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const statePayload = await consumeOAuthState(state);
  if (!statePayload) {
    logger.warn({ shop }, 'OAuth callback rejected: state unknown, expired or replayed');
    return NextResponse.json({ error: 'invalid state' }, { status: 401 });
  }

  if (statePayload.shop !== shop) {
    logger.warn(
      { shop, stateShop: statePayload.shop },
      'OAuth callback rejected: state/shop mismatch',
    );
    return NextResponse.json({ error: 'state/shop mismatch' }, { status: 401 });
  }

  let store;
  try {
    const issued = await exchangeAuthorizationCode({ shop, code });
    store = await upsertStoreWithToken({
      shopDomain: shop,
      accessToken: issued.accessToken,
      scope: issued.scope,
      expiresIn: issued.expiresIn,
      refreshToken: issued.refreshToken,
      refreshTokenExpiresIn: issued.refreshTokenExpiresIn,
    });

    logger.info(
      { shop, scope: issued.scope, expiresIn: issued.expiresIn, storeId: store.id },
      'OAuth complete — store installed',
    );
  } catch (err) {
    logger.error({ shop, err: (err as Error).message }, 'OAuth callback failed during exchange');
    return NextResponse.json({ error: 'authentication failed' }, { status: 502 });
  }

  // Backfill is fire-and-forget: a slow product sync must never hold up the
  // redirect into the app. Failures surface in the onboarding UI, which polls
  // job state, rather than as a dead-end error page here.
  try {
    await enqueueInstallBackfill({
      storeId: store.id,
      shopDomain: shop,
      // upsertStoreWithToken stamps installedAt on every install, so this
      // differs across reinstalls and the job IDs stay unique.
      installKey: store.installedAt,
    });
  } catch (err) {
    logger.error({ shop, err: (err as Error).message }, 'Failed to enqueue install backfill');
  }

  const host = raw.host;
  const target = host
    ? `${env.SHOPIFY_APP_URL}/?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`
    : `${env.SHOPIFY_APP_URL}/?shop=${encodeURIComponent(shop)}`;

  return NextResponse.redirect(target, { status: 302 });
}
