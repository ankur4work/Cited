import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  exchangeAuthorizationCode,
  refreshOfflineAccessToken,
  exchangeOfflineAccessToken,
  NonExpiringTokenError,
} from './token-exchange';

/**
 * These tests exist because of a live incident, not for coverage.
 *
 * On 2026-08-18 an install completed perfectly — store row written, all five
 * scopes recorded, merchant redirected into the app — and then every Admin API
 * call returned 403 "Non-expiring access tokens are no longer accepted". The
 * grant had omitted `expiring=1`, so Shopify issued a legacy permanent token
 * that the API no longer honours, and the app reported "0 products synced" as
 * though the store were empty.
 *
 * Two assertions below would have caught it: that the request carries
 * `expiring: 1`, and that a response without `expires_in`/`refresh_token` is
 * refused rather than stored.
 */

const EXPIRING_RESPONSE = {
  access_token: 'shpat_new',
  scope: 'read_products',
  expires_in: 3600,
  refresh_token: 'shprt_new',
  refresh_token_expires_in: 7776000,
};

function mockFetch(body: unknown, ok = true) {
  const fn = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function callOf(fn: ReturnType<typeof mockFetch>): [string, RequestInit] {
  const call = fn.mock.calls[0] as unknown as [string, RequestInit] | undefined;
  if (!call) throw new Error('fetch was never called');
  return call;
}

function bodyOf(fn: ReturnType<typeof mockFetch>): Record<string, unknown> {
  return JSON.parse(callOf(fn)[1].body as string);
}

function urlOf(fn: ReturnType<typeof mockFetch>): string {
  return callOf(fn)[0];
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('exchangeAuthorizationCode', () => {
  it('requests an EXPIRING token — the flag whose absence caused the incident', async () => {
    const fn = mockFetch(EXPIRING_RESPONSE);
    await exchangeAuthorizationCode({ shop: 'x.myshopify.com', code: 'abc' });

    expect(bodyOf(fn).expiring).toBe(1);
    expect(bodyOf(fn).code).toBe('abc');
    expect(urlOf(fn)).toBe('https://x.myshopify.com/admin/oauth/access_token');
  });

  it('returns the refresh token alongside the access token', async () => {
    mockFetch(EXPIRING_RESPONSE);
    const issued = await exchangeAuthorizationCode({ shop: 'x.myshopify.com', code: 'abc' });

    expect(issued).toEqual({
      accessToken: 'shpat_new',
      scope: 'read_products',
      expiresIn: 3600,
      refreshToken: 'shprt_new',
      refreshTokenExpiresIn: 7776000,
    });
  });

  it('REFUSES a non-expiring token rather than storing a dead credential', async () => {
    mockFetch({ access_token: 'shpat_legacy', scope: 'read_products' });

    await expect(
      exchangeAuthorizationCode({ shop: 'x.myshopify.com', code: 'abc' }),
    ).rejects.toBeInstanceOf(NonExpiringTokenError);
  });

  it('refuses a response with an expiry but no refresh token — unrefreshable', async () => {
    mockFetch({ access_token: 'shpat_x', scope: 'read_products', expires_in: 3600 });

    await expect(
      exchangeAuthorizationCode({ shop: 'x.myshopify.com', code: 'abc' }),
    ).rejects.toBeInstanceOf(NonExpiringTokenError);
  });

  it('throws on a non-2xx response', async () => {
    mockFetch({ error: 'invalid_request' }, false);

    await expect(
      exchangeAuthorizationCode({ shop: 'x.myshopify.com', code: 'abc' }),
    ).rejects.toThrow(/Code exchange failed: 400/);
  });
});

describe('exchangeOfflineAccessToken', () => {
  it('sends the token-exchange grant with expiring=1', async () => {
    const fn = mockFetch(EXPIRING_RESPONSE);
    await exchangeOfflineAccessToken({ shop: 'x.myshopify.com', sessionToken: 'jwt' });

    const body = bodyOf(fn);
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.subject_token).toBe('jwt');
    expect(body.requested_token_type).toBe(
      'urn:shopify:params:oauth:token-type:offline-access-token',
    );
    expect(body.expiring).toBe(1);
  });
});

describe('refreshOfflineAccessToken', () => {
  it('sends the refresh grant and returns the ROTATED refresh token', async () => {
    const fn = mockFetch(EXPIRING_RESPONSE);
    const issued = await refreshOfflineAccessToken({
      shop: 'x.myshopify.com',
      refreshToken: 'shprt_old',
    });

    const body = bodyOf(fn);
    expect(body.grant_type).toBe('refresh_token');
    expect(body.refresh_token).toBe('shprt_old');
    // The new one must replace the old: reusing shprt_old after this would
    // eventually orphan the store.
    expect(issued.refreshToken).toBe('shprt_new');
  });
});
