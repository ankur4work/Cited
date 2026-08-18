import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySessionToken, shopFromDest, InvalidSessionTokenError } from './session-token';

/**
 * The session token is the app's entire authentication story now that the
 * authorize screen is gone: it decides which shop a request speaks for, and
 * therefore whose reviews a caller may moderate. Each negative case below is a
 * cross-tenant write or an outright bypass if it ever passes.
 *
 * Signed with the test env's SHOPIFY_API_SECRET ('test-secret', vitest.config).
 */

const SECRET = 'test-secret';
const API_KEY = 'test-key';

function b64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function makeToken(
  payloadOverrides: Record<string, unknown> = {},
  opts: { secret?: string; alg?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: opts.alg ?? 'HS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: 'https://shop.myshopify.com/admin',
      dest: 'https://shop.myshopify.com',
      aud: API_KEY,
      sub: '1',
      exp: now + 60,
      nbf: now - 10,
      iat: now - 10,
      jti: 'x',
      sid: 'y',
      ...payloadOverrides,
    }),
  );
  const signature = b64url(
    createHmac('sha256', opts.secret ?? SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

describe('verifySessionToken', () => {
  it('accepts a well-formed token and returns its claims', () => {
    const payload = verifySessionToken(makeToken());
    expect(payload.dest).toBe('https://shop.myshopify.com');
    expect(shopFromDest(payload.dest)).toBe('shop.myshopify.com');
  });

  it('rejects a token signed with the wrong secret', () => {
    expect(() => verifySessionToken(makeToken({}, { secret: 'not-our-secret' }))).toThrow(
      InvalidSessionTokenError,
    );
  });

  it('rejects a tampered payload — the classic privilege escalation', () => {
    // Re-point a valid token at another shop without re-signing.
    const token = makeToken();
    const [header, , signature] = token.split('.');
    const forged = b64url(
      JSON.stringify({
        iss: 'https://victim.myshopify.com/admin',
        dest: 'https://victim.myshopify.com',
        aud: API_KEY,
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    expect(() => verifySessionToken(`${header}.${forged}.${signature}`)).toThrow(
      InvalidSessionTokenError,
    );
  });

  it('rejects alg:none instead of trusting the header', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(
      JSON.stringify({ dest: 'https://shop.myshopify.com', aud: API_KEY, exp: now + 60 }),
    );
    expect(() => verifySessionToken(`${header}.${payload}.`)).toThrow(/unexpected alg/);
  });

  it('rejects an expired token', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() => verifySessionToken(makeToken({ exp: now - 120 }))).toThrow(/expired/);
  });

  it('allows small clock skew rather than bouncing a valid merchant', () => {
    const now = Math.floor(Date.now() / 1000);
    // Expired 2s ago by our clock — within leeway.
    expect(() => verifySessionToken(makeToken({ exp: now - 2 }), 5)).not.toThrow();
  });

  it('rejects a token minted for a DIFFERENT app on the same shop', () => {
    expect(() => verifySessionToken(makeToken({ aud: 'someone-elses-api-key' }))).toThrow(
      /audience mismatch/,
    );
  });

  it('rejects a non-Shopify dest', () => {
    expect(() =>
      verifySessionToken(makeToken({ dest: 'https://evil.example.com' })),
    ).toThrow(/bad dest/);
  });

  it('rejects malformed input', () => {
    expect(() => verifySessionToken('not.a.jwt')).toThrow(InvalidSessionTokenError);
    expect(() => verifySessionToken('onlyonepart')).toThrow(/malformed/);
  });
});
