'use client';

import {
  BlockStack,
  Badge,
  Banner,
  Button,
  Card,
  Grid,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from '@shopify/polaris';
import type { WidgetDef } from '@/lib/shopify/widgets';
import type { WidgetSettings } from '@/lib/widgets/settings';
import { WidgetCustomizer } from './widget-customizer';
import { WidgetPreview } from './widget-preview';

export interface WidgetCard extends WidgetDef {
  addUrl: string;
}

/**
 * Where a merchant places Cited on their storefront.
 *
 * Every card leads to the theme editor rather than to settings of our own.
 * That is not a shortcut: a widget's appearance is theme-editor state, so a
 * second set of controls in here would be a copy that silently disagrees with
 * what the storefront is actually rendering.
 */
export function WidgetsView({
  widgets,
  shopDomain,
  settings,
}: {
  widgets: WidgetCard[];
  shopDomain: string;
  settings: WidgetSettings;
}) {
  const blocks = widgets.filter((w) => w.kind === 'block');
  const embed = widgets.find((w) => w.kind === 'embed');

  return (
    <Page
      title="Widgets"
      subtitle="Choose where reviews appear on your storefront, and how they look."
    >
      <Layout>
        {embed && (
          <Layout.Section>
            <Banner tone="info" title="Not sure where to start?">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm">
                  {embed.description}
                </Text>
                <InlineStack>
                  <Button variant="primary" url={embed.addUrl} target="_blank">
                    Turn on automatic placement
                  </Button>
                </InlineStack>
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Place them yourself
            </Text>

            <Grid>
              {blocks.map((w) => (
                <Grid.Cell key={w.id} columnSpan={{ xs: 6, sm: 6, md: 2, lg: 4, xl: 4 }}>
                  <Card>
                    <BlockStack gap="300">
                      {/*
                        Above the name, not below the prose. The picture is
                        what a merchant scans a grid of seven widgets by; the
                        description is what they read once one has caught them.
                      */}
                      <WidgetPreview id={w.id} s={settings} />

                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {w.name}
                        </Text>
                        <Badge tone="success">No JavaScript</Badge>
                      </InlineStack>

                      <Text as="p" variant="bodySm" tone="subdued">
                        {w.description}
                      </Text>

                      <List type="bullet">
                        {w.points.map((p) => (
                          <List.Item key={p}>
                            <Text as="span" variant="bodySm">
                              {p}
                            </Text>
                          </List.Item>
                        ))}
                      </List>

                      {/*
                        Only "Add widget" leaves the app. Placement is
                        genuinely theme-editor work — it is the merchant
                        choosing a spot in their own layout — whereas
                        appearance is ours, and lives in the customiser above
                        so one setting covers every widget at once.
                      */}
                      <InlineStack gap="200">
                        <Button variant="primary" url={w.addUrl} target="_blank">
                          Add widget
                        </Button>
                        {/*
                          Opens on THIS widget's shape. The settings are
                          global, but a merchant who clicked Customize under
                          the carousel and was shown a product review list
                          would reasonably think the control did nothing.
                        */}
                        <WidgetCustomizer initial={settings} widgetId={w.id} />
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>
          </BlockStack>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Stars on collection pages
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Product cards in a collection grid are drawn by your theme, so no app can place a
                widget inside them. Cited keeps Shopify’s standard rating metafields up to date,
                which is what themes read — turn on “Show product rating” in your theme’s product
                card or product grid settings and stars appear on {shopDomain}’s collection pages.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
