'use client';

import { Banner, BlockStack, Card, List, Page, Text } from '@shopify/polaris';

/**
 * Asks the merchant to widen the app's permissions.
 *
 * Cited otherwise goes out of its way never to show Shopify's authorize
 * screen — under managed installation it should not appear, and appearing
 * after install is what made the app feel broken. This is the exception that
 * proves it: a scope the app did not previously hold cannot be obtained any
 * other way, and no amount of token refreshing will produce one, because a
 * refresh mints a replacement with the same grant.
 *
 * The link is `target="_top"`, not a fetch or a router push: Shopify serves
 * accounts.shopify.com with framing denied, so navigating the admin's iframe
 * to it renders nothing at all.
 */
export function ScopeUpgrade({ shop, missing }: { shop: string; missing: string[] }) {
  return (
    <Page title="Cited">
      <Card>
        <BlockStack gap="400">
          <Banner tone="warning" title="Cited needs one more permission">
            <p>
              Ratings cannot be published to Shopify until this is granted. Reviews are
              still being collected and stored — nothing is lost.
            </p>
          </Banner>

          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              Shopify requires review apps to keep each product’s rating on the product
              itself, which needs permission to write to products. Cited was installed
              before it asked for that.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Permission{missing.length === 1 ? '' : 's'} being requested:
            </Text>
            <List type="bullet">
              {missing.map((scope) => (
                <List.Item key={scope}>{scope}</List.Item>
              ))}
            </List>
          </BlockStack>

          <div>
            <a
              href={`/api/auth?shop=${encodeURIComponent(shop)}`}
              target="_top"
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                background: '#303030',
                color: '#fff',
                borderRadius: 8,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Review permissions
            </a>
          </div>
        </BlockStack>
      </Card>
    </Page>
  );
}
