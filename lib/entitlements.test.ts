import { describe, expect, it, vi } from 'vitest';
import type { Entitlement } from './entitlements';

vi.mock('./env', () => ({ env: { AI_BUDGET_CENTS_PER_STORE: 500 } }));
vi.mock('./prisma', () => ({ prisma: { store: { findUnique: vi.fn() } } }));

const { isPaid, isScale, aiBudgetRemainingCents } = await import('./entitlements');

function store(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    storeId: 'store_1',
    plan: 'PRO',
    aiCentsUsedMtd: 0,
    uninstalledAt: null,
    ...overrides,
  };
}

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
