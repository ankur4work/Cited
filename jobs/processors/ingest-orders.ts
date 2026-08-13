import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { encrypt, hashEmail } from '@/lib/crypto';
import { ShopifyClient } from '@/lib/shopify/client';
import { runBulkQuery } from '@/lib/shopify/bulk';
import type { IngestionJobData, IngestionJobName } from '../queue';

/**
 * Mirror recent orders locally.
 *
 * Backfill exists to make verified-buyer status meaningful from day one: if
 * a reviewer's email matches a historical purchase of that product, the
 * review is verified rather than unverified. Review REQUESTS for new orders
 * are driven by the orders/fulfilled webhook, not by this job.
 *
 * That distinction is why `fulfilledAt` is not read here. Fetching
 * fulfillments inside a bulk operation is awkward (the field takes
 * arguments, which bulk queries constrain), and this job doesn't need it —
 * the webhook carries an accurate fulfillment time for every order that
 * could still trigger an email. Backfilled orders are historical and are
 * marked as already-scheduled so they can never generate a retroactive
 * blast to months of past customers.
 *
 * Bulk JSONL emits a parent order followed immediately by its line items
 * (each carrying __parentId), so orders are assembled by watching for the
 * next parent rather than by buffering the whole file.
 */

interface BulkOrderNode {
  id: string;
  name?: string;
  processedAt?: string | null;
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currencyCode?: string | null;
  email?: string | null;
  totalPriceSet?: { shopMoney?: { amount?: string } } | null;
  customer?: { email?: string | null; firstName?: string | null; lastName?: string | null } | null;
  __parentId?: string;
  // Line-item shape (arrives as a child record):
  title?: string;
  quantity?: number;
  product?: { id?: string } | null;
  variant?: { id?: string } | null;
}

interface AssembledOrder {
  node: BulkOrderNode;
  items: BulkOrderNode[];
}

const BATCH_SIZE = 200;

function ordersQuery(sinceDays: number): string {
  // Bulk queries cannot take a date object, so the filter is a query string.
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  return /* GraphQL */ `
    {
      orders(query: "created_at:>=${since}") {
        edges {
          node {
            id
            name
            processedAt
            cancelledAt
            displayFinancialStatus
            displayFulfillmentStatus
            currencyCode
            email
            totalPriceSet { shopMoney { amount } }
            customer { email firstName lastName }
            lineItems {
              edges {
                node {
                  id
                  title
                  quantity
                  product { id }
                  variant { id }
                }
              }
            }
          }
        }
      }
    }
  `;
}

export async function ingestOrdersProcessor(
  job: Job<IngestionJobData, unknown, IngestionJobName>,
): Promise<void> {
  const { storeId, shopDomain, sinceDays = 90 } = job.data;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, shopDomain: true, accessToken: true, uninstalledAt: true },
  });

  if (!store || store.uninstalledAt) {
    logger.warn({ storeId, shopDomain }, 'Skipping order ingest — store missing or uninstalled');
    return;
  }

  const client = new ShopifyClient(store);

  let current: AssembledOrder | null = null;
  let batch: AssembledOrder[] = [];
  let total = 0;

  const flushBatch = async () => {
    if (batch.length === 0) return;

    // Resolve product GIDs to local product rows once per batch rather than
    // once per line item — one query instead of hundreds.
    const gids = [
      ...new Set(
        batch.flatMap((o) => o.items.map((i) => i.product?.id).filter((x): x is string => !!x)),
      ),
    ];
    const products = gids.length
      ? await prisma.product.findMany({
          where: { storeId, shopifyGid: { in: gids } },
          select: { id: true, shopifyGid: true },
        })
      : [];
    const productByGid = new Map(products.map((p) => [p.shopifyGid, p.id]));

    for (const assembled of batch) {
      const n = assembled.node;
      const email = n.customer?.email ?? n.email ?? null;
      const name = [n.customer?.firstName, n.customer?.lastName].filter(Boolean).join(' ') || null;
      const amount = n.totalPriceSet?.shopMoney?.amount;

      const data = {
        orderNumber: n.name ?? null,
        customerEmailEnc: email ? encrypt(email) : null,
        customerEmailHash: email ? hashEmail(email) : null,
        customerName: name,
        currency: n.currencyCode ?? null,
        totalCents: amount ? Math.round(Number(amount) * 100) : null,
        processedAt: n.processedAt ? new Date(n.processedAt) : null,
        cancelledAt: n.cancelledAt ? new Date(n.cancelledAt) : null,
        financialStatus: n.displayFinancialStatus ?? null,
        fulfillmentStatus: n.displayFulfillmentStatus ?? null,
      };

      const order = await prisma.order.upsert({
        where: { storeId_shopifyGid: { storeId, shopifyGid: n.id } },
        create: {
          storeId,
          shopifyGid: n.id,
          ...data,
          // Backfilled orders are historical. Marking them scheduled means a
          // freshly installed store can never blast months of past customers
          // with review requests — the failure mode that gets an app
          // uninstalled and 1-starred on day one.
          requestScheduledAt: new Date(),
        },
        update: data,
      });

      // Replace line items wholesale: cheaper and more correct than
      // diffing, since edits can remove items as well as add them.
      await prisma.orderLineItem.deleteMany({ where: { orderId: order.id } });
      if (assembled.items.length > 0) {
        await prisma.orderLineItem.createMany({
          data: assembled.items.map((i) => ({
            storeId,
            orderId: order.id,
            productShopifyGid: i.product?.id ?? null,
            variantShopifyGid: i.variant?.id ?? null,
            productId: i.product?.id ? (productByGid.get(i.product.id) ?? null) : null,
            title: i.title ?? 'Item',
            quantity: i.quantity ?? 1,
          })),
        });
      }
    }

    total += batch.length;
    batch = [];
    await job.updateProgress({ orders: total });
  };

  const pushCurrent = async () => {
    if (!current) return;
    batch.push(current);
    current = null;
    if (batch.length >= BATCH_SIZE) await flushBatch();
  };

  await runBulkQuery<BulkOrderNode>(client, ordersQuery(sinceDays), async (node) => {
    if (node.__parentId) {
      // Child record — a line item belonging to the order being assembled.
      if (current && current.node.id === node.__parentId) current.items.push(node);
      return;
    }
    if (!node.id?.includes('/Order/')) return;

    await pushCurrent();
    current = { node, items: [] };
  });

  await pushCurrent();
  await flushBatch();

  logger.info({ storeId, shopDomain, orders: total, sinceDays }, 'Order ingest complete');
}
