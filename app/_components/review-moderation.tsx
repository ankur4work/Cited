'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, BlockStack, Box, Button, InlineStack, Text, Toast } from '@shopify/polaris';
import type { ReviewRow } from './review-rows';

export interface ModerationRow extends ReviewRow {
  syncError?: string | null;
  merchantReply?: string | null;
  product: { title: string; handle?: string } | null;
}

const STATUS_TONE: Record<string, 'success' | 'attention' | 'critical' | undefined> = {
  PUBLISHED: 'success',
  PENDING: 'attention',
  HIDDEN: undefined,
  SPAM: 'critical',
};

/**
 * Reviews with moderation controls.
 *
 * Client-side because each row acts, but it still renders server-fetched data
 * — the list is passed in, not fetched here, so the first paint is complete
 * and moderation is the only thing that needs JavaScript.
 */
export function ReviewModeration({ reviews }: { reviews: ModerationRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  const moderate = useCallback(
    async (id: string, status: string) => {
      setPendingId(id);
      try {
        const idToken = await window.shopify?.idToken?.();
        if (!idToken) throw new Error('not authenticated');

        const res = await fetch(`/api/reviews/${id}/status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${idToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error(`request failed (${res.status})`);

        setToast({ message: status === 'PUBLISHED' ? 'Review published' : 'Review updated' });
        router.refresh();
      } catch (err) {
        setToast({ message: (err as Error).message, error: true });
      } finally {
        setPendingId(null);
      }
    },
    [router],
  );

  return (
    <>
      <BlockStack>
        {reviews.map((review, i) => (
          <Box
            key={review.id}
            padding="400"
            borderBlockStartWidth={i === 0 ? '0' : '025'}
            borderColor="border"
          >
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center" wrap>
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {'★'.repeat(review.rating)}
                  {'☆'.repeat(Math.max(0, 5 - review.rating))} {review.rating}/5
                </Text>
                <Badge tone={STATUS_TONE[review.status]}>{titleCase(review.status)}</Badge>
                {review.verification === 'VERIFIED_BUYER' && (
                  <Badge tone="success">Verified buyer</Badge>
                )}
                {review.syncStatus === 'FAILED' && (
                  <Badge tone="critical">Not on Shopify</Badge>
                )}
              </InlineStack>

              {review.title && (
                <Text as="h3" variant="bodyMd" fontWeight="medium">
                  {review.title}
                </Text>
              )}
              {review.body && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  {review.body}
                </Text>
              )}

              <Text as="p" variant="bodySm" tone="subdued">
                {[review.authorName || 'Anonymous', review.product?.title, formatDate(review.submittedAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>

              {review.syncError && (
                <Text as="p" variant="bodySm" tone="critical">
                  Sync error: {review.syncError}
                </Text>
              )}

              <InlineStack gap="200">
                {review.status !== 'PUBLISHED' && (
                  <Button
                    variant="primary"
                    size="slim"
                    loading={pendingId === review.id}
                    onClick={() => moderate(review.id, 'PUBLISHED')}
                  >
                    Publish
                  </Button>
                )}
                {review.status !== 'HIDDEN' && (
                  <Button
                    size="slim"
                    loading={pendingId === review.id}
                    onClick={() => moderate(review.id, 'HIDDEN')}
                  >
                    Hide
                  </Button>
                )}
                {review.status !== 'SPAM' && (
                  <Button
                    size="slim"
                    tone="critical"
                    loading={pendingId === review.id}
                    onClick={() => moderate(review.id, 'SPAM')}
                  >
                    Mark spam
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Box>
        ))}
      </BlockStack>

      {toast && (
        <Toast
          content={toast.message}
          error={toast.error}
          onDismiss={() => setToast(null)}
          duration={4000}
        />
      )}
    </>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(date));
}
