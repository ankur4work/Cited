import { prisma } from '../prisma';
import { logger } from '../logger';
import { encrypt } from '../crypto';
import { enqueueSyndicationBackfill } from '@/jobs/enqueue';
import type { Plan, Store } from '@prisma/client';

export interface StoreUpsertInput {
  shopDomain: string;
  accessToken: string;
  scope: string;
  /** Seconds until the access token expires. Always set — see IssuedToken. */
  expiresIn: number;
  /** Rotates on every refresh; the old value is dead once this is stored. */
  refreshToken: string;
  /** Seconds until the refresh token dies (~90 days). Null if unreported. */
  refreshTokenExpiresIn?: number | null;
}

/**
 * Whether Shopify actually granted the restricted review scope.
 *
 * Derived from the scope string the token exchange returns, never from what
 * we asked for: the two differ for the entire period between requesting
 * access and being approved, and they differ per shop, since test access is
 * granted on a dev store while production shops still install without it.
 *
 * This is the flag every syndication path checks before touching a
 * `product_review` metaobject, so getting it from the authoritative source
 * means a store starts and stops syndicating on its own, with no manual step.
 */
function grantsReviewScope(scope: string): boolean {
  return scope
    .split(',')
    .map((s) => s.trim())
    .includes(REVIEW_SCOPE);
}

const REVIEW_SCOPE = 'write_product_reviews';

/**
 * Sync `reviewScopeGranted` to reality and start the backfill the first time
 * it turns on.
 *
 * Written as a single conditional UPDATE rather than read-then-write. Two app
 * opens can land on two instances concurrently, and a read-then-write would
 * let both observe `false` and both start a backfill. `updateMany` with the
 * old value in the WHERE clause makes exactly one of them report a changed
 * row, so the backfill is triggered once per genuine transition — no extra
 * query on the ordinary open where nothing changed, and no schema flag to
 * keep in step.
 *
 * A failure to enqueue is logged, never thrown: this runs inside the OAuth
 * callback and on every embedded app open, and a Redis blip must not break a
 * merchant's login. The backfill is re-triggerable by hand.
 */
async function syncReviewScopeFlag(input: {
  storeId: string;
  shopDomain: string;
  scope: string;
}): Promise<void> {
  const granted = grantsReviewScope(input.scope);

  const changed = await prisma.store.updateMany({
    where: { id: input.storeId, reviewScopeGranted: !granted },
    data: { reviewScopeGranted: granted },
  });

  if (changed.count === 0) return;

  if (!granted) {
    logger.warn(
      { storeId: input.storeId, shop: input.shopDomain },
      'write_product_reviews revoked — metaobject syndication now skipped for this store',
    );
    return;
  }

  logger.info(
    { storeId: input.storeId, shop: input.shopDomain },
    'write_product_reviews granted — starting metaobject backfill',
  );

  try {
    await enqueueSyndicationBackfill({ storeId: input.storeId });
  } catch (err) {
    logger.error(
      { storeId: input.storeId, err: (err as Error).message },
      'Could not start backfill after scope grant — run it manually',
    );
  }
}

/**
 * Absolute expiry from a `expires_in` duration.
 *
 * Stores the TRUE expiry, not a pre-buffered one. The safety margin belongs
 * in the refresh decision (see REFRESH_MARGIN_MS in access-token.ts), because
 * a column called `accessTokenExpiresAt` that silently holds a time a minute
 * before the real one makes every later calculation wrong by an amount nobody
 * can see.
 */
function expiresAt(expiresIn: number | null | undefined): Date | null {
  if (!expiresIn) return null;
  return new Date(Date.now() + expiresIn * 1000);
}

/** Billing fields cleared on reinstall — kept as a named type for reuse. */
type ReinstallBillingReset = { plan: Plan; shopifyChargeId: null; graceEndsAt: null };

