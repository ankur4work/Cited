import { prisma } from './prisma';
import type { Store } from '@prisma/client';
import { themeEditorDeepLink, type ThemeBlockStatus } from './theme-block';

/**
 * Read models for the merchant-facing pages.
 *
 * Kept out of the components so a page is one query call and some markup, and
 * so the counts a merchant sees are defined in exactly one place. Every query
 * is scoped by storeId — a missing scope here is a cross-shop data leak, not a
 * cosmetic bug.
 */

export interface DashboardOverview {
  products: number;
  reviewsTotal: number;
  reviewsPublished: number;
  reviewsPending: number;
  averageRating: number | null;
  syncedToShopify: number;
  syncFailed: number;
  awaitingSync: number;
  ratedProducts: number;
}

export async function getOverview(storeId: string): Promise<DashboardOverview> {
  const [products, byStatus, ratingAgg, bySync, ratedProducts] = await Promise.all([
    prisma.product.count({ where: { storeId } }),
    prisma.review.groupBy({
      by: ['status'],
      where: { storeId, redactedAt: null },
      _count: { _all: true },
    }),
    prisma.review.aggregate({
      where: { storeId, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.review.groupBy({
      by: ['syncStatus'],
      where: { storeId },
      _count: { _all: true },
    }),
    prisma.product.count({ where: { storeId, ratingCount: { gt: 0 } } }),
  ]);

  const status = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const sync = (s: string) => bySync.find((r) => r.syncStatus === s)?._count._all ?? 0;

  return {
    products,
    reviewsTotal: byStatus.reduce((n, r) => n + r._count._all, 0),
    reviewsPublished: status('PUBLISHED'),
    reviewsPending: status('PENDING'),
    averageRating: ratingAgg._count._all > 0 ? (ratingAgg._avg.rating ?? null) : null,
    syncedToShopify: sync('SYNCED'),
    syncFailed: sync('FAILED'),
    awaitingSync: sync('PENDING'),
    ratedProducts,
  };
}

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  /** Optional call to action — an absolute admin URL, opened at top level. */
  action?: { label: string; url: string };
  /** Second route to the same outcome, for when the first one can't work. */
  altAction?: { label: string; url: string };
  /** Shown under the buttons: what to do if neither link does the job. */
  hint?: string;
}

/**
 * The onboarding checklist.
 *
 * Every step is derived from observable state rather than a stored flag, so it
 * cannot claim a store is set up when it isn't — the failure mode that made
 * the previous screen say "Installed" beside a store it could not read.
 */
export function getSetupSteps(
  store: Store,
  overview: DashboardOverview,
  themeBlock: ThemeBlockStatus = 'unknown',
): SetupStep[] {
  return [
    {
      key: 'connect',
      title: 'Connect your store',
      description: 'Cited is authenticated with Shopify and holding a valid access token.',
      done: true,
    },
    {
      key: 'sync',
      title: 'Sync your catalogue',
      description:
        overview.products > 0
          ? `${overview.products.toLocaleString()} products mirrored from Shopify.`
          : 'Products are imported in the background right after install.',
      done: overview.products > 0,
    },
    {
      key: 'collect',
      title: 'Collect your first review',
      description:
        overview.reviewsTotal > 0
          ? `${overview.reviewsTotal.toLocaleString()} reviews collected.`
          : 'Import existing reviews, or let review requests go out after fulfilment.',
      done: overview.reviewsTotal > 0,
    },
    {
      key: 'theme',
      title: 'Show reviews on your storefront',
      description:
        themeBlock === 'installed'
          ? 'The Cited Reviews block is live on your product pages, rendered server-side in Shopify’s own HTML.'
          : themeBlock === 'missing'
            ? 'Your product pages don’t render the block yet, so shoppers can’t see reviews. This takes one click in the theme editor.'
            : // 'unknown' means the storefront is password protected and Cited
              // was redirected to /password, NOT that the block is absent. The
              // old copy read as "not done" and sent merchants to add a block
              // they had already added, which the theme editor then refused.
              'Cited can’t check this while your storefront is password protected. If reviews already appear on a product page, this step is done — the links below are only for adding it the first time.',
      done: themeBlock === 'installed',
      action:
        themeBlock === 'installed'
          ? undefined
          : { label: 'Add block to theme', url: themeEditorDeepLink(store.shopDomain) },
      // Two links rather than one because the first can fail for a reason that
      // has nothing to do with this app: a theme whose product section doesn't
      // accept app blocks refuses the placement and blames the developer. The
      // second link asks for a section of its own, which no theme can refuse.
      altAction:
        themeBlock === 'installed'
          ? undefined
          : {
              label: 'Add as its own section',
              url: themeEditorDeepLink(store.shopDomain, 'newAppsSection'),
            },
      hint:
        themeBlock === 'installed'
          ? undefined
          : 'Easiest route: Theme settings → App embeds → turn on “Cited Reviews everywhere”. That covers every product with no placement step and no theme can refuse it. The links above place the block in one specific spot instead.',
    },
    {
      key: 'syndicate',
      title: 'Syndicate to Shopify',
      description: store.reviewScopeGranted
        ? 'Reviews are published to Shopify’s product_review metaobjects, so Shop and AI surfaces can read them.'
        : 'Pending Shopify approval of the review scope — reviews render from Cited until then.',
      done: store.reviewScopeGranted && overview.syncedToShopify > 0,
    },
  ];
}

export async function getRecentReviews(storeId: string, take = 5) {
  return prisma.review.findMany({
    where: { storeId, redactedAt: null },
    orderBy: { submittedAt: 'desc' },
    take,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      status: true,
      syncStatus: true,
      verification: true,
      submittedAt: true,
      product: { select: { title: true } },
    },
  });
}

export type ReviewStatusFilter = 'ALL' | 'PENDING' | 'PUBLISHED' | 'HIDDEN' | 'SPAM';

export async function getReviews(storeId: string, filter: ReviewStatusFilter, take = 50) {
  return prisma.review.findMany({
    where: {
      storeId,
      redactedAt: null,
      ...(filter === 'ALL' ? {} : { status: filter }),
    },
    orderBy: { submittedAt: 'desc' },
    take,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      status: true,
      syncStatus: true,
      syncError: true,
      verification: true,
      submittedAt: true,
      merchantReply: true,
      product: { select: { title: true, handle: true } },
    },
  });
}

export async function getProducts(storeId: string, take = 50) {
  return prisma.product.findMany({
    where: { storeId },
    orderBy: [{ ratingCount: 'desc' }, { title: 'asc' }],
    take,
    select: {
      id: true,
      title: true,
      handle: true,
      status: true,
      imageUrl: true,
      ratingAvg: true,
      ratingCount: true,
    },
  });
}
