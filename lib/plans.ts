import type { Plan } from '@prisma/client';

/**
 * The plan ladder, as merchants see it.
 *
 * One definition, used by the in-app plans page and by whatever else needs to
 * describe a tier. The Shopify Partner Dashboard holds its own copy of this
 * copy — Shopify owns the checkout and the plan selection page — so the two
 * have to be kept in step by hand. That is why the feature lists live here
 * rather than being scattered through JSX: one file to diff against the
 * dashboard when either changes.
 *
 * Prices are display-only. Shopify bills from the dashboard's numbers, never
 * from these; a mismatch misleads a merchant but cannot mischarge them.
 */

export interface PlanTier {
  id: Plan;
  /** Must match the plan's INVOICE name in the dashboard — see billing.ts. */
  invoiceName: string;
  name: string;
  priceLabel: string;
  tagline: string;
  features: string[];
  /** Shown as "everything in X, plus" above the feature list. */
  inherits?: string;
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'FREE',
    invoiceName: 'free',
    name: 'Free',
    priceLabel: 'Free',
    tagline: 'Collect and display reviews, with nothing held back.',
    features: [
      'Unlimited reviews, photos and video',
      'Reviews in your page’s real HTML — visible to Google and AI assistants',
      'Verified-purchase badges from real order history',
      'Star ratings in the Shop app and Shopify search',
      'Media stored in your own Shopify Files',
      'Moderation, and no branding badge',
    ],
  },
  {
    id: 'PRO',
    invoiceName: 'pro',
    name: 'Pro',
    priceLabel: '$49/month',
    tagline: 'Turn the reviews you collect into something that sells.',
    inherits: 'Free',
    features: [
      'AI review summaries — pros, cons and sentiment by theme',
      'Review highlights — the most useful quotes, pulled from real reviews',
      'AI smart sorting — most helpful reviews first, not just newest',
      'Public replies to reviews, shown on your storefront',
    ],
  },
  {
    id: 'SCALE',
    invoiceName: 'scale',
    name: 'Scale',
    priceLabel: '$299/month',
    tagline: 'For stores selling in more than one language.',
    inherits: 'Pro',
    features: [
      'AI translations into every language your store publishes',
      'Unlimited AI usage — no monthly processing cap',
      'Priority support',
    ],
  },
];

export function tierFor(plan: Plan): PlanTier {
  return PLAN_TIERS.find((t) => t.id === plan) ?? PLAN_TIERS[0]!;
}
