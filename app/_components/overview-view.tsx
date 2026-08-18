'use client';

import {
  Badge,
  BlockStack,
  Box,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
} from '@shopify/polaris';
import type { DashboardOverview, SetupStep } from '@/lib/dashboard';
import { StatTile } from './stat-tile';
import { SetupChecklist } from './setup-checklist';
import { ReviewRows, type ReviewRow } from './review-rows';

/**
 * The overview screen.
 *
 * A client component because Polaris is context-driven and cannot render in a
 * React Server Component. All the data still comes from the server — the page
 * queries the database and passes plain props — so this renders once with real
 * numbers rather than fetching after hydration.
 */
export function OverviewView({
  shopDomain,
  reviewScopeGranted,
  overview,
  steps,
  recent,
}: {
  shopDomain: string;
  reviewScopeGranted: boolean;
  overview: DashboardOverview;
  steps: SetupStep[];
  recent: ReviewRow[];
}) {
  const setupComplete = steps.every((s) => s.done);

  return (
    <Page
      title="Overview"
      subtitle={shopDomain}
      titleMetadata={
        reviewScopeGranted ? (
          <Badge tone="success">Syndicating to Shopify</Badge>
        ) : (
          <Badge tone="attention">Review scope pending</Badge>
        )
      }
    >
      <Layout>
        {!setupComplete && (
          <Layout.Section>
            <SetupChecklist steps={steps} />
          </Layout.Section>
        )}

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <StatTile
              label="Products synced"
              value={overview.products.toLocaleString()}
              hint={
                overview.ratedProducts > 0
                  ? `${overview.ratedProducts.toLocaleString()} with reviews`
                  : 'Mirrored from Shopify'
              }
            />
            <StatTile
              label="Reviews"
              value={overview.reviewsTotal.toLocaleString()}
              hint={
                overview.reviewsPending > 0
                  ? `${overview.reviewsPending.toLocaleString()} awaiting moderation`
                  : 'All moderated'
              }
            />
            <StatTile
              label="Average rating"
              value={overview.averageRating ? overview.averageRating.toFixed(2) : '—'}
              hint={
                overview.reviewsPublished > 0
                  ? `Across ${overview.reviewsPublished.toLocaleString()} published`
                  : 'No published reviews yet'
              }
            />
            <StatTile
              label="On Shopify"
              value={overview.syncedToShopify.toLocaleString()}
              hint={
                overview.syncFailed > 0
                  ? `${overview.syncFailed} failed to sync`
                  : overview.awaitingSync > 0
                    ? `${overview.awaitingSync} queued`
                    : 'Metaobjects up to date'
              }
              tone={overview.syncFailed > 0 ? 'critical' : undefined}
            />
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Latest reviews
                </Text>
                <Link url="/reviews">View all</Link>
              </InlineStack>
            </Box>
            {recent.length === 0 ? (
              <Box padding="400">
                <Text as="p" tone="subdued">
                  No reviews yet. Once your catalogue finishes syncing, review requests go
                  out after fulfilment and land here for moderation.
                </Text>
              </Box>
            ) : (
              <ReviewRows reviews={recent} />
            )}
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">
                Why syndication matters
              </Text>
              <Text as="p" tone="subdued">
                Reviews written into Shopify’s standard <code>product_review</code>{' '}
                metaobjects are readable by the Shop app, Google’s product surfaces and AI
                shopping assistants. Reviews that live only inside an app’s own widget are
                invisible to all three.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
