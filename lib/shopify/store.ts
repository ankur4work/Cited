import { prisma } from '../prisma';
import { decrypt, encrypt } from '../crypto';
import type { Plan, Store } from '@prisma/client';

export interface StoreUpsertInput {
  shopDomain: string;
  accessToken: string;
  scope: string;
  /** Seconds until the access token expires (null = non-expiring). */
  expiresIn?: number | null;
}

function expiresAt(expiresIn: number | null | undefined): Date | null {
  if (!expiresIn) return null;
  // Subtract 60s buffer so we refresh before the token actually expires.
  return new Date(Date.now() + (expiresIn - 60) * 1000);
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
      scope: input.scope,
      plan: 'FREE' satisfies Plan,
      installedAt: new Date(),
    },
    update: {
      accessToken: encrypted,
      accessTokenExpiresAt: tokenExpiresAt,
      scope: input.scope,
      uninstalledAt: null,
      scheduledRedactAt: null,
      installedAt: new Date(),
      ...billingPatch,
    },
  });
  if (prior) await logReinstallBillingReset(prior);
  return store;
}

export async function getStoreToken(shopDomain: string): Promise<string | null> {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store || store.uninstalledAt) return null;
  return decrypt(store.accessToken);
}

export async function refreshStoreToken(input: StoreUpsertInput): Promise<Store> {
  const { patch: billingPatch, prior } = await reinstallBillingReset(input.shopDomain);
  const store = await prisma.store.update({
    where: { shopDomain: input.shopDomain },
    data: {
      accessToken: encrypt(input.accessToken),
      accessTokenExpiresAt: expiresAt(input.expiresIn),
      scope: input.scope,
      uninstalledAt: null,
      scheduledRedactAt: null,
      installedAt: new Date(),
      // Empty on a normal app open (store still installed); resets plan→FREE
      // only when this call is a genuine reinstall. See reinstallBillingReset.
      ...billingPatch,
    },
  });
  if (prior) await logReinstallBillingReset(prior);
  return store;
}

/** Returns true if the store's access token is expired or expiring within 5 minutes. */
export function isTokenExpired(store: { accessTokenExpiresAt: Date | null }): boolean {
  if (!store.accessTokenExpiresAt) return false;
  return store.accessTokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;
}

export async function markStoreUninstalled(shopDomain: string): Promise<void> {
  await prisma.store.updateMany({
    where: { shopDomain, uninstalledAt: null },
    data: { uninstalledAt: new Date() },
  });
}
