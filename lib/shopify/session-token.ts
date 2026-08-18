import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { isValidShopDomain } from './validators';

/**
 * Shopify session tokens (App Bridge `id_token`).
 *
 * A session token is a short-lived JWT that App Bridge mints for the embedded
 * app on every load. It proves *which shop and which staff member* is looking
 * at the page, and it is the input to token exchange — which is how a modern
 * embedded app gets an access token WITHOUT bouncing the merchant through an
 * authorize screen.
 *
 * Verified here by hand rather than with a JWT library: the algorithm is fixed
 * (HS256 with the app's own client secret), the claim set is tiny, and pulling
 * in a general-purpose JWT parser would add an `alg: none` / algorithm-confusion
 * surface for no benefit.
 *
 * https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens
 */

export interface SessionTokenPayload {
  /** `https://{shop}/admin` */
  iss: string;
  /** `https://{shop}` — the shop this token is for. */
  dest: string;
  /** Must be our own API key. */
  aud: string;
  /** Staff member id. */
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

export class InvalidSessionTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid session token: ${reason}`);
    this.name = 'InvalidSessionTokenError';
  }
}

function base64UrlDecode(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify a session token and return its payload.
 *
 * Clock skew: Shopify's `exp`/`nbf` are second-precision and the merchant's
 * browser, Shopify and this server rarely agree to the second. A few seconds
 * of leeway avoids rejecting a token that is valid everywhere but here — which
 * would look to the merchant like a random login loop.
 */
export function verifySessionToken(token: string, leewaySeconds = 5): SessionTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new InvalidSessionTokenError('malformed');

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  let payload: SessionTokenPayload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new InvalidSessionTokenError('undecodable');
  }

  // Pin the algorithm. Accepting whatever the header claims is how
  // algorithm-confusion attacks work.
  if (header.alg !== 'HS256') throw new InvalidSessionTokenError(`unexpected alg ${header.alg}`);

  const expected = createHmac('sha256', env.SHOPIFY_API_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = base64UrlDecode(signatureB64);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new InvalidSessionTokenError('signature mismatch');
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp + leewaySeconds < now) {
    throw new InvalidSessionTokenError('expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - leewaySeconds > now) {
    throw new InvalidSessionTokenError('not yet valid');
  }

  // `aud` is the app the token was minted for. Without this check, a token
  // issued to a DIFFERENT app on the same shop would authenticate here.
  if (payload.aud !== env.SHOPIFY_API_KEY) {
    throw new InvalidSessionTokenError('audience mismatch');
  }

  const shop = shopFromDest(payload.dest);
  if (!isValidShopDomain(shop)) throw new InvalidSessionTokenError('bad dest');

  return payload;
}

/** `https://shop.myshopify.com` → `shop.myshopify.com`. */
export function shopFromDest(dest: string): string | null {
  if (typeof dest !== 'string') return null;
  try {
    return new URL(dest).host.toLowerCase();
  } catch {
    return null;
  }
}
