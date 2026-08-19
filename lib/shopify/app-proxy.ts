import { createHmac } from 'node:crypto';
import { env } from '../env';
import { safeEqualHex } from './hmac';

/**
 * App proxy request verification.
 *
 * The storefront review form posts to `/apps/cited/reviews` on the merchant's
 * own domain. Shopify forwards that to us and signs the query string, which is
 * the only thing that makes the endpoint safe to expose: without checking the
 * signature this route would be an open, unauthenticated writer into any
 * merchant's review corpus, addressable by anyone who knows the URL.
 *
 * The signing scheme is NOT the OAuth one in `hmac.ts`. Shopify sorts the
 * remaining query parameters by key and concatenates `key=value` pairs with
 * NO separator between them — the OAuth scheme joins with `&`. Repeated
 * parameters are joined with a comma before signing.
 *
 * Docs: Online store > App proxies > "Calculate a digital signature".
 */

export interface AppProxyContext {
  /** `example.myshopify.com` — the merchant this request came from. */
  shop: string;
  /**
   * Set by Shopify only when the visitor is signed in to a customer account.
   * This is the one identity claim on the request we did not get from a form
   * field, so it is the only one worth trusting.
   */
  loggedInCustomerId: string | null;
  /** Unix seconds, as signed. */
  timestamp: number;
}

/**
 * Shopify signs at proxy time, so a legitimate request is always seconds old.
 * An hour is generous enough to absorb clock skew between their edge and ours
 * while still putting a ceiling on how long a captured signed URL stays useful.
 */
const MAX_SKEW_SECONDS = 60 * 60;

export function verifyAppProxyRequest(url: URL, nowMs: number = Date.now()): AppProxyContext | null {
  const params = url.searchParams;

  const signature = params.get('signature');
  if (!signature) return null;

  const keys = [...new Set(Array.from(params.keys()))].filter((k) => k !== 'signature').sort();
  const message = keys.map((key) => `${key}=${params.getAll(key).join(',')}`).join('');

  const computed = createHmac('sha256', env.SHOPIFY_API_SECRET).update(message).digest('hex');
  if (!safeEqualHex(computed, signature)) return null;

  const shop = params.get('shop');
  if (!shop || !shop.endsWith('.myshopify.com')) return null;

  const timestamp = Number(params.get('timestamp'));
  if (!Number.isFinite(timestamp)) return null;
  if (Math.abs(nowMs / 1000 - timestamp) > MAX_SKEW_SECONDS) return null;

  // Shopify sends the parameter with an empty value for logged-out visitors
  // rather than omitting it, so `|| null` matters here.
  const customerId = params.get('logged_in_customer_id');

  return { shop, loggedInCustomerId: customerId || null, timestamp };
}
