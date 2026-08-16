import { NextRequest, NextResponse } from 'next/server';
import { Prisma, type ComplianceRequestType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyWebhookRequest } from '@/lib/shopify/webhook';
import {
  COMPLIANCE_TOPICS,
  isComplianceTopic,
  parseCompliancePayload,
  type ComplianceTopic,
} from '@/lib/compliance/payload';
import { hashEmail } from '@/lib/crypto';
import { enqueueCompliancePurge } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `customers/data_request`, `customers/redact`, `shop/redact`.
 *
 * The three topics every Shopify app must handle, and the ones the App Store
 * review process actually tests by calling them. A 404 here fails submission
 * regardless of what the app does otherwise.
 *
 * All three land on one route because they share everything that matters:
 * signature verification, subject identification, and the ledger row that
 * proves the request was received. The topic header decides the work, and the
 * work happens on the maintenance queue — an erasure can touch thousands of
 * rows across half a dozen tables, which is not something to attempt inside a
 * five-second webhook timeout.
 *
 * The response is deliberately uninformative. These endpoints are
 * unauthenticated to anyone who has not signed the body, so "no such shop" and
 * "erased 14 rows" are both just 200 with no detail.
 */

const TOPIC_TO_TYPE: Record<ComplianceTopic, ComplianceRequestType> = {
  [COMPLIANCE_TOPICS.DATA_REQUEST]: 'DATA_REQUEST',
  [COMPLIANCE_TOPICS.CUSTOMER_REDACT]: 'CUSTOMER_REDACT',
  [COMPLIANCE_TOPICS.SHOP_REDACT]: 'SHOP_REDACT',
};

/**
 * Shopify allows 30 days to answer a data request or an erasure. shop/redact
 * already waited 48 hours after uninstall, so it is due immediately.
 */
function dueAtFor(type: ComplianceRequestType): Date {
  if (type === 'SHOP_REDACT') return new Date();
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

export async function POST(req: NextRequest) {
  const verification = await verifyWebhookRequest(req);

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'Compliance webhook rejected');
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  const { topic, shopDomain, webhookId, payload } = verification.webhook;

  if (!isComplianceTopic(topic)) {
    // Misrouted config rather than an attack — 200 so Shopify stops retrying
    // something this route will never act on.
    logger.warn({ topic, shopDomain }, 'Non-compliance topic delivered to privacy route');
    return NextResponse.json({ ok: true, ignored: 'wrong_topic' });
  }

  const type = TOPIC_TO_TYPE[topic];
  const parsed = parseCompliancePayload(payload);

  // Trust the signed header over the body. Both should agree; if they ever
  // don't, the header is the one Shopify authenticated.
  if (parsed.shopDomain && parsed.shopDomain !== shopDomain) {
    logger.warn(
      { topic, headerShop: shopDomain, bodyShop: parsed.shopDomain },
      'Compliance webhook shop domain mismatch between header and body',
    );
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  // A missing store is normal, not an error: shop/redact can arrive after the
  // records are already gone, and Shopify sends compliance webhooks for shops
  // that never completed an install. The ledger row is still written — "we
  // received this and had nothing to erase" is itself the audit answer.
  if (!store) {
    logger.info({ shopDomain, topic }, 'Compliance webhook for unknown store');
  }

  let requestId: string;
  try {
    const record = await prisma.complianceRequest.create({
      data: {
        storeId: store?.id ?? null,
        shopDomain,
        type,
        shopifyWebhookId: webhookId,
        customerShopifyId: parsed.customerShopifyId,
        // Hashed, never stored raw — the record proving we erased an address
        // must not retain the address.
        customerEmailHash: parsed.customerEmail ? hashEmail(parsed.customerEmail) : null,
        orderGids: parsed.orderGids,
        dueAt: dueAtFor(type),
      },
      select: { id: true },
    });
    requestId = record.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Shopify redelivered. The original is already queued or done.
      logger.debug({ shopDomain, topic, webhookId }, 'Compliance webhook already recorded');
      return NextResponse.json({ ok: true, duplicate: true });
    }
    throw err;
  }

  try {
    await enqueueCompliancePurge({
      complianceRequestId: requestId,
      storeId: store?.id ?? null,
      shopDomain,
      // The plaintext address is passed to the job rather than re-read from
      // the ledger, which only ever holds the hash. It lives in the job
      // payload for the minutes until the purge runs and is never persisted:
      // matching an order requires the same keyed hash, but answering a data
      // request requires the address itself.
      customerEmail: parsed.customerEmail,
      orderGids: parsed.orderGids,
      type,
    });
  } catch (err) {
    // The ledger row stays. It is now a RECEIVED request with nothing queued,
    // which the overdue sweep will pick up — better than deleting the only
    // evidence the request arrived.
    logger.error(
      { shopDomain, topic, requestId, err: (err as Error).message },
      'Failed to enqueue compliance purge — request recorded but not scheduled',
    );
    return NextResponse.json({ error: 'enqueue failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
