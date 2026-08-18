import { Badge, BlockStack, Box, InlineStack, Text } from '@shopify/polaris';

type Tone = 'success' | 'attention' | 'critical' | 'info' | undefined;

export interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string | null;
  authorName: string | null;
  status: string;
  syncStatus: string;
  verification: string;
  submittedAt: Date;
  product: { title: string } | null;
}

const STATUS_TONE: Record<string, Tone> = {
  PUBLISHED: 'success',
  PENDING: 'attention',
  HIDDEN: undefined,
  SPAM: 'critical',
  DELETED: 'critical',
};

/** Read-only review list, shared by the overview and the reviews page. */
export function ReviewRows({ reviews }: { reviews: ReviewRow[] }) {
  return (
    <BlockStack>
      {reviews.map((review, i) => (
        <Box
          key={review.id}
          padding="400"
          borderBlockStartWidth={i === 0 ? '0' : '025'}
          borderColor="border"
        >
          <BlockStack gap="150">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                <Stars rating={review.rating} />
              </Text>
              <Badge tone={STATUS_TONE[review.status]}>{titleCase(review.status)}</Badge>
              {review.verification === 'VERIFIED_BUYER' && (
                <Badge tone="success">Verified buyer</Badge>
              )}
              {review.syncStatus === 'FAILED' && <Badge tone="critical">Sync failed</Badge>}
            </InlineStack>

            {review.title && (
              <Text as="h3" variant="bodyMd" fontWeight="medium">
                {review.title}
              </Text>
            )}
            {review.body && (
              <Text as="p" variant="bodyMd" tone="subdued">
                {truncate(review.body, 220)}
              </Text>
            )}

            <Text as="p" variant="bodySm" tone="subdued">
              {[
                review.authorName || 'Anonymous',
                review.product?.title,
                formatDate(review.submittedAt),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </BlockStack>
        </Box>
      ))}
    </BlockStack>
  );
}

/**
 * Rating as filled/empty stars plus the number.
 *
 * The numeral is not redundant with the stars — it is what a screen reader
 * announces, and what survives when the glyphs fail to render in a merchant's
 * font.
 */
function Stars({ rating }: { rating: number }) {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span aria-label={`${clamped} out of 5 stars`}>
      {'★'.repeat(clamped)}
      {'☆'.repeat(5 - clamped)} {clamped}/5
    </span>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date);
}
