import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import type { Plan } from '@prisma/client';

/**
 * Plan entitlement checks.
 *
 * Until now `Store.plan` was resolved from the subscription, cached, synced by
 * the app_subscriptions/update webhook and rendered as a badge in settings —
 * and then never read to permit or deny anything. Free and Pro stores got
 * byte-identical behaviour, which meant a paying merchant was paying for a
 * label. This module is the missing half.
 *
 * Deliberately additive: nothing a Free store can do today moves behind this
 * gate. Free keeps unlimited reviews, photos, the server-rendered block and no
 * branding — that generosity is the whole wedge against Judge.me (PLAN.md §0).
 * Pro adds capabilities on top. Taking a feature away from free users to
 * manufacture a paid tier would cost more in switchers than it earns.
 */

/** What a gated code path needs to know about a store, in one read. */
export interface Entitlement {
  storeId: string;
  plan: Plan;
  /** Month-to-date AI spend, in cents. Reset by the monthly maintenance sweep. */
  aiCentsUsedMtd: number;
  uninstalledAt: Date | null;
}

export async function loadEntitlement(storeId: string): Promise<Entitlement | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, plan: true, aiCentsUsedMtd: true, uninstalledAt: true },
  });
  if (!store) return null;

  return {
    storeId: store.id,
    plan: store.plan,
    aiCentsUsedMtd: store.aiCentsUsedMtd,
    uninstalledAt: store.uninstalledAt,
  };
}

/**
 * Does this store hold a paid subscription of any tier?
 *
 * Written as "not free" rather than as a list of paid plans on purpose: adding
 * a fourth tier should widen every paid capability automatically, whereas an
 * allowlist silently withholds everything from the new tier until someone
 * remembers to extend it — and that failure is invisible until a merchant who
 * paid the most gets the least.
 */
export function isPaid(entitlement: Pick<Entitlement, 'plan'>): boolean {
  return entitlement.plan !== 'FREE';
}

/** The top tier: every feature, no caps, priority support. */
export function isScale(entitlement: Pick<Entitlement, 'plan'>): boolean {
  return entitlement.plan === 'SCALE';
}

/**
 * Cents of AI spend this store may still incur this month.
 *
 * Free is zero by construction, not by configuration. `AI_BUDGET_CENTS_PER_STORE`
 * caps a PAYING store; a free store has no AI entitlement to budget for, and
 * reading the env default here would hand every free install $5/month of spend
 * (PLAN.md §8: "a viral free tier with uncapped AI is how this dies").
 *
 * SCALE is uncapped because that is what it sells. `Infinity` rather than a
 * large number: a sentinel like 999_999 reads as a real ceiling to anyone
 * reviewing this later, and would eventually be hit by exactly the highest-
 * volume merchant who paid not to hit it. Callers compare with `<= 0`, which
 * behaves correctly. The spend is still recorded on `aiCentsUsedMtd`, so an
 * uncapped store is observable even though it is unconstrained.
 */
export function aiBudgetRemainingCents(entitlement: Entitlement): number {
  if (!isPaid(entitlement)) return 0;
  if (isScale(entitlement)) return Infinity;
  return Math.max(0, env.AI_BUDGET_CENTS_PER_STORE - entitlement.aiCentsUsedMtd);
}

/** Why a gated capability was withheld. Logged, never shown to a shopper. */
export type DenialReason = 'store_missing' | 'uninstalled' | 'plan' | 'ai_budget';

export interface Denied {
  ok: false;
  reason: DenialReason;
}
export interface Allowed {
  ok: true;
  entitlement: Entitlement;
}

/**
 * Gate for an AI feature: installed, on a sufficient plan, and inside budget.
 *
 * `requires` is the tier floor. Most AI features need any paid plan; a few sit
 * at the top of the ladder. Translations are the current example — only a store
 * publishing more than one locale can use them, which is a larger, usually
 * international merchant, so the feature is what gives the top tier a reason to
 * exist beyond a lifted cap.
 *
 * Returns a result rather than throwing. These checks run inside BullMQ
 * processors, where a throw means "retry with backoff" — and a free store is
 * not a transient failure. Retrying it six times would burn the queue on a
 * condition that cannot change without the merchant upgrading.
 */
export async function checkAiEntitlement(
  storeId: string,
  options: { requires?: 'paid' | 'scale' } = {},
): Promise<Allowed | Denied> {
  const entitlement = await loadEntitlement(storeId);
  if (!entitlement) return { ok: false, reason: 'store_missing' };
  if (entitlement.uninstalledAt) return { ok: false, reason: 'uninstalled' };

  const sufficient =
    options.requires === 'scale' ? isScale(entitlement) : isPaid(entitlement);
  if (!sufficient) return { ok: false, reason: 'plan' };

  if (aiBudgetRemainingCents(entitlement) <= 0) return { ok: false, reason: 'ai_budget' };

  return { ok: true, entitlement };
}
