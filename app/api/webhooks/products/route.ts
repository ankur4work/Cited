import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyWebhookRequest, claimWebhookEvent, releaseWebhookEvent } from '@/lib/shopify/webhook';
import { enqueueProductSync } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `products/create|update|delete` — keeps the local catalog mirror in step.
 *
 * The mirror is not a convenience. Review syndication writes a metaobject with
 * a **reference** to a product, and the standard definition rejects a dangling
 * reference outright, so a review for a product we have not mirrored fails to
 * syndicate rather than degrading. The rating metafields are written per
 * product for the same reason.
 *
 * Deletes are handled by the same debounced pull rather than a targeted row
 * delete: the reconciliation in the ingestion processor already resolves what
 * the shop does and does not have, and one code path that converges is easier
 * to trust than two that must agree.
 */
export async function POST(req: NextRequest) {
  const verification = await verifyWebhookRequest(req);

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'Product webhook rejected');
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  const { topic, shopDomain, webhookId, payload } = verification.webhook;

  if (!topic.startsWith('products/')) {
    logger.warn({ topic, shopDomain }, 'Non-product topic delivered to products route');
    return NextResponse.json({ ok: true, ignored: 'wrong_topic' });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, uninstalledAt: true },
  });

  if (!store || store.uninstalledAt) {
    logger.info({ shopDomain, topic }, 'Product webhook for unknown or uninstalled store');
    return NextResponse.json({ ok: true, ignored: 'store_not_installed' });
  }

  const claim = await claimWebhookEvent({
    topic,
    webhookId,
    storeId: store.id,
    payload: { productId: typeof payload.id === 'number' ? payload.id : null },
  });

  if (claim.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await enqueueProductSync({ storeId: store.id, shopDomain });
  } catch (err) {
    if (claim.eventId) await releaseWebhookEvent(claim.eventId);
    logger.error(
      { shopDomain, topic, webhookId, err: (err as Error).message },
      'Failed to enqueue product sync',
    );
    return NextResponse.json({ error: 'enqueue failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
