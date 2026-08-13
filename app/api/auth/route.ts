import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { mintOAuthState } from '@/lib/shopify/oauth-state';
import { isValidShopDomain } from '@/lib/shopify/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * OAuth begin.
 *
 * Redirects the merchant to Shopify's authorize screen with a single-use,
 * Redis-backed state nonce (5 min TTL). The nonce — not a cookie — is the
 * CSRF defence, so a replayed callback cannot be accepted even from the
 * same browser.
 *
 * NOTE ON SCOPES: we request env.SHOPIFY_SCOPES only. `write_product_reviews`
 * is a RESTRICTED scope tied to the standard `product_review` metaobject and
 * is granted solely to Shopify-approved product review apps. Requesting it
 * before approval makes the install fail outright, so it is held back and
 * added via fullScopes() once Store.reviewScopeGranted flips. See PLAN.md
 * §5.2.1.
 */
export async function GET(req: NextRequest) {
  const shopParam = req.nextUrl.searchParams.get('shop');

  if (!isValidShopDomain(shopParam)) {
    logger.warn({ shop: shopParam }, 'OAuth begin rejected: invalid shop domain');
    return NextResponse.json({ error: 'invalid shop parameter' }, { status: 400 });
  }
  const shop = shopParam.trim().toLowerCase();

  const state = await mintOAuthState({ shop });

  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', env.SHOPIFY_API_KEY);
  authorizeUrl.searchParams.set('scope', env.SHOPIFY_SCOPES);
  authorizeUrl.searchParams.set('redirect_uri', `${env.SHOPIFY_APP_URL}/api/auth/callback`);
  authorizeUrl.searchParams.set('state', state);

  logger.info({ shop }, 'OAuth begin → redirecting to Shopify authorize');

  // 302 rather than NextResponse.redirect's default so embedded contexts
  // that inspect the status code behave predictably.
  return NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
}
