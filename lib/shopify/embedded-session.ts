import type { Store } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { needsReauth } from './access-token';
import { exchangeOfflineAccessToken } from './token-exchange';
import { upsertStoreWithToken } from './store';
import { verifySessionToken, shopFromDest } from './session-token';
import { enqueueInstallBackfill } from '@/jobs/enqueue';

/**
 * Turn a session token into a working, authenticated store — with no
 * merchant-visible authorize screen.
 *
 * This is what makes Cited behave like every other modern Shopify app. The
 * legacy path (`/api/auth` → Shopify's authorize page → callback) is what a
 * merchant experienced as "why is it asking me to authorize *again*". With
 * managed installation the scopes are granted when the app is added, and the
 * app is expected to obtain its own access token silently via token exchange.
 *
 * Exchange runs when we have no usable token — first open after install, or a
 * store whose token cannot be refreshed. On the ordinary open, where the token
 * is healthy, this does one indexed read and nothing else.
 */
export type SessionResult =
  | { state: 'ready'; store: Store }
  /** No shop context at all — app opened outside Shopify admin. */
  | { state: 'no-shop' }
  /**
   * We know the shop but have no session token to exchange, and no usable
   * stored token. The client retries with an App Bridge token; only if that
   * cannot happen does the legacy install link get shown.
   */
  | { state: 'needs-token'; shop: string };

export async function resolveEmbeddedSession(input: {
  shop?: string | null;
  idToken?: string | null;
}): Promise<SessionResult> {
  let shop = typeof input.shop === 'string' ? input.shop.trim().toLowerCase() : null;

  if (input.idToken) {
    try {
      const payload = verifySessionToken(input.idToken);
      const tokenShop = shopFromDest(payload.dest);

      // The token's own `dest` wins over the query string. A `?shop=` param is
      // attacker-controlled; a signed claim is not.
      if (tokenShop) shop = tokenShop;

      const existing = await prisma.store.findUnique({ where: { shopDomain: shop! } });

      if (!existing || needsReauth(existing)) {
        const store = await exchangeAndPersist(shop!, input.idToken, existing);
        return { state: 'ready', store };
      }

      return { state: 'ready', store: existing };
    } catch (err) {
      // A bad or expired session token is not fatal: App Bridge will mint a
      // fresh one on the client and retry. Log and fall through.
      logger.warn({ shop, err: (err as Error).message }, 'Session token rejected');
    }
  }

  if (!shop) return { state: 'no-shop' };

  const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
  if (store && !needsReauth(store)) return { state: 'ready', store };

  return { state: 'needs-token', shop };
}

/**
 * Exchange and store, then start the backfill if this is the first time we
 * have ever held a working token for this shop.
 *
 * The backfill guard is `!previous?.accessToken`, not "row does not exist":
 * the row can predate a usable token — created by an install whose token was
 * rejected — and that store still needs its products pulled in.
 */
async function exchangeAndPersist(
  shop: string,
  sessionToken: string,
  previous: Store | null,
): Promise<Store> {
  const issued = await exchangeOfflineAccessToken({ shop, sessionToken });

  const store = await upsertStoreWithToken({
    shopDomain: shop,
    accessToken: issued.accessToken,
    scope: issued.scope,
    expiresIn: issued.expiresIn,
    refreshToken: issued.refreshToken,
    refreshTokenExpiresIn: issued.refreshTokenExpiresIn,
  });

  logger.info(
    { shop, storeId: store.id, scope: issued.scope },
    'Token exchange complete — no authorize screen shown',
  );

  const firstUsableToken = !previous?.accessToken || needsReauth(previous);
  if (firstUsableToken) {
    try {
      await enqueueInstallBackfill({
        storeId: store.id,
        shopDomain: shop,
        // Fresh on every install, so a reinstall is not deduped against the
        // previous install's completed jobs.
        installKey: store.installedAt,
      });
    } catch (err) {
      logger.error(
        { shop, err: (err as Error).message },
        'Token exchange succeeded but backfill could not be queued',
      );
    }
  }

  return store;
}
