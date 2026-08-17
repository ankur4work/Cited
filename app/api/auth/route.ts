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

  return redirectToAuthorize(req, authorizeUrl.toString());
}

/**
 * Send the browser to Shopify's authorize screen, escaping the admin iframe
 * when we are inside one.
 *
 * A plain 302 is correct top-level and **fails embedded**. Shopify serves
 * `accounts.shopify.com` with framing denied, so when the redirect happens
 * inside the admin's iframe the browser refuses to render it — Firefox says
 * the page "will not allow Firefox to display the page if another site has
 * embedded it", Chrome shows a blank frame. Every embedded entry point hits
 * this: the install button on the app's own page, and the Partner Dashboard's
 * "Test your app" flow, because both navigate the iframe rather than the tab.
 *
 * So for a browser navigation we return a tiny HTML document that reassigns
 * `window.top.location`. It is served *into* the iframe, which is allowed —
 * our CSP grants `frame-ancestors` to the admin — and it then moves the whole
 * tab to Shopify. Top-level requests take the same path and simply assign
 * `window.location`, so there is one code path rather than two behaviours
 * depending on a header we might read wrong.
 *
 * Non-browser callers (anything not asking for HTML) still get the 302, so
 * scripted installs and health probes are unaffected.
 */
function redirectToAuthorize(req: NextRequest, authorizeUrl: string): NextResponse {
  const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');

  if (!wantsHtml) {
    return NextResponse.redirect(authorizeUrl, { status: 302 });
  }

  // JSON.stringify for the script literal and an escaped copy for the href.
  // The URL is built by us from a validated shop domain, so this is defence
  // in depth rather than a live injection path.
  const jsUrl = JSON.stringify(authorizeUrl);
  const htmlUrl = authorizeUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Redirecting to Shopify…</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:32px;color:#1a1a1a">
<p>Redirecting to Shopify to authorize Cited…</p>
<p><a id="cited-auth-link" href="${htmlUrl}" target="_top">Continue to Shopify</a></p>
<script>
(function () {
  var url = ${jsUrl};
  try {
    // window.top is cross-origin here, so this is a write-only assignment —
    // permitted — whereas reading window.top.location would throw.
    if (window.top && window.top !== window.self) {
      window.top.location.href = url;
    } else {
      window.location.href = url;
    }
  } catch (e) {
    // Sandboxed frame without allow-top-navigation: leave the link, which
    // carries target="_top" and works on click.
    document.getElementById('cited-auth-link').style.fontSize = '1.1rem';
  }
})();
</script>
<noscript><p>JavaScript is disabled — use the link above.</p></noscript>
</body>
</html>`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // This document is a one-shot redirect carrying a single-use state
      // nonce. Caching it would replay a spent nonce and fail the callback.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
