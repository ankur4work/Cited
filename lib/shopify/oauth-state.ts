import { randomBytes } from 'node:crypto';
import { redis } from '../redis';

// Redis-backed OAuth state store — single-use, 5-minute TTL.
// Previously we carried state in a cookie; that's OK for CSRF but a cookie
// bound to one browser can't be cross-checked by the server against a list
// of *live* in-flight states. With Redis we:
//   1. Generate a fresh nonce in /api/auth.
//   2. Store { shop } at key `oauth:state:{nonce}` with EX 300.
//   3. In /api/auth/callback, GETDEL the key (atomic) — if missing, reject.
//
// GETDEL makes the state strictly single-use. A replayed callback with the
// same ?state= hits an empty key and is rejected.

const KEY_PREFIX = 'oauth:state:';
const TTL_SECONDS = 300;

export interface OAuthStatePayload {
  shop: string;
}

export async function mintOAuthState(payload: OAuthStatePayload): Promise<string> {
  const nonce = randomBytes(24).toString('hex');
  await redis.set(`${KEY_PREFIX}${nonce}`, JSON.stringify(payload), 'EX', TTL_SECONDS);
  return nonce;
}

/** Atomically consumes + validates a state token. Returns payload or null. */
export async function consumeOAuthState(nonce: string): Promise<OAuthStatePayload | null> {
  if (!nonce || typeof nonce !== 'string') return null;
  // GETDEL requires Redis 6.2+. IORedis exposes it as a generic command.
  const raw = (await redis.call('GETDEL', `${KEY_PREFIX}${nonce}`)) as string | null;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthStatePayload;
  } catch {
    return null;
  }
}
