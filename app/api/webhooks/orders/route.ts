import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyWebhookRequest, claimWebhookEvent, releaseWebhookEvent } from '@/lib/shopify/webhook';
import { enqueueOrderSync } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `orders/paid`, `orders/fulfilled` — the trigger for the review-request
 * engine.
 *
 * These are the two topics that carry protected customer data, and the reason
 * the app needs protected customer data access at all. Nothing here reads the
 * customer: the handler records the delivery and schedules a debounced
 * incremental pull, and the ingestion processor is the single place that
 * touches an address.
 *
 * That is deliberate rather than incidental. Keeping identity handling in one
 * processor means the encryption, hashing and audit rules are written once,
 * instead of once per webhook that happens to carry an email.
 */
export async function POST(req: NextRequest) {
  const verification = await verifyWebhookRequest(req);

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'Order webhook rejected');
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  const { topic, shopDomain, webhookId, payload } = verification.webhook;

  if (!topic.startsWith('orders/')) {
    logger.warn({ topic, shopDomain }, 'Non-order topic delivered to orders route');
    return NextResponse.json({ ok: true, ignored: 'wrong_topic' });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, uninstalledAt: true },
  });

  if (!store || store.uninstalledAt) {
    logger.info({ shopDomain, topic }, 'Order webhook for unknown or uninstalled store');
    return NextResponse.json({ ok: true, ignored: 'store_not_installed' });
  }

  // Envelope only. The body carries the customer's email, name and shipping
  // address, and this table is a delivery log — copying an order payload into
  // it would create an unencrypted second home for every address the app has
  // ever seen, in the one table that exists to be kept and queried.
  const claim = await claimWebhookEvent({
    topic,
    webhookId,
    storeId: store.id,
    payload: { orderId: typeof payload.id === 'number' ? payload.id : null },
  });

  if (claim.duplicate) {
    logger.debug({ shopDomain, topic, webhookId }, 'Order webhook already recorded');
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await enqueueOrderSync({ storeId: store.id, shopDomain });
  } catch (err) {
    if (claim.eventId) await releaseWebhookEvent(claim.eventId);
    logger.error(
      { shopDomain, topic, webhookId, err: (err as Error).message },
      'Failed to enqueue order sync',
    );
    return NextResponse.json({ error: 'enqueue failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
