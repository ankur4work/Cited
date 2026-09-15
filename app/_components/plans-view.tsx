'use client';

import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Text,
} from '@shopify/polaris';
import type { Plan } from '@prisma/client';
import { PLAN_TIERS } from '@/lib/plans';

/**
 * In-app plan comparison.
 *
 * Deliberately NOT a checkout. Shopify hosts the plan selection page and owns
 * the charge; every upgrade button here is a link out to it. Building our own
 * checkout would mean handling money Shopify has already agreed to handle, and
 * an app that takes card details for a Shopify subscription fails review.
 *
 * What this page is for is the thing Shopify's hosted page does badly: showing
 * a merchant what they currently have, what the next tier adds, and why — in
 * the app where they are already standing.
 */
export function PlansView({
  plan,
  planSelectionUrl,
}: {
  plan: Plan;
  planSelectionUrl: string;
}) {
  return (
    <Page
      title="Plans"
      subtitle="Upgrades are handled by Shopify and billed to your existing invoice"
    >
      <BlockStack gap="400">
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          {PLAN_TIERS.map((tier) => {
            const current = tier.id === plan;
            return (
              <Card key={tier.id}>
                <BlockStack gap="300">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingMd">
                        {tier.name}
                      </Text>
                      {current && <Badge tone="success">Current plan</Badge>}
                    </InlineStack>
                    <Text as="p" variant="headingLg">
                      {tier.priceLabel}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {tier.tagline}
                    </Text>
                  </BlockStack>

                  <BlockStack gap="150">
                    {tier.inherits && (
                      <Text as="p" variant="bodySm" fontWeight="semibold">
                        Everything in {tier.inherits}, plus:
                      </Text>
                    )}
                    {tier.features.map((feature) => (
                      <InlineStack key={feature} gap="200" wrap={false} blockAlign="start">
                        {/* Decorative: the feature text is the content, and a
                            screen reader announcing "check mark" before every
                            line is noise. */}
                        <Text as="span" tone="success" aria-hidden="true">
                          ✓
                        </Text>
                        <Text as="span" variant="bodySm">
                          {feature}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>

                  <Box>
                    {current ? (
                      <Button disabled fullWidth>
                        Your plan
                      </Button>
                    ) : (
                      <Button
                        url={planSelectionUrl}
                        target="_top"
                        variant={tier.id === 'PRO' ? 'primary' : 'secondary'}
                        fullWidth
                      >
                        {tier.id === 'FREE' ? 'Switch to Free' : `Choose ${tier.name}`}
                      </Button>
                    )}
                  </Box>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        <Text as="p" variant="bodySm" tone="subdued">
          Changing plans opens Shopify’s billing page. Charges appear on your
          existing Shopify invoice — this app never sees your payment details.
          Development stores can select any plan at no charge.
        </Text>
      </BlockStack>
    </Page>
  );
}
