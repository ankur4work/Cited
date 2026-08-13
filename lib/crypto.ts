import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from './env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY = Buffer.from(env.SESSION_SECRET, 'hex');
const VERSION = 'v1';

if (KEY.length !== 32) {
  throw new Error('SESSION_SECRET must decode to 32 bytes');
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Malformed ciphertext');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Deterministic, keyed hash of an email address.
 *
 * HMAC rather than a bare SHA-256: the space of real email addresses is
 * small enough to brute-force, so an unkeyed digest of a customer list is
 * barely better than storing the addresses. Keying it with SESSION_SECRET
 * means a leaked database alone does not reverse the hashes.
 *
 * Deterministic on purpose — suppression lookups, duplicate-review checks
 * and order matching all need to find an address without decrypting a
 * column. Normalised first so casing and stray whitespace can't produce two
 * different hashes for the same person.
 *
 * Rotating SESSION_SECRET invalidates every stored hash, exactly as it
 * invalidates every stored access token.
 */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHmac('sha256', KEY).update(normalized).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
