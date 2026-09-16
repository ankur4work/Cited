import { describe, expect, it } from 'vitest';
import { PLAN_TIERS, tierFor } from './plans';

describe('PLAN_TIERS', () => {
  it('covers every plan in the enum exactly once', () => {
    // A tier missing here renders an empty plans page for whoever is on it;
    // a duplicate makes tierFor's answer depend on array order.
    expect(PLAN_TIERS.map((t) => t.id)).toEqual(['FREE', 'PRO', 'SCALE']);
  });

  it('keeps invoice names lowercase and matching the dashboard', () => {
    // billing.ts lowercases both sides before comparing, and these are the
    // values configured in the Partner Dashboard. Drift here means a paying
    // store resolves to the wrong entitlement set.
    expect(PLAN_TIERS.map((t) => t.invoiceName)).toEqual(['free', 'pro', 'scale']);
  });

  it('gives every tier at least one feature', () => {
    // A plan with no listed features does not render to merchants in that
    // locale — Shopify hides it outright.
    for (const tier of PLAN_TIERS) {
      expect(tier.features.length).toBeGreaterThan(0);
    }
  });

  it('describes paid tiers as additive', () => {
    // The ladder only reads correctly if each paid tier inherits the one
    // below. Free is the base and inherits nothing.
    expect(PLAN_TIERS[0]!.inherits).toBeUndefined();
    expect(PLAN_TIERS[1]!.inherits).toBe('Free');
    expect(PLAN_TIERS[2]!.inherits).toBe('Pro');
  });

  it('lists video under Pro, not Free', () => {
    // Enforced in app/api/proxy/reviews (which drops an unentitled upload) and
    // hinted to the storefront via the shop features metafield. If the listing
    // said Free, a merchant would advertise something the route refuses.
    const free = PLAN_TIERS[0]!.features.join(' ').toLowerCase();
    const pro = PLAN_TIERS[1]!.features.join(' ').toLowerCase();
    expect(free).not.toContain('video');
    expect(pro).toContain('video');
  });

  it('does not repeat a feature across tiers', () => {
    // Repeating a Free feature under Pro pads the paid tier with something the
    // merchant already has, which is the kind of listing that earns a refund
    // request rather than an upgrade.
    const all = PLAN_TIERS.flatMap((t) => t.features);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('tierFor', () => {
  it('resolves each plan to its own tier', () => {
    expect(tierFor('FREE').name).toBe('Free');
    expect(tierFor('PRO').name).toBe('Pro');
    expect(tierFor('SCALE').name).toBe('Scale');
  });
});
