import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import { runBulkQuery } from '@/lib/shopify/bulk';
import type { IngestionJobData, IngestionJobName } from '../queue';

/**
 * Mirror the store's catalog locally.
 *
 * Uses a bulk operation rather than paginated queries: a 50k-product store
 * would be thousands of paginated calls against a shared rate-limit bucket,
 * whereas one bulk op streams JSONL and costs a single query. bulk.ts already
 * streams line-by-line, so memory stays flat regardless of catalog size.
 *
 * Upserts are keyed on (storeId, shopifyGid), so re-running is safe and
 * cheap. Rating aggregates are deliberately NOT touched here — they are
 * owned by the review pipeline, and clobbering them with defaults on every
 * catalog resync would wipe live rating data.
 */

const PRODUCTS_BULK_QUERY = /* GraphQL */ `
  {
    products {
      edges {
        node {
          id
          handle
          title
          status
          featuredImage { url }
        }
      }
    }
  }
`;

interface BulkProductNode {
  id: string;
  handle?: string;
  title?: string;
  status?: string;
  featuredImage?: { url?: string } | null;
  // Bulk JSONL interleaves child records; children carry __parentId.
  __parentId?: string;
}

const BATCH_SIZE = 500;

export async function ingestProductsProcessor(
  job: Job<IngestionJobData, unknown, IngestionJobName>,
): Promise<void> {
  const { storeId, shopDomain } = job.data;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, shopDomain: true, accessToken: true, uninstalledAt: true },
  });

  if (!store || store.uninstalledAt) {
    logger.warn({ storeId, shopDomain }, 'Skipping product ingest — store missing or uninstalled');
    return;
  }

  const client = new ShopifyClient(store);
  let batch: BulkProductNode[] = [];
  let total = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    // Sequential within a batch: Prisma has no bulk upsert, and firing 500
    // concurrent upserts would exhaust the connection pool. Batching bounds
    // memory; the transaction bounds round-trips.
    await prisma.$transaction(
      batch.map((n) =>
        prisma.product.upsert({
          where: { storeId_shopifyGid: { storeId, shopifyGid: n.id } },
          create: {
            storeId,
            shopifyGid: n.id,
            handle: n.handle ?? '',
            title: n.title ?? 'Untitled',
            status: n.status ?? null,
            imageUrl: n.featuredImage?.url ?? null,
          },
          update: {
            handle: n.handle ?? '',
            title: n.title ?? 'Untitled',
            status: n.status ?? null,
            imageUrl: n.featuredImage?.url ?? null,
            // ratingAvg / ratingCount intentionally omitted — owned by the
            // review pipeline. Writing defaults here would erase live data.
          },
        }),
      ),
    );
    total += batch.length;
    batch = [];
    await job.updateProgress({ products: total });
  };

  const { objectCount } = await runBulkQuery<BulkProductNode>(
    client,
    PRODUCTS_BULK_QUERY,
    async (node) => {
      // Only top-level products. Child connections would arrive with a
      // __parentId; ignoring them keeps this resilient if the query later
      // grows a nested field.
      if (node.__parentId) return;
      if (!node.id?.includes('/Product/')) return;

      batch.push(node);
      if (batch.length >= BATCH_SIZE) await flush();
    },
  );

  await flush();

  logger.info(
    { storeId, shopDomain, upserted: total, objectCount },
    'Product ingest complete',
  );
}
