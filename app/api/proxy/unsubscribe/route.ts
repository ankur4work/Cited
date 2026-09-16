import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyAppProxyRequest } from '@/lib/shopify/app-proxy';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One-click unsubscribe from review requests.
 *
 * Served through the app proxy so the link in the email points at the
 * merchant's own domain. A link to our host, in an email branded as the store,
 * reads as phishing — and is the kind of thing a recipient reports rather than
 * clicks.
 *
 * GET, and it opts out immediately. No confirmation step, no login, no "are you
 * sure": every extra click between a tired recipient and the outcome they want
 * converts an unsubscribe into a spam complaint, and a complaint is charged
 * against the sending reputation shared by every merchant on the account.
 *
 * Idempotent. Clicking twice, or a mail client prefetching the link, must not
 * produce an error page.
 */
export async function GET(req: NextRequest) {
  // Signed by Shopify. Without this anyone could POST opt-outs for addresses
  // they do not own — the token proves which address, this proves the request
  // came through the merchant's storefront at all.
  const verified = verifyAppProxyRequest(new URL(req.url));
  if (!verified) {
    // Deliberately terse: an unsigned caller learns nothing about why.
    return new NextResponse('Invalid request', { status: 401 });
  }

  const token = req.nextUrl.searchParams.get('t') ?? '';
  const claim = verifyUnsubscribeToken(token);

  if (!claim) {
    logger.info({ shop: verified.shop }, 'Unsubscribe token failed verification');
    return page('This link is no longer valid', 'Please contact the store to opt out.', 400);
  }

  const store = await prisma.store.findFirst({
    where: { id: claim.storeId, shopDomain: verified.shop },
    select: { id: true },
  });

  // The token is bound to a store, and the proxy signature is bound to a shop.
  // A mismatch means a token from one store was replayed against another.
  if (!store) {
    logger.warn({ shop: verified.shop, storeId: claim.storeId }, 'Unsubscribe token store mismatch');
    return page('This link is no longer valid', 'Please contact the store to opt out.', 400);
  }

  await prisma.suppression.upsert({
    where: { storeId_emailHash: { storeId: store.id, emailHash: claim.emailHash } },
    create: { storeId: store.id, emailHash: claim.emailHash, reason: 'unsubscribed' },
    update: {},
  });

  // Cancel anything already queued for this address, including the reminder
  // that is the most likely reason they clicked in the first place.
  await prisma.requestSend.updateMany({
    where: { storeId: store.id, emailHash: claim.emailHash, status: 'SCHEDULED' },
    data: { status: 'SUPPRESSED' },
  });

  logger.info({ storeId: store.id }, 'Customer unsubscribed from review requests');

  return page(
    'You’re unsubscribed',
    'You won’t receive any more review requests from this store.',
    200,
  );
}

/** Rendered by Shopify inside the merchant's own theme. */
function page(heading: string, message: string, status: number) {
  return new NextResponse(
    `<div class="cited-reviews cited-reviews--notice">
  <h2 class="cited-reviews__heading">${escapeHtml(heading)}</h2>
  <p>${escapeHtml(message)}</p>
</div>`,
    { status, headers: { 'Content-Type': 'application/liquid; charset=utf-8' } },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
