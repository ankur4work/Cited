'use client';

import {
  Badge,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Page,
  Text,
  Thumbnail,
} from '@shopify/polaris';

export interface ProductRow {
  id: string;
  title: string;
  handle: string;
  status: string | null;
  imageUrl: string | null;
  ratingAvg: number;
  ratingCount: number;
}

export function ProductsView({ products }: { products: ProductRow[] }) {
  if (products.length === 0) {
    return (
      <Page title="Products" subtitle="Your catalogue, mirrored from Shopify">
        <Card>
          <EmptyState
            heading="No products synced yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              Cited imports your catalogue in the background after install and keeps it
              current through product webhooks. If this stays empty, the import job is
              stuck — it does not mean your store is empty.
            </p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Products"
      subtitle={`${products.length.toLocaleString()} products · ratings mirrored to Shopify metafields`}
    >
      <Card padding="0">
        <IndexTable
          resourceName={{ singular: 'product', plural: 'products' }}
          itemCount={products.length}
          selectable={false}
          headings={[
            { title: 'Product' },
            { title: 'Status' },
            { title: 'Rating' },
            { title: 'Reviews' },
          ]}
        >
          {products.map((product, index) => (
            <IndexTable.Row id={product.id} key={product.id} position={index}>
              <IndexTable.Cell>
                <InlineStack gap="300" blockAlign="center" wrap={false}>
                  <Thumbnail source={product.imageUrl ?? ''} alt="" size="small" />
                  <Text as="span" variant="bodyMd" fontWeight="medium">
                    {product.title}
                  </Text>
                </InlineStack>
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Badge tone={product.status === 'ACTIVE' ? 'success' : undefined}>
                  {product.status ? titleCase(product.status) : 'Unknown'}
                </Badge>
              </IndexTable.Cell>
              <IndexTable.Cell>
                {product.ratingCount > 0 ? (
                  <Text as="span" variant="bodyMd">
                    {product.ratingAvg.toFixed(2)} ★
                  </Text>
                ) : (
                  <Text as="span" variant="bodyMd" tone="subdued">
                    —
                  </Text>
                )}
              </IndexTable.Cell>
              <IndexTable.Cell>
                <Text as="span" variant="bodyMd">
                  {product.ratingCount.toLocaleString()}
                </Text>
              </IndexTable.Cell>
            </IndexTable.Row>
          ))}
        </IndexTable>
      </Card>
    </Page>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
