import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyWebhookRequest, claimWebhookEvent, releaseWebhookEvent } from '@/lib/shopify/webhook';
import {
  parseMetaobjectWebhookPayload,
  PRODUCT_REVIEW_TYPE,
} from '@/lib/shopify/metaobject-payload';
import { enqueueMetaobjectReconcile } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `metaobjects/create|update|delete` — the review change feed.
 *
 * Subscribing to this is MANDATORY for Shopify-approved review apps, and it
 * is the only thing that tells us a review changed without going through us:
 * edited by the merchant in the admin, written by another approved review
 * app, or removed by Shopify. Without it we would keep serving our own copy
 * while believing it authoritative.
 *
 * The handler does as little as possible and returns. Shopify times out a
 * webhook at 5 seconds and retries on anything else, so all real work —
 * reading the metaobject, comparing it, repairing drift — happens on the
 * syndication queue. This endpoint's entire job is: prove the request is
 * genuine, refuse to process it twice, hand it off.
 */
export async function POST(req: NextRequest) {
  const verification = await verifyWebhookRequest(req);

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'Metaobject webhook rejected');
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  const { topic, shopDomain, webhookId, subTopic, payload } = verification.webhook;

  if (!topic.startsWith('metaobjects/')) {
    // Misrouted rather than malicious — a config change could point another
    // topic here. 200 so Shopify stops retrying something we will never want.
    logger.warn({ topic, shopDomain }, 'Non-metaobject topic delivered to metaobjects route');
    return NextResponse.json({ ok: true, ignored: 'wrong_topic' });
  }

  const envelope = parseMetaobjectWebhookPayload(payload);
  if (!envelope) {
    // Authenticated but unparseable. Retrying cannot make the body different,
    // so 200 and log loudly rather than absorbing days of redeliveries.
    logger.error(
      { topic, shopDomain, payloadKeys: Object.keys(payload) },
      'Metaobject webhook payload missing a usable metaobject id',
    );
    return NextResponse.json({ ok: true, ignored: 'unparseable_payload' });
  }

  // Defence in depth. The subscription is scoped to `product_review` in
  // shopify.app.toml, but that filter is Shopify-side config we do not
  // control at runtime — if it is ever dropped, this stops us reconciling
  // every unrelated metaobject in the shop against reviews that don't exist.
  const declaredType = envelope.type ?? subTopic?.replace(/^type:/, '') ?? null;
  if (declaredType !== null && declaredType !== PRODUCT_REVIEW_TYPE) {
    return NextResponse.json({ ok: true, ignored: 'other_metaobject_type' });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, uninstalledAt: true },
  });

  if (!store || store.uninstalledAt) {
    // Shopify can deliver in-flight webhooks after an uninstall. Nothing to
    // reconcile against, and 200 stops the retries.
    logger.info({ shopDomain, topic }, 'Metaobject webhook for unknown or uninstalled store');
    return NextResponse.json({ ok: true, ignored: 'store_not_installed' });
  }

  // Store only an envelope, never the field values: a product_review
  // metaobject carries customer-authored text and an author name, and this
  // table is a delivery log, not a second copy of the reviews.
  const claim = await claimWebhookEvent({
    topic,
    webhookId,
    storeId: store.id,
    payload: {
      metaobjectGid: envelope.gid,
      handle: envelope.handle,
      type: declaredType,
      updatedAt: envelope.updatedAt,
      hadFields: envelope.fields !== null,
    },
  });

  if (claim.duplicate) {
    logger.debug({ shopDomain, topic, webhookId }, 'Metaobject webhook already recorded');
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    await enqueueMetaobjectReconcile({
      storeId: store.id,
      webhookId,
      webhookEventId: claim.eventId!,
      topic,
      metaobjectGid: envelope.gid,
      metaobjectHandle: envelope.handle,
      metaobjectFields: envelope.fields,
    });
  } catch (err) {
    // Roll the claim back so Shopify's retry isn't discarded as a duplicate.
    // A dropped delivery here means permanently stale review data with no
    // second chance, which is worse than processing one webhook twice.
    if (claim.eventId) await releaseWebhookEvent(claim.eventId);
    logger.error(
      { shopDomain, topic, webhookId, err: (err as Error).message },
      'Failed to enqueue metaobject reconciliation',
    );
    return NextResponse.json({ error: 'enqueue failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
