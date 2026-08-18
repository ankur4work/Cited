import { prisma } from '../prisma';
import { logger } from '../logger';
import { decrypt, encrypt } from '../crypto';
import { refreshOfflineAccessToken } from './token-exchange';

/**
 * How long before true expiry we refresh.
 *
 * Access tokens live 60 minutes. Five is enough to cover clock skew between us
 * and Shopify plus a long-running request that starts just under the wire,
 * while still using ~92% of each token's life.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * The store cannot talk to Shopify and no amount of retrying will change that
 * — a merchant has to re-authorize.
 *
 * Three ways to land here, all terminal without human action:
 *   - no access token at all (row created before exchange, or purged by redact)
 *   - a LEGACY non-expiring token: `accessTokenExpiresAt` null with a token
 *     present. The Admin API 403s these and no refresh token was ever issued,
 *     so there is nothing to refresh from.
 *   - the refresh token itself expired (90 days) or is missing.
 *
 * Callers must treat this as "stop", not "retry": jobs should give up and let
 * the reconnect prompt in the UI do its work.
 */
export class ReauthRequiredError extends Error {
  constructor(
    public readonly shopDomain: string,
    public readonly reason: 'no-token' | 'legacy-non-expiring' | 'no-refresh-token' | 'refresh-expired',
  ) {
    super(`${shopDomain} must re-authorize (${reason})`);
    this.name = 'ReauthRequiredError';
  }
}

const TOKEN_FIELDS = {
  id: true,
  shopDomain: true,
  accessToken: true,
  accessTokenExpiresAt: true,
  refreshToken: true,
  refreshTokenExpiresAt: true,
} as const;

/**
 * The current, valid access token for a store — refreshing it first if needed.
 *
 * This is the ONLY place the app should read `Store.accessToken` for the
 * purpose of calling Shopify. Reading the column directly worked while tokens
 * were permanent; with 60-minute tokens it produces a request that succeeds in
 * testing and fails an hour later in production.
 *
 * `force` skips the freshness check and refreshes unconditionally — used after
 * a 401/403, where Shopify disagrees with our stored expiry and Shopify wins.
 */
export async function getAccessToken(
  storeId: string,
  opts: { force?: boolean } = {},
): Promise<string> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: TOKEN_FIELDS,
  });

  if (!store?.accessToken) {
    throw new ReauthRequiredError(store?.shopDomain ?? storeId, 'no-token');
  }

  if (!opts.force && isFresh(store.accessTokenExpiresAt)) {
    return decrypt(store.accessToken);
  }

  // A legacy row: token present, no expiry, no refresh token. Named
  // separately from a plain missing refresh token because the operator fix
  // differs — these rows predate expiring tokens and every one of them needs
  // the merchant to reinstall.
  if (!store.refreshToken) {
    throw new ReauthRequiredError(
      store.shopDomain,
      store.accessTokenExpiresAt === null ? 'legacy-non-expiring' : 'no-refresh-token',
    );
  }

  if (store.refreshTokenExpiresAt && store.refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new ReauthRequiredError(store.shopDomain, 'refresh-expired');
  }

  return refreshAndStore(store.id, store.shopDomain, decrypt(store.refreshToken));
}

function isFresh(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
}

/**
 * Trade the refresh token for a new pair and persist both.
 *
 * No lock. Two workers can refresh the same store concurrently and that is
 * fine: Shopify replays the same response for up to an hour, so the loser of
 * the race stores an identical pair rather than orphaning the winner's token.
 *
 * The write is a single `update` covering both tokens — a crash between two
 * writes could leave a new access token beside the spent refresh token, which
 * is unrecoverable without the merchant.
 */
async function refreshAndStore(
  storeId: string,
  shopDomain: string,
  refreshToken: string,
): Promise<string> {
  const issued = await refreshOfflineAccessToken({ shop: shopDomain, refreshToken });

  await prisma.store.update({
    where: { id: storeId },
    data: {
      accessToken: encrypt(issued.accessToken),
      accessTokenExpiresAt: new Date(Date.now() + issued.expiresIn * 1000),
      refreshToken: encrypt(issued.refreshToken),
      refreshTokenExpiresAt: issued.refreshTokenExpiresIn
        ? new Date(Date.now() + issued.refreshTokenExpiresIn * 1000)
        : null,
    },
  });

  logger.info(
    { storeId, shop: shopDomain, expiresIn: issued.expiresIn },
    'Access token refreshed',
  );

  return issued.accessToken;
}

/**
 * Whether a store is in a state the merchant has to fix, without calling
 * Shopify. Drives the reconnect prompt in the embedded app.
 */
export function needsReauth(store: {
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}): boolean {
  if (!store.accessToken) return true;
  // Legacy non-expiring token — rejected by the Admin API, unrefreshable.
  if (store.accessTokenExpiresAt === null) return true;
  if (!store.refreshToken) return true;
  if (store.refreshTokenExpiresAt && store.refreshTokenExpiresAt.getTime() <= Date.now()) {
    return true;
  }
  return false;
}
