'use client';

import { Box, Card, EmptyState, Page, Tabs } from '@shopify/polaris';
import { ReviewModeration, type ModerationRow } from './review-moderation';

export type ReviewStatusFilter = 'ALL' | 'PENDING' | 'PUBLISHED' | 'HIDDEN' | 'SPAM';

const FILTERS: { id: ReviewStatusFilter; content: string }[] = [
  { id: 'ALL', content: 'All' },
  { id: 'PENDING', content: 'Needs review' },
  { id: 'PUBLISHED', content: 'Published' },
  { id: 'HIDDEN', content: 'Hidden' },
  { id: 'SPAM', content: 'Spam' },
];

export function ReviewsView({
  reviews,
  filter,
}: {
  reviews: ModerationRow[];
  filter: ReviewStatusFilter;
}) {
  const selected = Math.max(
    0,
    FILTERS.findIndex((f) => f.id === filter),
  );

  return (
    <Page title="Reviews" subtitle="Moderate what appears on your storefront and in Shopify">
      <Card padding="0">
        {/*
          Tabs are links, not client state: the filter belongs in the URL so a
          merchant can bookmark "needs review", and so the server renders the
          right list on first paint rather than after hydration.
        */}
        <Tabs
          tabs={FILTERS.map((f) => ({
            id: f.id,
            content: f.content,
            url: `/reviews?status=${f.id}`,
          }))}
          selected={selected}
        />
        {reviews.length === 0 ? (
          <Box padding="400">
            <EmptyState
              heading={filter === 'ALL' ? 'No reviews yet' : 'Nothing in this view'}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={
                filter === 'ALL' ? undefined : { content: 'See all reviews', url: '/reviews?status=ALL' }
              }
            >
              <p>
                {filter === 'ALL'
                  ? 'Reviews arrive from requests sent after fulfilment, from your storefront widget, or from an import. They land here for moderation before they reach Shopify.'
                  : 'Nothing currently has that status.'}
              </p>
            </EmptyState>
          </Box>
        ) : (
          <ReviewModeration reviews={reviews} />
        )}
      </Card>
    </Page>
  );
}
