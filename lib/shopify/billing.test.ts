import { describe, expect, it, vi } from 'vitest';
import type { ActiveSubscription } from './billing';

vi.mock('../env', () => ({
  env: { SHOPIFY_FREE_PLAN_NAME: 'Free', SHOPIFY_APP_HANDLE: 'cited-reviews' },
}));
vi.mock('./client', () => ({ ShopifyClient: class {} }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { planFromSubscription, planSelectionUrl } = await import('./billing');

function sub(overrides: Partial<ActiveSubscription> = {}): ActiveSubscription {
  return {
    id: 'gid://shopify/AppSubscription/1',
    name: 'Pro',
    status: 'ACTIVE',
    test: false,
    trialDays: 14,
    currentPeriodEnd: null,
    price: { amount: '29.00', currencyCode: 'USD', interval: 'EVERY_30_DAYS' },
    ...overrides,
  };
}

describe('planFromSubscription', () => {
  it('treats no subscription as free', () => {
    expect(planFromSubscription(null)).toBe('FREE');
  });

  it('maps the managed Free plan to FREE', () => {
    expect(planFromSubscription(sub({ name: 'Free', price: null }))).toBe('FREE');
  });

  it('matches the free plan name case-insensitively and ignores padding', () => {
    expect(planFromSubscription(sub({ name: '  FREE  ', price: null }))).toBe('FREE');
  });

  it('maps Pro to PRO', () => {
    expect(planFromSubscription(sub({ name: 'Pro' }))).toBe('PRO');
  });

  it('still matches when the plan is named with a prefix', () => {
    expect(planFromSubscription(sub({ name: 'Cited Pro' }))).toBe('PRO');
  });

  it('does not grant a paid tier on a cancelled subscription', () => {
    expect(planFromSubscription(sub({ status: 'CANCELLED' }))).toBe('FREE');
  });

  /*
   * A development store gets a paid plan at $0 through "Free for partners and
   * developers". Classifying by price would read that as free and lock the
   * partner out of the features they installed the app to test, which is what
   * happened on the first real install.
   */
  it('keeps the paid tier when a dev store is billed zero', () => {
    const zeroed = sub({ name: 'Pro', test: true, price: { amount: '0.00', currencyCode: 'USD', interval: 'EVERY_30_DAYS' } });
    expect(planFromSubscription(zeroed)).toBe('PRO');
  });

  it('falls back to PRO for an unrecognised paid plan name', () => {
    // Someone renamed the plan in the dashboard. The store is paying, so it
    // keeps its entitlement; the warning is what surfaces the mismatch.
    expect(planFromSubscription(sub({ name: 'Growth' }))).toBe('PRO');
  });
});

describe('planSelectionUrl', () => {
  it('builds the hosted pricing page from the app handle, not the app URL', () => {
    expect(planSelectionUrl('app-test-bnt22tq8.myshopify.com')).toBe(
      'https://admin.shopify.com/store/app-test-bnt22tq8/charges/cited-reviews/pricing_plans',
    );
  });
});
