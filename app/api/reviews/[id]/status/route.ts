import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireSessionStore, UnauthorizedError } from '@/lib/shopify/require-session';
import { enqueueReviewSyndication, enqueueAggregateSync } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['PUBLISHED', 'PENDING', 'HIDDEN', 'SPAM'] as const;
type AllowedStatus = (typeof ALLOWED)[number];

/**
 * Moderate a review.
 *
 * DELETED is deliberately not reachable from here: it is a soft delete that
 * feeds the compliance purge, and a merchant clicking "spam" should not put a
 * row on a retention path. Hiding is reversible; deletion is not.
 *
 * Publishing does two writes' worth of work beyond the row itself — the
 * review is queued for syndication into Shopify's metaobject, and the
 * product's rating aggregate is recomputed — because a published review that
 * never reaches Shopify is invisible to the Shop app and every AI surface,
 * which is the entire point of the product.
 */
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

  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = body.status as AllowedStatus | undefined;

  if (!status || !ALLOWED.includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  // Scoped by storeId as well as review id: without it, a valid session for
  // shop A could moderate shop B's review by guessing an id.
  const review = await prisma.review.findFirst({
    where: { id: params.id, storeId: store.id },
    select: { id: true, productId: true, status: true },
  });

  if (!review) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (review.status === status) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.review.update({
    where: { id: review.id },
    data: {
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      // Leaving the projection alone would strand a metaobject on Shopify for
      // a review the merchant just hid.
      syncStatus: 'PENDING',
    },
  });

  try {
    await enqueueReviewSyndication({ storeId: store.id, reviewId: review.id });
    await enqueueAggregateSync({ storeId: store.id, productId: review.productId });
  } catch (err) {
    // The moderation decision is already saved; a queue blip must not undo it
    // or show the merchant an error for work that did happen.
    logger.error(
      { storeId: store.id, reviewId: review.id, err: (err as Error).message },
      'Moderation saved but syndication could not be queued',
    );
  }

  logger.info(
    { storeId: store.id, reviewId: review.id, from: review.status, to: status },
    'Review moderated',
  );

  return NextResponse.json({ ok: true, status });
}
