'use client';

import {
  BlockStack,
  Badge,
  Banner,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  List,
  Page,
  Text,
} from '@shopify/polaris';
import { themeEditorUrl, type WidgetDef } from '@/lib/shopify/widgets';
import type { WidgetSettings } from '@/lib/widgets/settings';
import { AddWidgetModal } from './add-widget-modal';
import { WidgetCustomizer } from './widget-customizer';
import { WidgetPlacement } from './widget-placement';

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

            {/*
              InlineGrid, not Grid: CSS grid stretches every item in a row to
              the tallest, which is what makes the cards match. Polaris Card
              cannot be told to fill that height — it takes no style or
              className — so each card is a Box, which accepts minHeight, with
              a flex column inside doing the aligning.
            */}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {blocks.map((w) => (
                <Box
                  key={w.id}
                  background="bg-surface"
                  borderRadius="300"
                  padding="400"
                  shadow="100"
                  minHeight="100%"
                >
                  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                    <BlockStack gap="300">
                      {/*
                        A floor plan, not a thumbnail.

                        This was a zoomed-in drawing of the widget, which
                        answers "what does it look like" and leaves the
                        question a merchant actually has — where does it go,
                        and where is my product in relation to it — completely
                        unanswered. The appearance preview still exists; it
                        lives in the customiser, where colours are the thing
                        being chosen.
                      */}
                      <WidgetPlacement id={w.id} />

                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h3" variant="headingSm">
                          {w.name}
                        </Text>
                        <Badge tone="success">No JavaScript</Badge>
                      </InlineStack>

                      {/*
                        Where it lands, before the prose describing what it is.
                        Seven drawings with no location told a merchant nothing
                        about which of them are product-page widgets and which
                        are not — and, once placed, gave them nowhere to go and
                        look at the result.
                      */}
                      <Text as="p" variant="bodySm" tone="subdued" fontWeight="medium">
                        {w.where}
                      </Text>

                      {/*
                        Clamped to three lines. One long description would
                        otherwise set the height of every card in its row,
                        and these are meant to be scanned, not read.
                      */}
                      <div
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        <Text as="p" variant="bodySm" tone="subdued">
                          {w.description}
                        </Text>
                      </div>

                      <List type="bullet">
                        {w.points.map((p) => (
                          <List.Item key={p}>
                            <Text as="span" variant="bodySm">
                              {p}
                            </Text>
                          </List.Item>
                        ))}
                      </List>
                    </BlockStack>

                    {/*
                      marginTop:auto is what lines the buttons up. The lists
                      above differ in length — three bullets here, four there
                      — so without it every card's actions sit at a different
                      height and the grid reads as broken.

                      Only "Add widget" leaves the app, and it asks first:
                      which theme, and which page. Guessing those was what made
                      the button feel broken — a merchant mid-redesign was sent
                      to their live theme, and every widget was offered the
                      product template whether or not the theme had one.
                    */}
                    <div style={{ marginTop: 'auto', paddingTop: 16 }}>
                      <InlineStack gap="200">
                        <AddWidgetModal
                          widget={w}
                          shopDomain={shopDomain}
                          fallbackUrl={w.addUrl}
                          embedUrl={embed?.addUrl}
                          buildUrl={(opts) => themeEditorUrl(shopDomain, w, opts)}
                        />
                        {/*
                          Opens on THIS widget's shape. The settings are
                          global, but a merchant who clicked Customize under
                          the carousel and was shown a product review list
                          would reasonably think the control did nothing.
                        */}
                        <WidgetCustomizer initial={settings} widgetId={w.id} />
                      </InlineStack>
                    </div>
                  </div>
                </Box>
              ))}
            </InlineGrid>
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
