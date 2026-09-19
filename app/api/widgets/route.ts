import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireSessionStore, UnauthorizedError } from '@/lib/shopify/require-session';
import { ShopifyClient } from '@/lib/shopify/client';
import { setWidgetSettings } from '@/lib/shopify/shop-metafields';
import { widgetSettingsSchema, toLiquidShape } from '@/lib/widgets/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Save widget appearance.
 *
 * Writes straight through to the shop metafield the theme blocks read, with no
 * local copy kept. The storefront path makes no request to us, so the metafield
 * has to hold these values anyway — and a second copy in our database would be
 * a thing to keep in step for no benefit, with the storefront silently
 * following whichever one the last write touched.
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

  const body = await req.json().catch(() => ({}));

  // `.catch()` per field means one bad value degrades to that field's default
  // rather than rejecting the whole save and losing everything else the
  // merchant just changed.
  const parsed = widgetSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid settings' }, { status: 400 });
  }

  try {
    await setWidgetSettings(new ShopifyClient(store), toLiquidShape(parsed.data));
  } catch (err) {
    logger.error(
      { storeId: store.id, err: (err as Error).message },
      'Could not publish widget settings',
    );
    return NextResponse.json({ error: 'could not save to Shopify' }, { status: 502 });
  }

  logger.info({ storeId: store.id }, 'Widget settings published');
  return NextResponse.json({ ok: true, settings: parsed.data });
}
