/**
 * Retention periods.
 *
 * Shopify's protected-customer-data questionnaire asks whether personal data
 * is kept longer than needed. "No" is only an honest answer if something
 * actually deletes it, so these are the periods the scheduled sweep enforces —
 * not a policy document that describes an intention.
 *
 * Each period is set by what the data is *for*, and the reasoning is recorded
 * next to the number so that shortening one later is an informed decision
 * rather than a guess about what would break.
 */

const DAY = 24 * 60 * 60 * 1000;

export const RETENTION = {
  /**
   * Order mirror personal fields (email, name, locale).
   *
   * The mirror exists to decide who to email and to prove a reviewer really
   * bought the product. Both are spent well inside two years: review requests
   * go out days after fulfilment, and a verified-buyer match on a purchase
   * older than this is not worth holding an address for. The order row itself
   * survives — only the identifying columns are cleared — so line items and
   * history stay intact for aggregates.
   */
  ORDER_PII_DAYS: 730,

  /**
   * Send records (encrypted address and lookup hash).
   *
   * Kept one year to answer "did you email me?" and to compute campaign
   * performance across a full seasonal cycle. The row and its timestamps
   * remain afterwards; only the address does not.
   */
  SEND_PII_DAYS: 365,

  /**
   * Webhook delivery log.
   *
   * Pure operational dedup. Its whole job is to recognise a Shopify
   * redelivery, which arrives within hours, so 90 days is already generous.
   */
  WEBHOOK_EVENT_DAYS: 90,

  /**
   * AEO probe raw responses.
   *
   * Full model output is kept only long enough to debug a scoring
   * disagreement. The extracted verdict — mentioned, position, sentiment —
   * is structured and is never purged.
   */
  AEO_RAW_RESPONSE_DAYS: 90,

  /**
   * Audit trail.
   *
   * Deliberately the longest period here and deliberately longer than the data
   * it describes: the record that an erasure happened is worth little if it
   * expires before anyone asks. Two years covers a Shopify audit cycle.
   */
  AUDIT_LOG_DAYS: 730,
} as const;

export function cutoff(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * DAY);
}
