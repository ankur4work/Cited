import { describe, expect, it, vi } from 'vitest';
import type { Entitlement } from './entitlements';

vi.mock('./env', () => ({
  env: { AI_BUDGET_CENTS_PER_STORE: 500, REVIEW_REQUEST_CAP_PRO: 500 },
}));
const findUnique = vi.fn();
const sendCount = vi.fn();
vi.mock('./prisma', () => ({
  prisma: {
    store: { findUnique: () => findUnique() },
    requestSend: { count: (args: unknown) => sendCount(args) },
  },
}));

const {
  isPaid,
  isScale,
  aiBudgetRemainingCents,
  checkAiEntitlement,
  reviewRequestCapFor,
  reviewRequestsRemaining,
  monthStartUtc,
} = await import('./entitlements');

function store(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    storeId: 'store_1',
    plan: 'PRO',
    aiCentsUsedMtd: 0,
    uninstalledAt: null,
    ...overrides,
  };
}

describe('checkAiEntitlement', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'store_1',
    plan: 'PRO',
    aiCentsUsedMtd: 0,
    uninstalledAt: null,
    ...over,
  });

  it('admits a Pro store to a paid-tier feature', async () => {
    findUnique.mockResolvedValueOnce(row());
    await expect(checkAiEntitlement('store_1')).resolves.toMatchObject({ ok: true });
  });

  it('refuses a Pro store a Scale-only feature', async () => {
    // Translations sit at the top of the ladder. Without this the $49 tier
    // would quietly receive the $299 tier's feature.
    findUnique.mockResolvedValueOnce(row({ plan: 'PRO' }));
    await expect(checkAiEntitlement('store_1', { requires: 'scale' })).resolves.toEqual({
      ok: false,
      reason: 'plan',
    });
  });

  it('admits a Scale store to a Scale-only feature', async () => {
    findUnique.mockResolvedValueOnce(row({ plan: 'SCALE' }));
    await expect(
      checkAiEntitlement('store_1', { requires: 'scale' }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('refuses a Free store either way', async () => {
    findUnique.mockResolvedValueOnce(row({ plan: 'FREE' }));
    await expect(checkAiEntitlement('store_1')).resolves.toEqual({ ok: false, reason: 'plan' });
  });

  it('refuses an uninstalled store before checking the plan', async () => {
    findUnique.mockResolvedValueOnce(row({ plan: 'SCALE', uninstalledAt: new Date() }));
    await expect(checkAiEntitlement('store_1')).resolves.toEqual({
      ok: false,
      reason: 'uninstalled',
    });
  });

  it('refuses a Pro store that has spent its budget', async () => {
    findUnique.mockResolvedValueOnce(row({ aiCentsUsedMtd: 500 }));
    await expect(checkAiEntitlement('store_1')).resolves.toEqual({
      ok: false,
      reason: 'ai_budget',
    });
  });

  it('never budget-blocks a Scale store', async () => {
    // Uncapped is what the top tier sells; a spent counter must not gate it.
    findUnique.mockResolvedValueOnce(row({ plan: 'SCALE', aiCentsUsedMtd: 500_000 }));
    await expect(
      checkAiEntitlement('store_1', { requires: 'scale' }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('isPaid', () => {
  it('is true for every paid tier', () => {
    expect(isPaid(store({ plan: 'PRO' }))).toBe(true);
    expect(isPaid(store({ plan: 'SCALE' }))).toBe(true);
  });

  it('is false only for FREE', () => {
    expect(isPaid(store({ plan: 'FREE' }))).toBe(false);
  });
});

describe('isScale', () => {
  it('distinguishes the top tier from the one below it', () => {
    expect(isScale(store({ plan: 'SCALE' }))).toBe(true);
    expect(isScale(store({ plan: 'PRO' }))).toBe(false);
  });
});

describe('aiBudgetRemainingCents', () => {
  it('gives a fresh Pro store the configured budget', () => {
    expect(aiBudgetRemainingCents(store())).toBe(500);
  });

  it('subtracts what has already been spent this month', () => {
    expect(aiBudgetRemainingCents(store({ aiCentsUsedMtd: 120 }))).toBe(380);
  });

  it('never goes negative once the budget is overshot', () => {
    // A job debits after the spend has happened, so the counter can land past
    // the ceiling. Returning a negative would read as credit to any caller
    // doing arithmetic on it.
    expect(aiBudgetRemainingCents(store({ aiCentsUsedMtd: 900 }))).toBe(0);
  });

  it('leaves the top tier uncapped', () => {
    // SCALE sells uncapped usage. A large sentinel would read as a real
    // ceiling and would eventually be hit by the highest-volume merchant —
    // precisely the one who paid not to hit it.
    expect(aiBudgetRemainingCents(store({ plan: 'SCALE' }))).toBe(Infinity);
    expect(aiBudgetRemainingCents(store({ plan: 'SCALE', aiCentsUsedMtd: 500_000 }))).toBe(
      Infinity,
    );
  });

  it('gives a Free store nothing regardless of the configured budget', () => {
    // The regression this guards: reading the env default for every store
    // would hand each free install $5/month of AI spend. Free has no AI
    // entitlement to budget for — the number is zero by construction.
    expect(aiBudgetRemainingCents(store({ plan: 'FREE' }))).toBe(0);
    expect(aiBudgetRemainingCents(store({ plan: 'FREE', aiCentsUsedMtd: 0 }))).toBe(0);
  });
});

describe('review request entitlement', () => {
  it('gives Free no allowance at all', () => {
    expect(reviewRequestCapFor({ plan: 'FREE' })).toBe(0);
  });

  it('caps Pro and uncaps Scale', () => {
    expect(reviewRequestCapFor({ plan: 'PRO' })).toBe(500);
    expect(reviewRequestCapFor({ plan: 'SCALE' })).toBe(Infinity);
  });

  it('never queries usage for a plan whose answer cannot depend on it', async () => {
    // A count against a store with hundreds of thousands of sends is not free,
    // and for Free and Scale the result is fixed either way.
    await expect(reviewRequestsRemaining({ storeId: 's', plan: 'FREE' })).resolves.toBe(0);
    await expect(reviewRequestsRemaining({ storeId: 's', plan: 'SCALE' })).resolves.toBe(Infinity);
    expect(sendCount).not.toHaveBeenCalled();
  });

  it('subtracts this month’s sends from the Pro cap', async () => {
    sendCount.mockResolvedValueOnce(180);
    await expect(reviewRequestsRemaining({ storeId: 's', plan: 'PRO' })).resolves.toBe(320);
  });

  it('floors at zero rather than returning a negative allowance', async () => {
    // A cap lowered mid-month leaves a store already past it. Callers compare
    // with <= 0, but a negative number would read as "owed sends" to anyone
    // displaying it.
    sendCount.mockResolvedValueOnce(900);
    await expect(reviewRequestsRemaining({ storeId: 's', plan: 'PRO' })).resolves.toBe(0);
  });

  it('counts scheduled sends against the cap, not only delivered ones', async () => {
    // One sweep queues hundreds of SCHEDULED rows before any becomes SENT.
    // Counting only SENT would let a single pass authorise an unbounded batch.
    sendCount.mockResolvedValueOnce(0);
    await reviewRequestsRemaining({ storeId: 's', plan: 'PRO' });
    expect(sendCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['SCHEDULED', 'SENT'] } }),
      }),
    );
  });

  it('measures the window from the first instant of the UTC month', () => {
    const d = monthStartUtc(new Date('2026-09-17T18:45:00Z'));
    expect(d.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});
