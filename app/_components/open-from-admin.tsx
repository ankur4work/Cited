'use client';

import { Card, EmptyState, Page } from '@shopify/polaris';

/** Shown when the app is opened outside Shopify admin, with no shop context. */
export function OpenFromAdmin({ title = 'Cited' }: { title?: string }) {
  return (
    <Page title={title}>
      <Card>
        <EmptyState
          heading="Open Cited from your Shopify admin"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>
            This app runs inside the Shopify admin. Open it from Apps → Cited in your
            store and it will sign you in automatically — there is nothing to authorize.
          </p>
        </EmptyState>
      </Card>
    </Page>
  );
}
