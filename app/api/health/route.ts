import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { connection, syndicationQueue, ingestionQueue } from '@/jobs/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Is this deployment actually working?
 *
 * Written after a day in which every fault was found by a merchant rather than
 * by us: the worker consumed nothing for three days, no review photo ever
 * reached a storefront, the Plans page threw for every merchant, and a store
 * dead-lettered jobs every fifteen minutes. Each was invisible because
 * "responding to HTTP" was the only thing anyone could check, and the web tier
 * was responding perfectly throughout.
 *
 * So this answers the question uptime monitors cannot: is work being CONSUMED,
 * not merely accepted.
 *
 * Unauthenticated callers get a bare ok/degraded — enough for a monitor to
 * alert on, and nothing an attacker can mine. With the admin bearer it returns
 * the numbers behind the verdict.
 */

/**
 * A backlog this size means nothing is draining it.
 *
 * Syndication is normally empty within seconds; a burst after a republish can
 * legitimately reach a few hundred. Five hundred waiting is not a busy app, it
 * is a stopped consumer.
 */
const WAITING_LIMIT = 500;

/**
 * How stale the newest syndicated review may be before that counts as a stall.
 *
 * Only applied when there is something waiting: a quiet store with an empty
 * queue and no syndication for a week is idle, not broken.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

export async function GET(req: NextRequest) {
  const authorized =
    env.ADMIN_BEARER.length > 0 &&
    req.headers.get('authorization') === `Bearer ${env.ADMIN_BEARER}`;

  const checks: Record<string, unknown> = {};
  const failures: string[] = [];

  // ── Postgres ───────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch (err) {
    checks.database = (err as Error).message;
    failures.push('database');
  }

  // ── Redis, and whether anything is draining it ─────────────
  try {
    // `ping` on the shared client rather than a fresh one: the point is to
    // test the connection the queues actually use. A poisoned client answers
    // here exactly as it does for an enqueue.
    await connection.ping();
    checks.redis = 'ok';

    const [syndication, ingestion] = await Promise.all([
      syndicationQueue.getJobCounts('waiting', 'active', 'failed', 'delayed'),
      ingestionQueue.getJobCounts('waiting', 'active', 'failed', 'delayed'),
    ]);
    checks.queues = { syndication, ingestion };

    const waiting = (syndication.waiting ?? 0) + (ingestion.waiting ?? 0);
    if (waiting > WAITING_LIMIT) failures.push(`queue-backlog:${waiting}`);

    /*
     * A backlog alone is ambiguous — a big republish looks like one for a
     * minute. A backlog AND no review syndicated in half an hour is the
     * signature of a consumer that is not there, which is exactly the state
     * that went unnoticed for three days.
     */
    if (waiting > 0) {
      const newest = await prisma.review.findFirst({
        where: { syncedAt: { not: null } },
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      });

      const age = newest?.syncedAt ? Date.now() - newest.syncedAt.getTime() : null;
      checks.lastSyndicationAgeMs = age;

      if (age !== null && age > STALE_AFTER_MS) failures.push('syndication-stalled');
    }
  } catch (err) {
    checks.redis = (err as Error).message;
    failures.push('redis');
  }

  const ok = failures.length === 0;

  if (!ok) {
    // Logged as well as returned: a monitor that is itself misconfigured
    // should not be the only record that this happened.
    logger.error({ failures, checks }, 'Health check failed');
  }

  return NextResponse.json(
    authorized ? { ok, failures, checks } : { ok },
    {
      status: ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
