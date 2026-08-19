import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

vi.mock('../env', () => ({
  env: { SHOPIFY_API_SECRET: 'test-secret' },
}));

const { verifyAppProxyRequest } = await import('./app-proxy');

const SECRET = 'test-secret';
const NOW_MS = 1_760_000_000_000;
const TIMESTAMP = Math.floor(NOW_MS / 1000);

/**
 * Builds a URL signed the way Shopify signs proxied requests: parameters
 * sorted by key, `key=value` pairs concatenated with NO separator.
 */
function signedUrl(params: Record<string, string | string[]>, secret = SECRET): URL {
  const url = new URL('https://cited.solnix.store/api/proxy/reviews');
  const keys = Object.keys(params).sort();
  const message = keys
    .map((key) => {
      const value = params[key]!;
      return `${key}=${Array.isArray(value) ? value.join(',') : value}`;
    })
    .join('');

  for (const key of keys) {
    const value = params[key]!;
    for (const single of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, single);
    }
  }
  url.searchParams.set('signature', createHmac('sha256', secret).update(message).digest('hex'));
  return url;
}

const BASE = {
  shop: 'app-test-bnt22tq8.myshopify.com',
  path_prefix: '/apps/cited',
  timestamp: String(TIMESTAMP),
};

describe('verifyAppProxyRequest', () => {
  it('accepts a correctly signed request', () => {
    const result = verifyAppProxyRequest(signedUrl(BASE), NOW_MS);
    expect(result).toEqual({
      shop: BASE.shop,
      loggedInCustomerId: null,
      timestamp: TIMESTAMP,
    });
  });

  it('returns the logged-in customer id when Shopify sends one', () => {
    const url = signedUrl({ ...BASE, logged_in_customer_id: '7654321' });
    expect(verifyAppProxyRequest(url, NOW_MS)?.loggedInCustomerId).toBe('7654321');
  });

  it('treats an empty logged_in_customer_id as logged out', () => {
    // Shopify sends the parameter with an empty value rather than omitting it.
    const url = signedUrl({ ...BASE, logged_in_customer_id: '' });
    expect(verifyAppProxyRequest(url, NOW_MS)?.loggedInCustomerId).toBeNull();
  });

  it('joins repeated parameters with a comma, as Shopify does', () => {
    const url = signedUrl({ ...BASE, ids: ['1', '2', '3'] });
    expect(verifyAppProxyRequest(url, NOW_MS)).not.toBeNull();
  });

  it('rejects a signature made with the wrong secret', () => {
    const url = signedUrl(BASE, 'not-the-secret');
    expect(verifyAppProxyRequest(url, NOW_MS)).toBeNull();
  });

  it('rejects a request with no signature at all', () => {
    const url = signedUrl(BASE);
    url.searchParams.delete('signature');
    expect(verifyAppProxyRequest(url, NOW_MS)).toBeNull();
  });

  it('rejects a tampered parameter', () => {
    // The classic attack: keep a real signature, swap the shop it applies to.
    const url = signedUrl(BASE);
    url.searchParams.set('shop', 'victim.myshopify.com');
    expect(verifyAppProxyRequest(url, NOW_MS)).toBeNull();
  });

  it('rejects the OAuth signing scheme, which joins pairs with &', () => {
    // Guards against someone "simplifying" this to reuse verifyOAuthHmac.
    const url = new URL('https://cited.solnix.store/api/proxy/reviews');
    const message = Object.keys(BASE)
      .sort()
      .map((key) => `${key}=${BASE[key as keyof typeof BASE]}`)
      .join('&');
    for (const [key, value] of Object.entries(BASE)) url.searchParams.set(key, value);
    url.searchParams.set('signature', createHmac('sha256', SECRET).update(message).digest('hex'));

    expect(verifyAppProxyRequest(url, NOW_MS)).toBeNull();
  });

  it('rejects a signed request replayed a day later', () => {
    const url = signedUrl(BASE);
    expect(verifyAppProxyRequest(url, NOW_MS + 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('rejects a shop that is not a myshopify domain', () => {
    const url = signedUrl({ ...BASE, shop: 'cited.solnix.store' });
    expect(verifyAppProxyRequest(url, NOW_MS)).toBeNull();
  });
});
