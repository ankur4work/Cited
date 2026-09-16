import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireSessionStore, UnauthorizedError } from '@/lib/shopify/require-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Review request campaign settings.
 *
 * Free on every plan. A reviews app whose free tier cannot ask for reviews
 * cannot demonstrate itself, and the incumbent gives requests away — gating
 * collection would lose the comparison before any paid feature was reached.
 *
 * `confirmedAt` is the send-safety gate: above SEND_SAFETY_GATE_THRESHOLD
 * pending orders the scheduler refuses to send until a merchant has explicitly
 * said yes once. Enabling the campaign is NOT that confirmation — a merchant
 * flipping a switch has not necessarily understood they are about to email
 * three thousand people, which is precisely the failure this guards against.
 */

const MAX_SUBJECT = 200;

export async function POST(req: NextRequest) {
  let store;
  try {
    store = await requireSessionStore(req);
  } catch (err) {
    if (err instanceof UnauthorizedError || (err as Error).name === 'InvalidSessionTokenError') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: unknown;
    delayHours?: unknown;
    subject?: unknown;
    reminderCount?: unknown;
    confirmLargeBatch?: unknown;
  };

  const campaign = await prisma.requestCampaign.findFirst({
    where: { storeId: store.id },
    select: { id: true, enabled: true },
  });
  if (!campaign) return NextResponse.json({ error: 'no campaign' }, { status: 404 });

  const data: Record<string, unknown> = {};

  if (typeof body.enabled === 'boolean') data.enabled = body.enabled;

  if (typeof body.delayHours === 'number') {
    // Floor of 1 hour, ceiling of 30 days. Below an hour the parcel has not
    // arrived and the request is noise; beyond a month the purchase is no
    // longer fresh enough for a useful review.
    if (!Number.isInteger(body.delayHours) || body.delayHours < 1 || body.delayHours > 720) {
      return NextResponse.json({ error: 'delayHours must be 1–720' }, { status: 400 });
    }
    data.delayHours = body.delayHours;
  }

  if (typeof body.subject === 'string') {
    const subject = body.subject.trim().slice(0, MAX_SUBJECT);
    if (subject.length === 0) {
      return NextResponse.json({ error: 'subject cannot be empty' }, { status: 400 });
    }
    data.subject = subject;
  }

  if (typeof body.reminderCount === 'number') {
    // One reminder or none. A second chaser is where a review request becomes
    // a nuisance, and the complaint lands on shared sending reputation.
    if (![0, 1].includes(body.reminderCount)) {
      return NextResponse.json({ error: 'reminderCount must be 0 or 1' }, { status: 400 });
    }
    data.reminderCount = body.reminderCount;
  }

  // A separate, explicit acknowledgement — never implied by enabling.
  if (body.confirmLargeBatch === true) {
    data.confirmedAt = new Date();
    data.confirmedBy = store.shopDomain;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  await prisma.requestCampaign.update({ where: { id: campaign.id }, data });

  logger.info(
    { storeId: store.id, campaignId: campaign.id, changed: Object.keys(data) },
    'Review request campaign updated',
  );

  return NextResponse.json({ ok: true });
}