/**
 * When a store comes back from an uninstalled state, Shopify has already
 * cancelled whatever app subscription existed before uninstall. We must not
 * carry the stale plan/charge forward: reset to FREE so the app re-requests
 * charge approval on reinstall (Shopify App Store requirement 1.2.2 — accept,
 * decline and request approval for charges again on reinstall).
 *
 * Returns the billing patch to merge into the reinstall write plus the prior
 * billing state (for an audit BillingEvent). Returns an empty patch when the
 * store was never uninstalled — the common case for `refreshStoreToken`, which
 * runs on EVERY embedded app open and must never wipe an active subscriber.
 */
async function reinstallBillingReset(shopDomain: string): Promise<{
  patch: ReinstallBillingReset | Record<string, never>;
  prior: { id: string; plan: Plan; shopifyChargeId: string | null } | null;
}> {
  const existing = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, uninstalledAt: true, plan: true, shopifyChargeId: true },
  });
  if (!existing || existing.uninstalledAt == null) {
    return { patch: {}, prior: null };
  }
  return {
    patch: { plan: 'FREE' satisfies Plan, shopifyChargeId: null, graceEndsAt: null },
    prior: { id: existing.id, plan: existing.plan, shopifyChargeId: existing.shopifyChargeId },
  };
}

/** Audit-log the billing reset, but only when there was a paid plan/charge to clear. */
async function logReinstallBillingReset(
  prior: { id: string; plan: Plan; shopifyChargeId: string | null },
): Promise<void> {
  if (prior.plan === 'FREE' && !prior.shopifyChargeId) return;
  await prisma.billingEvent.create({
    data: {
      storeId: prior.id,
      eventType: 'reinstall_billing_reset',
      amountCents: 0,
      shopifyChargeId: prior.shopifyChargeId,
    },
  });
}

export async function upsertStoreWithToken(input: StoreUpsertInput): Promise<Store> {
  const encrypted = encrypt(input.accessToken);
  const tokenExpiresAt = expiresAt(input.expiresIn);
  const encryptedRefresh = encrypt(input.refreshToken);
  const refreshExpiresAt = expiresAt(input.refreshTokenExpiresIn);
  const { patch: billingPatch, prior } = await reinstallBillingReset(input.shopDomain);
  // Reinstall: clear uninstalledAt AND scheduledRedactAt so in-flight 48h redact
  // is cancelled automatically. Matches the `app/uninstalled → app/installed
  // within 48h` merchant flow Shopify explicitly supports. billingPatch resets
  // the plan to FREE on reinstall (see reinstallBillingReset).
  const store = await prisma.store.upsert({
    where: { shopDomain: input.shopDomain },
    create: {
      shopDomain: input.shopDomain,
      accessToken: encrypted,
      accessTokenExpiresAt: tokenExpiresAt,
      refreshToken: encryptedRefresh,
      refreshTokenExpiresAt: refreshExpiresAt,
      scope: input.scope,
      plan: 'FREE' satisfies Plan,
      installedAt: new Date(),
    },
    update: {
      accessToken: encrypted,
      accessTokenExpiresAt: tokenExpiresAt,
      refreshToken: encryptedRefresh,
      refreshTokenExpiresAt: refreshExpiresAt,
      scope: input.scope,
      uninstalledAt: null,
      scheduledRedactAt: null,
      installedAt: new Date(),
      ...billingPatch,
    },
  });
  if (prior) await logReinstallBillingReset(prior);
  await syncReviewScopeFlag({
    storeId: store.id,
    shopDomain: store.shopDomain,
    scope: input.scope,
  });
  return store;
}

/*
 * getStoreToken(), refreshStoreToken() and isTokenExpired() used to live here.
 *
 * All three were uncalled, and all three had become wrong under expiring
 * tokens: getStoreToken() returned the stored ciphertext's plaintext with no
 * freshness check, and isTokenExpired() answered `false` for a null expiry —
 * which is now the signature of a legacy token the Admin API refuses outright,
 * i.e. the most expired state a store can be in.
 *
 * Token reads go through getAccessToken() in ./access-token, which refreshes;
 * token writes go through upsertStoreWithToken() above, which handles reinstall
 * and re-authorization alike.
 */

export async function markStoreUninstalled(shopDomain: string): Promise<void> {
  await prisma.store.updateMany({
    where: { shopDomain, uninstalledAt: null },
    data: { uninstalledAt: new Date() },
  });
}
