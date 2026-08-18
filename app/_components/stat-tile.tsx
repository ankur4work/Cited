import { BlockStack, Card, Text } from '@shopify/polaris';

/**
 * One number, its label, and one line of context.
 *
 * The context line is not decoration: a bare "0" is ambiguous — nothing to
 * show, or something broken? — and the previous screen's unqualified zeros
 * were read as an empty store when the app in fact could not read it at all.
 */
export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'critical' | 'success';
}) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="h3" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="heading2xl" tone={tone}>
          {value}
        </Text>
        {hint && (
          <Text as="p" variant="bodySm" tone={tone === 'critical' ? 'critical' : 'subdued'}>
            {hint}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}
