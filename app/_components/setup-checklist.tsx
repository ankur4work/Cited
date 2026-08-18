import { BlockStack, Box, Card, Icon, InlineStack, ProgressBar, Text } from '@shopify/polaris';
import { CheckCircleIcon, CircleChevronRightIcon } from '@shopify/polaris-icons';
import type { SetupStep } from '@/lib/dashboard';

/** Setup progress, derived from real state rather than a stored flag. */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  const progress = Math.round((done / steps.length) * 100);

  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="h2" variant="headingMd">
              Set up Cited
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {done} of {steps.length} done
            </Text>
          </InlineStack>
          <ProgressBar progress={progress} size="small" tone="primary" />
        </BlockStack>

        <BlockStack gap="300">
          {steps.map((step) => (
            <InlineStack key={step.key} gap="300" blockAlign="start" wrap={false}>
              <Box paddingBlockStart="050">
                <Icon
                  source={step.done ? CheckCircleIcon : CircleChevronRightIcon}
                  tone={step.done ? 'success' : 'subdued'}
                />
              </Box>
              <BlockStack gap="050">
                <Text as="h3" variant="bodyMd" fontWeight="medium">
                  {step.title}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {step.description}
                </Text>
              </BlockStack>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
