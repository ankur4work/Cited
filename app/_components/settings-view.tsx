'use client';

import { Badge, BlockStack, Card, InlineStack, Layout, Page, Text } from '@shopify/polaris';
import { SettingsForm } from './settings-form';
import { CampaignSettings, type CampaignRow } from './campaign-settings';

export function SettingsView({
  shopDomain,
  plan,
  reviewScopeGranted,
  scope,
  installedAt,
  accessTokenExpiresAt,
  analyticsPixelEnabled,
  gdprMode,
  campaign,
}: {
  shopDomain: string;
  plan: string;
  reviewScopeGranted: boolean;
  scope: string | null;
  installedAt: Date;
  accessTokenExpiresAt: Date | null;
  analyticsPixelEnabled: boolean;
  gdprMode: boolean;
  /** Null only if the default campaign could not be created at install. */
  campaign: CampaignRow | null;
}) {
  return (
    <Page title="Settings" subtitle={shopDomain}>
      <Layout>
        {/*
          First on the page, above the privacy toggles. Collecting reviews is
          the thing a new merchant needs to do before anything else in this app
          has data to work with.
        */}
        {campaign && (
          <Layout.Section>
            <CampaignSettings campaign={campaign} />
          </Layout.Section>
        )}

        <Layout.Section>
          <SettingsForm
            analyticsPixelEnabled={analyticsPixelEnabled}
            gdprMode={gdprMode}
          />
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Install
              </Text>

              <Row label="Plan">
                <Badge tone={plan === 'FREE' ? undefined : 'success'}>{plan}</Badge>
              </Row>

              <Row label="Review metaobject access">
                {reviewScopeGranted ? (
                  <Badge tone="success">Granted</Badge>
                ) : (
                  <Badge tone="attention">Pending Shopify approval</Badge>
                )}
              </Row>

              <Row label="Connection">
                {/*
                  Shown because a merchant asking "why is nothing syncing"
                  deserves to see whether the app can talk to Shopify at all.
                  The token is never rendered — only whether one is held.
                */}
                <Text as="span" variant="bodyMd" tone="subdued">
                  {accessTokenExpiresAt
                    ? `Connected · renews automatically`
                    : 'Not established'}
                </Text>
              </Row>

              <Row label="Scopes">
                <Text as="span" variant="bodySm" tone="subdued">
                  {scope ?? '—'}
                </Text>
              </Row>

              <Row label="Installed">
                <Text as="span" variant="bodyMd" tone="subdued">
                  {formatDate(installedAt)}
                </Text>
              </Row>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <InlineStack align="space-between" blockAlign="center" gap="400" wrap={false}>
      <Text as="span" variant="bodyMd" tone="subdued">
        {label}
      </Text>
      <div style={{ textAlign: 'right' }}>{children}</div>
    </InlineStack>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(date));
}
