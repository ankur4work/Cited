/**
 * Ask this deployment whether it is working, and email someone when it is not.
 *
 * `/api/health` answers the question uptime monitors cannot — is work being
 * CONSUMED, not merely accepted — but an endpoint nobody calls is not
 * monitoring. On 2026-09-25 the worker stopped consuming and nothing noticed
 * for three days; the endpoint would have been reporting it the whole time.
 *
 * Runs as a Coolify scheduled task inside the web container, so the check is
 * OUTSIDE the worker: a worker that is dead cannot report its own death, which
 * is precisely the failure this exists for. A dead web container is a
 * different failure, and one a merchant reports within minutes because the app
 * will not open at all.
 *
 *   ./node_modules/.bin/tsx scripts/health-alert.ts
 *
 * Exits non-zero when degraded, so the run is also recorded as failed in
 * Coolify whether or not the email gets out.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import { sendEmail } from '../lib/email/send';

/** Localhost: the container asking itself, with no DNS or proxy in the way. */
const HEALTH_URL = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/health`;

/**
 * At most one email an hour.
 *
 * A real outage lasts longer than the check interval, and an alert every ten
 * minutes for six hours trains everybody to filter the alert. The marker lives
 * in the container's filesystem on purpose — no database, no Redis, since both
 * are things this alert may be reporting the loss of.
 */
const QUIET_PERIOD_MS = 60 * 60 * 1000;
const MARKER = '/tmp/cited-health-alert';

function recentlyAlerted(): boolean {
  try {
    if (!existsSync(MARKER)) return false;
    const last = Number(readFileSync(MARKER, 'utf8'));
    return Number.isFinite(last) && Date.now() - last < QUIET_PERIOD_MS;
  } catch {
    // A marker we cannot read is not a reason to stay silent.
    return false;
  }
}

async function main() {
  const recipients = env.ADMIN_EMAILS.split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  let ok = false;
  let detail = '';

  try {
    const res = await fetch(HEALTH_URL, {
      headers: env.ADMIN_BEARER ? { authorization: `Bearer ${env.ADMIN_BEARER}` } : {},
    });
    detail = (await res.text()).slice(0, 1000);
    ok = res.ok;
  } catch (err) {
    // The web tier not answering ITSELF is as degraded as it gets.
    detail = `health endpoint unreachable: ${(err as Error).message}`;
  }

  if (ok) {
    logger.info('Health check passed');
    return;
  }

  logger.error({ detail }, 'Health check FAILED');

  if (recipients.length === 0) {
    logger.warn('No ADMIN_EMAILS configured — degraded and nobody to tell');
  } else if (recentlyAlerted()) {
    logger.info('Degraded, but an alert went out within the hour — staying quiet');
  } else {
    const text =
      `Cited is degraded.\n\n${detail}\n\n` +
      `Checked: ${HEALTH_URL}\n` +
      `Queues, Postgres and the Redis connection the queues use are covered by this check. ` +
      `A backlog with no syndication in 30 minutes means the worker has stopped consuming.`;

    for (const to of recipients) {
      await sendEmail({
        to,
        subject: 'Cited: health check failed',
        text,
        html: `<pre style="font:13px ui-monospace,monospace;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>`,
        tags: { kind: 'health-alert' },
      }).catch((err: unknown) =>
        logger.error({ to, err: (err as Error).message }, 'Could not send health alert'),
      );
    }

    try {
      writeFileSync(MARKER, String(Date.now()));
    } catch {
      // Losing the marker means the next run may alert again. Acceptable: the
      // alternative is failing the whole check over a temp file.
    }
  }

  process.exitCode = 1;
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Health alert script crashed');
  process.exitCode = 1;
});
