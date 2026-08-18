import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Silent (re)authentication for the embedded app.
 *
 * App Bridge can always mint a fresh session token in the browser, even when
 * the one in the page URL is stale or absent. The client posts it here, we
 * exchange it for an access token, and the merchant sees nothing at all — no
 * authorize screen, no redirect, no "install again" dead end.
 *
 * Authorization: Bearer {session token}, matching the header App Bridge uses
 * for authenticated fetches, so this endpoint works unchanged if the client
 * ever moves to `shopify.fetch`.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const idToken = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;

  if (!idToken) {
    return NextResponse.json({ error: 'missing session token' }, { status: 401 });
  }

  try {
    const result = await resolveEmbeddedSession({ idToken });

    if (result.state !== 'ready') {
      // Token verified but produced no store — treat as unauthenticated rather
      // than leaking which of the checks failed.
      return NextResponse.json({ error: 'could not establish session' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      shop: result.store.shopDomain,
      reviewScopeGranted: result.store.reviewScopeGranted,
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'Session bootstrap failed');
    return NextResponse.json({ error: 'session exchange failed' }, { status: 502 });
  }
}
