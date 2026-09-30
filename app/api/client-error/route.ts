import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a crash in the admin UI goes to be seen.
 *
 * The Plans page threw for every merchant on every visit, and there was no
 * record of it anywhere: a hydration failure never reaches the server, and
 * `SENTRY_DSN` is empty, so the only evidence was a merchant's screenshot of
 * Next's "see the browser console" fallback. It was diagnosed by elimination.
 *
 * This is the smallest thing that turns the next one into a log line. Not a
 * replacement for error reporting — when a DSN is configured, that supersedes
 * this — but a pino line with the message and the digest is enough to find a
 * fault that currently costs an afternoon.
 *
 * Deliberately unauthenticated: a broken page may be broken precisely because
 * its session never established, and a report that needs the thing that failed
 * is a report we never get. That makes this writable by anyone, so it writes
 * nothing but a bounded log line — no database, no queue, nothing to fill.
 */

/** Long enough to identify a fault, short enough that nobody can flood a log. */
const MAX_FIELD = 500;

function clip(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return value.slice(0, MAX_FIELD);
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  logger.error(
    {
      // `digest` is Next's own id for the same failure on the server side,
      // which is what makes a merchant's report and a log entry joinable.
      digest: clip(body.digest),
      message: clip(body.message),
      path: clip(body.path),
      shop: clip(body.shop),
      userAgent: clip(req.headers.get('user-agent')),
    },
    'Admin UI crashed in the browser',
  );

  // 204 rather than a body: the page is already showing the error to the
  // person, and nothing about our logging is their problem.
  return new NextResponse(null, { status: 204 });
}
