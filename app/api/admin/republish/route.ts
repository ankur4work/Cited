import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { enqueueAggregateSync, enqueueStorefrontDigest } from '@/jobs/enqueue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operator-triggered republish.
 *
 * `scripts/resyndicate.ts` is the intended way to do this, and it needs a route
 * to Postgres and Redis. Those are published on the host as 5460 and 6390, and
 * when they are firewalled off — as they were on 2026-09-21, while Coolify
 * still reported `is_public=true` — there is no way left to republish anything
 * at all: no shell, no script, and every other write path in this app is behind
 * a Shopify session token that an operator cannot mint.
 *
 * That gap matters most for `shop.metafields.app.digest`. It is enqueued from
 * exactly one place, the end of the aggregate processor, so a store whose
 * reviews are all already projected never writes it — and every page-level
 * widget reads it. Ship a digest change, and the widgets stay empty until a
 * review happens to change.
 *
 * Deliberately not a cron: this repairs after a deploy changes what we write,
 * which is an event a person causes and should trigger.
 */

/**
 * An unset secret closes the route rather than opening it.
 *
 * `ADMIN_BEARER` defaults to `''` in the schema, so a comparison against the
 * raw value would let an empty `Bearer ` through on any deployment that never
 * configured one.
 */
function authorised(req: NextRequest): boolean {
  const secret = env.ADMIN_BEARER;
  if (!secret) return false;

  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : '';

  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, and the length of a bearer
  // token is not the secret worth protecting.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) {
    logger.warn({ path: '/api/admin/republish' }, 'Unauthorised republish attempt');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    shop?: unknown;
    scope?: unknown;
  };

  const shopDomain = typeof body.shop === 'string' ? body.shop.trim() : '';
  if (!shopDomain) {
    return NextResponse.json({ error: 'shop required' }, { status: 400 });
  }

  // `digest` rewrites one shop metafield; `all` re-runs every product's
  // aggregate, which rewrites the per-product lists AND triggers the digest.
  const scope = body.scope === 'all' ? 'all' : 'digest';

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, uninstalledAt: true, reviewScopeGranted: true },
  });

  if (!store || store.uninstalledAt) {
    return NextResponse.json({ error: 'store not installed' }, { status: 404 });
  }

  // Without the scope every syndication job returns early: the run would report
  // success and write nothing, which is the failure mode this route exists to
  // stop happening silently.
  if (!store.reviewScopeGranted) {
    return NextResponse.json(
      { error: 'write_product_reviews not granted — syndication would no-op' },
      { status: 409 },
    );
  }

  if (scope === 'digest') {
    // No delay. The 120s debounce on the helper is there to coalesce an import
    // storm; a hand-triggered repair should not wait on it.
    await enqueueStorefrontDigest({ storeId: store.id, delayMs: 0 });
    logger.info({ shopDomain, scope }, 'Republish requested');
    return NextResponse.json({ ok: true, scope, queued: { digest: 1 } });
  }

  const products = await prisma.product.findMany({
    where: {
      storeId: store.id,
      reviews: { some: { status: 'PUBLISHED', metaobjectGid: { not: null } } },
    },
    select: { id: true },
  });

  for (const p of products) {
    await enqueueAggregateSync({ storeId: store.id, productId: p.id, debounceMs: 0 });
  }

  // Explicitly, not only as a side effect of the aggregates: a store with
  // published reviews but no syndicated product still wants its digest.
  await enqueueStorefrontDigest({ storeId: store.id, delayMs: 0 });

  logger.info({ shopDomain, scope, products: products.length }, 'Republish requested');
  return NextResponse.json({
    ok: true,
    scope,
    queued: { aggregates: products.length, digest: 1 },
  });
}
