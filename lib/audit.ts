import type { Prisma, AuditActor } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';
import { getRequestId } from './request-context';

/**
 * Append-only audit trail for access to personal data.
 *
 * Shopify's protected-customer-data requirements ask directly whether we log
 * access to personal data. This is that log. It exists so the answer is a
 * queryable table rather than an assurance.
 *
 * Two rules keep it useful:
 *
 *  1. **It records the access, never the data.** Subjects are referenced by
 *     internal ID. An audit trail that copies the email it is auditing has
 *     doubled the exposure it was built to control.
 *
 *  2. **It never blocks the thing it audits.** A failed write is logged and
 *     swallowed. Refusing to serve a merchant's dashboard because an audit row
 *     would not insert trades a real outage for a bookkeeping gap, and the
 *     structured log line below preserves the event either way.
 *
 * Not every read is audited — rendering a review touches no identifier. Audit
 * the moments that would matter in an incident: decrypting an address,
 * exporting in bulk, and erasing.
 */

/** Dotted verbs. A closed set so queries don't depend on spelling. */
export const AUDIT = {
  /** An encrypted email column was decrypted back to plaintext. */
  EMAIL_DECRYPT: 'customer.email.decrypt',
  /** Customer-identifying rows were read in bulk (export, report, download). */
  CUSTOMER_EXPORT: 'customer.data.export',
  /** A customers/data_request was compiled for the merchant. */
  DATA_REQUEST_FULFILLED: 'customer.data_request.fulfil',
  /** Personal data was erased in response to customers/redact. */
  CUSTOMER_REDACT: 'customer.redact',
  /** A whole store's data was erased in response to shop/redact. */
  SHOP_REDACT: 'shop.redact',
  /** Rows dropped by the scheduled retention sweep. */
  RETENTION_PURGE: 'retention.purge',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export interface AuditInput {
  action: AuditAction;
  storeId?: string | null;
  actor?: AuditActor;
  actorId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  /** Rows covered, so one entry can stand for a 10,000-row export. */
  recordCount?: number;
  /** Counts and identifiers only. Never field values. */
  meta?: Prisma.InputJsonValue;
  /**
   * Set false only for an action that provably touched no customer-identifying
   * data. Defaults true because the failure mode of guessing wrong in the
   * other direction is an under-reported trail.
   */
  personalData?: boolean;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        storeId: input.storeId ?? null,
        actor: input.actor ?? 'SYSTEM',
        actorId: input.actorId ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        recordCount: input.recordCount ?? 1,
        personalData: input.personalData ?? true,
        requestId: getRequestId() ?? null,
        meta: input.meta ?? {},
      },
    });
  } catch (err) {
    // Deliberately swallowed — see rule 2 above. Logged at error so the gap is
    // visible in the same place the alerting already looks.
    logger.error(
      {
        auditWriteFailed: true,
        action: input.action,
        storeId: input.storeId,
        err: (err as Error).message,
      },
      'Failed to write audit log entry',
    );
  }
}
