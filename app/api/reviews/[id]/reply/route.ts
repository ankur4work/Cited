import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireSessionStore, UnauthorizedError } from '@/lib/shopify/require-session';
import { loadEntitlement, isPaid } from '@/lib/entitlements';
import { enqueueReviewSyndication } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Merchant replies.
 *
 * `merchantReply` has been on the Review model and rendered by the theme block
 * since the beginning, and nothing could ever write to it — the column, the
 * projection and the storefront markup all existed around a hole where the
 * write path should have been. This is that path.
 *
 * A reply is public the moment it saves. There is no draft state and no
 * moderation queue, because the author is the merchant: they are the party a
 * moderation queue would exist to protect the store from.
 *
 * Replies syndicate like any other review change. A reply that stays in our
 * database is invisible to the Shop app and to every surface reading the
 * metaobject, which is most of the reason to write one.
 */

const MAX_REPLY = 2_000;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let store;
  try {
    store = await requireSessionStore(req);
  } catch (err) {
    if (err instanceof UnauthorizedError || (err as Error).name === 'InvalidSessionTokenError') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  // Replies are a paid feature. Checked on the server, not just hidden in the
  // UI — a hidden button is a suggestion, and this endpoint is reachable
  // directly by anyone holding a valid session token for the shop.
  //
  // 402 rather than 403: the merchant is permitted, they have simply not paid
  // for this. That distinction is what lets the client offer an upgrade link
  // instead of an error.
  const entitlement = await loadEntitlement(store.id);
  if (!entitlement || !isPaid(entitlement)) {
    return NextResponse.json(
      { error: 'plan_required', message: 'Replying to reviews is available on Pro.' },
      { status: 402 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { reply?: unknown };
  const raw = typeof body.reply === 'string' ? body.reply.trim() : '';

  if (raw.length > MAX_REPLY) {
    return NextResponse.json({ error: 'reply too long' }, { status: 400 });
  }

  // Scoped by storeId as well as id: without it a valid session for shop A
  // could reply on shop B's review by guessing an id.
  const review = await prisma.review.findFirst({
    where: { id: params.id, storeId: store.id },
    select: { id: true, merchantReply: true },
  });

  if (!review) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // An empty string is a deletion, not a blank reply. Clearing both columns
  // together matters: a timestamp with no text would render as "the store
  // replied" above nothing.
  const clearing = raw.length === 0;
  if (clearing && !review.merchantReply) {
    return NextResponse.json({ ok: true, unchanged: true });
  }
  if (!clearing && review.merchantReply === raw) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  await prisma.review.update({
    where: { id: review.id },
    data: {
      merchantReply: clearing ? null : raw,
      merchantRepliedAt: clearing ? null : new Date(),
      // Without this the metaobject keeps the previous reply — or keeps a
      // reply the merchant just deleted, which is worse.
      syncStatus: 'PENDING',
    },
  });

  try {
    await enqueueReviewSyndication({ storeId: store.id, reviewId: review.id });
  } catch (err) {
    // The reply is saved. A queue blip must not undo it or report failure for
    // work that did happen — the reconcile job repairs the projection later.
    logger.error(
      { storeId: store.id, reviewId: review.id, err: (err as Error).message },
      'Reply saved but syndication could not be queued',
    );
  }

  logger.info(
    { storeId: store.id, reviewId: review.id, cleared: clearing, length: raw.length },
    clearing ? 'Merchant reply removed' : 'Merchant reply saved',
  );

  return NextResponse.json({ ok: true, reply: clearing ? null : raw });
}
