import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * One-click unsubscribe tokens.
 *
 * Signed rather than stored: the token has to survive in an inbox for months,
 * and a table of live opt-out tokens is a table that has to be retained,
 * migrated, and purged in step with the addresses it points at. Deriving it
 * instead means there is nothing extra to erase when a customer exercises their
 * right to be forgotten — the hash is already the identifier we keep.
 *
 * Carries the email HASH, never the address. A token that leaks (forwarded
 * email, proxy log, shared screenshot) must not disclose who it belongs to, and
 * it must not let its holder unsubscribe anyone but themselves.
 *
 * Deliberately not expiring. A year-old email with a dead unsubscribe link is
 * a complaint, and a complaint costs every merchant on the sending account.
 */

const SEPARATOR = '.';

function sign(storeId: string, emailHash: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`unsubscribe:${storeId}:${emailHash}`)
    .digest('base64url');
}

export function unsubscribeToken(storeId: string, emailHash: string): string {
  return [storeId, emailHash, sign(storeId, emailHash)].join(SEPARATOR);
}

export interface UnsubscribeClaim {
  storeId: string;
  emailHash: string;
}

/** Returns null for anything that does not verify. Never throws on bad input. */
export function verifyUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) return null;

  const [storeId, emailHash, signature] = parts as [string, string, string];
  if (!storeId || !emailHash || !signature) return null;

  const expected = sign(storeId, emailHash);
  // Length check first: timingSafeEqual throws on a length mismatch, and the
  // length of a signature is not a secret.
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  return { storeId, emailHash };
}
