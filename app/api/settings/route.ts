import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { requireSessionStore, UnauthorizedError } from '@/lib/shopify/require-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Merchant-toggleable settings.
 *
 * Only the two booleans are writable. The plan, scopes and token state shown
 * on the same screen are facts about the install, not preferences — accepting
 * them here would let the UI claim entitlements the merchant has not paid for.
 */
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
    analyticsPixelEnabled?: unknown;
    gdprMode?: unknown;
  };

  const data: { analyticsPixelEnabled?: boolean; gdprMode?: boolean } = {};
  if (typeof body.analyticsPixelEnabled === 'boolean') {
    data.analyticsPixelEnabled = body.analyticsPixelEnabled;
  }
  if (typeof body.gdprMode === 'boolean') {
    data.gdprMode = body.gdprMode;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const updated = await prisma.store.update({
    where: { id: store.id },
    data,
    select: { analyticsPixelEnabled: true, gdprMode: true },
  });

  logger.info({ storeId: store.id, ...data }, 'Settings updated');

  return NextResponse.json({ ok: true, ...updated });
}
