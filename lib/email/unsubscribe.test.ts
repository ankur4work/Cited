import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: { SESSION_SECRET: 'a'.repeat(64) } }));

const { unsubscribeToken, verifyUnsubscribeToken } = await import('./unsubscribe');

const STORE = 'store_abc';
const HASH = 'b'.repeat(64);

describe('unsubscribeToken', () => {
  it('round-trips the store and email hash', () => {
    const token = unsubscribeToken(STORE, HASH);
    expect(verifyUnsubscribeToken(token)).toEqual({ storeId: STORE, emailHash: HASH });
  });

  it('never contains the email address', () => {
    // The token lives in an inbox for months and may be forwarded, logged by a
    // proxy, or screenshotted. It must not disclose who it belongs to.
    const token = unsubscribeToken(STORE, HASH);
    expect(token).not.toContain('@');
    expect(token).toContain(HASH);
  });

  it('is stable for the same inputs', () => {
    // Derived, not stored — so there is no table of live opt-out tokens to
    // retain, migrate and purge alongside the addresses they point at.
    expect(unsubscribeToken(STORE, HASH)).toBe(unsubscribeToken(STORE, HASH));
  });
});

describe('verifyUnsubscribeToken', () => {
  it('rejects a tampered email hash', () => {
    // The attack this stops: editing someone else's token to opt out an
    // address you do not control.
    const token = unsubscribeToken(STORE, HASH);
    const forged = token.replace(HASH, 'c'.repeat(64));
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it('rejects a tampered store id', () => {
    const token = unsubscribeToken(STORE, HASH);
    expect(verifyUnsubscribeToken(token.replace(STORE, 'store_xyz'))).toBeNull();
  });

  it('rejects a token signed for a different pairing', () => {
    // Signature from one (store, hash) pair replayed onto another.
    const other = unsubscribeToken('store_other', HASH);
    const signature = other.split('.')[2]!;
    expect(verifyUnsubscribeToken([STORE, HASH, signature].join('.'))).toBeNull();
  });

  it('returns null rather than throwing on malformed input', () => {
    // Reached straight from a URL query parameter, so every shape of garbage
    // arrives here eventually. A throw would be a 500 on an unsubscribe link.
    for (const bad of ['', 'x', 'a.b', 'a.b.c.d', '..', `${STORE}.${HASH}.`]) {
      expect(verifyUnsubscribeToken(bad)).toBeNull();
    }
  });

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch — the length guard has to
    // come first or a truncated token is a 500 instead of a 400.
    expect(verifyUnsubscribeToken(`${STORE}.${HASH}.short`)).toBeNull();
  });
});
