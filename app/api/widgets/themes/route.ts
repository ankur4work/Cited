import { NextRequest, NextResponse } from 'next/server';
import { requireSessionStore, UnauthorizedError } from '@/lib/shopify/require-session';
import { ShopifyClient } from '@/lib/shopify/client';
import { listThemes } from '@/lib/shopify/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Themes and their templates, for the Add widget dialog.
 *
 * Fetched when the dialog opens rather than rendered with the Widgets page.
 * The page shows seven widgets and a merchant opens at most one of them, so
 * loading this up front would put a themes query — the most expensive call on
 * the page — in front of everybody to serve the few who click.
 *
 * `listThemes` answers [] rather than throwing when themes cannot be read, so
 * a missing `read_themes` grant degrades to the dialog's fallback link instead
 * of a dead dialog.
 */
export async function GET(req: NextRequest) {
  let store;
  try {
    store = await requireSessionStore(req);
  } catch (err) {
    if (err instanceof UnauthorizedError || (err as Error).name === 'InvalidSessionTokenError') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    throw err;
  }

  return NextResponse.json({ themes: await listThemes(new ShopifyClient(store)) });
}
