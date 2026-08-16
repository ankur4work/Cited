import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyWebhookRequest, claimWebhookEvent } from '@/lib/shopify/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Shopify sends `shop/redact` 48 hours after an uninstall. */
const REDACT_DELAY_MS = 48 * 60 * 60 * 1000;

/**
 * `app/uninstalled`.
 *
 * Two jobs, and the second is the one that matters.
 *
 * First, the access token is dead the moment the app is uninstalled. Clearing
 * it stops every queued job from spending retries on calls that can only
 * return 401, and means a token we can no longer use is not sitting encrypted
 * in the database indefinitely.
 *
 * Second, this starts the erasure clock. `scheduledRedactAt` records when the
 * shop's data becomes deletable, and is cleared on reinstall — Shopify
 * explicitly supports uninstall-then-reinstall inside the window, and a
 * merchant who comes back within 48 hours must find their reviews intact
 * rather than discover we deleted them for leaving briefly.
 *
 * Nothing is deleted here. The actual erasure runs from `shop/redact`, which
 * is Shopify telling us the window has closed. Deleting early would race that
 * reinstall path for no benefit.
 */
export async function POST(req: NextRequest) {
  const verification = await verifyWebhookRequest(req);

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'Uninstall webhook rejected');
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  const { topic, shopDomain, webhookId } = verification.webhook;

  if (topic !== 'app/uninstalled') {
    logger.warn({ topic, shopDomain }, 'Non-uninstall topic delivered to uninstall route');
    return NextResponse.json({ ok: true, ignored: 'wrong_topic' });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true },
  });

  if (!store) {
    return NextResponse.json({ ok: true, ignored: 'store_not_found' });
  }

  const claim = await claimWebhookEvent({ topic, webhookId, storeId: store.id });
  if (claim.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const now = new Date();

  await prisma.store.update({
    where: { id: store.id },
    data: {
      uninstalledAt: now,
      scheduledRedactAt: new Date(now.getTime() + REDACT_DELAY_MS),
      // Revoked server-side by Shopify already; holding the ciphertext buys
      // nothing and a reinstall issues a fresh token through token exchange.
      accessToken: null,
      accessTokenExpiresAt: null,
    },
  });

  logger.info({ shopDomain, storeId: store.id }, 'App uninstalled — token cleared, redact scheduled');

  return NextResponse.json({ ok: true });
}
