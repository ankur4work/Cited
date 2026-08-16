import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { audit, AUDIT } from '@/lib/audit';
import { RETENTION, cutoff } from '@/lib/compliance/retention';

/**
 * Scheduled enforcement of the retention periods in lib/compliance/retention.
 *
 * Runs daily. Everything here is a null-out or a delete of rows that are past
 * their period, which makes the job idempotent and safe to run twice — a
 * second pass in the same day simply finds nothing.
 *
 * The sweep is cross-tenant on purpose. Retention is our obligation rather
 * than a per-store setting, and running it per store would mean a shop with no
 * traffic never gets swept.
 *
 * Note what is NOT swept: `compliance_requests` (the proof that an erasure
 * happened, which has to outlive everything it describes) and `suppressions`
 * (a hash plus "never email this person" — expiring it would mean emailing
 * someone who opted out).
 */
export async function retentionSweepProcessor(): Promise<void> {
  const now = new Date();

  const [orders, sends, webhookEvents, aeoProbes, auditLogs] = await Promise.all([
    // Order mirror: clear the identifying columns, keep the order.
    prisma.order.updateMany({
      where: {
        createdAt: { lt: cutoff(RETENTION.ORDER_PII_DAYS, now) },
        // Only rows that still hold something, so the count reports work done
        // rather than rows re-examined.
        OR: [{ customerEmailEnc: { not: null } }, { customerName: { not: null } }],
      },
      data: {
        customerEmailEnc: null,
        customerEmailHash: null,
        customerName: null,
        customerLocale: null,
      },
    }),

    prisma.requestSend.updateMany({
      where: {
        createdAt: { lt: cutoff(RETENTION.SEND_PII_DAYS, now) },
        emailEnc: { not: null },
      },
      data: { emailEnc: null, emailHash: '' },
    }),

    prisma.webhookEvent.deleteMany({
      where: { createdAt: { lt: cutoff(RETENTION.WEBHOOK_EVENT_DAYS, now) } },
    }),

    prisma.aeoProbe.updateMany({
      where: {
        ranAt: { lt: cutoff(RETENTION.AEO_RAW_RESPONSE_DAYS, now) },
        rawResponse: { not: null },
      },
      data: { rawResponse: null },
    }),

    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff(RETENTION.AUDIT_LOG_DAYS, now) } },
    }),
  ]);

  const counts = {
    ordersCleared: orders.count,
    sendsCleared: sends.count,
    webhookEventsDeleted: webhookEvents.count,
    aeoResponsesCleared: aeoProbes.count,
    auditLogsDeleted: auditLogs.count,
  };

  const personalDataTouched = counts.ordersCleared + counts.sendsCleared;

  // Only audited when it actually erased personal data. A daily no-op writing
  // a row every morning would bury the entries that matter.
  if (personalDataTouched > 0) {
    await audit({
      action: AUDIT.RETENTION_PURGE,
      actor: 'SYSTEM',
      recordCount: personalDataTouched,
      meta: counts,
    });
  }

  logger.info(counts, 'Retention sweep completed');
}
