import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const update = vi.fn();
const refreshOfflineAccessToken = vi.fn();

vi.mock('../prisma', () => ({
  prisma: { store: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) } },
}));
vi.mock('./token-exchange', () => ({
  refreshOfflineAccessToken: (...a: unknown[]) => refreshOfflineAccessToken(...a),
}));

const { getAccessToken, needsReauth, ReauthRequiredError } = await import('./access-token');
const { encrypt, decrypt } = await import('../crypto');

const MINUTE = 60 * 1000;

function storeRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    shopDomain: 'x.myshopify.com',
    accessToken: encrypt('shpat_current'),
    accessTokenExpiresAt: new Date(Date.now() + 30 * MINUTE),
    refreshToken: encrypt('shprt_current'),
    refreshTokenExpiresAt: new Date(Date.now() + 80 * 24 * 60 * MINUTE),
    ...over,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset().mockResolvedValue({});
  refreshOfflineAccessToken.mockReset().mockResolvedValue({
    accessToken: 'shpat_fresh',
    scope: 'read_products',
    expiresIn: 3600,
    refreshToken: 'shprt_rotated',
    refreshTokenExpiresIn: 7776000,
  });
});

describe('getAccessToken', () => {
  it('returns the stored token while it is still fresh', async () => {
    findUnique.mockResolvedValue(storeRow());

    expect(await getAccessToken('s1')).toBe('shpat_current');
    expect(refreshOfflineAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes inside the 5-minute margin, before the token is actually dead', async () => {
    // Still valid for 2 more minutes — a long request would outlive it.
    findUnique.mockResolvedValue(storeRow({ accessTokenExpiresAt: new Date(Date.now() + 2 * MINUTE) }));

    expect(await getAccessToken('s1')).toBe('shpat_fresh');
    expect(refreshOfflineAccessToken).toHaveBeenCalledWith({
      shop: 'x.myshopify.com',
      refreshToken: 'shprt_current',
    });
  });

  it('persists BOTH rotated tokens, encrypted', async () => {
    findUnique.mockResolvedValue(storeRow({ accessTokenExpiresAt: new Date(Date.now() - MINUTE) }));

    await getAccessToken('s1');

    const data = update.mock.calls[0]![0].data;
    expect(decrypt(data.accessToken)).toBe('shpat_fresh');
    // The spent refresh token must not survive the write.
    expect(decrypt(data.refreshToken)).toBe('shprt_rotated');
    expect(data.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('force refreshes even when the stored expiry says the token is fine', async () => {
    findUnique.mockResolvedValue(storeRow());

    expect(await getAccessToken('s1', { force: true })).toBe('shpat_fresh');
  });

  /**
   * The 2026-08-18 state: a token stored before the app requested expiring
   * tokens. No expiry, no refresh token, and rejected by the Admin API. There
   * is no code path back from this — only the merchant can fix it — so it must
   * surface as ReauthRequiredError rather than a retryable failure.
   */
  it('reports legacy non-expiring rows as needing re-authorization', async () => {
    findUnique.mockResolvedValue(
      storeRow({ accessTokenExpiresAt: null, refreshToken: null, refreshTokenExpiresAt: null }),
    );

    await expect(getAccessToken('s1')).rejects.toMatchObject({
      name: 'ReauthRequiredError',
      reason: 'legacy-non-expiring',
    });
  });

  it('reports an expired refresh token as needing re-authorization', async () => {
    findUnique.mockResolvedValue(
      storeRow({
        accessTokenExpiresAt: new Date(Date.now() - MINUTE),
        refreshTokenExpiresAt: new Date(Date.now() - MINUTE),
      }),
    );

    await expect(getAccessToken('s1')).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it('reports a missing token as needing re-authorization', async () => {
    findUnique.mockResolvedValue(storeRow({ accessToken: null }));

    await expect(getAccessToken('s1')).rejects.toMatchObject({ reason: 'no-token' });
  });
});

describe('needsReauth', () => {
  const healthy = {
    accessToken: 'ct',
    accessTokenExpiresAt: new Date(Date.now() + 30 * MINUTE),
    refreshToken: 'ct',
    refreshTokenExpiresAt: new Date(Date.now() + 80 * 24 * 60 * MINUTE),
  };

  it('is false for a healthy store', () => {
    expect(needsReauth(healthy)).toBe(false);
  });

  it('is false for an expired ACCESS token — that refreshes silently', () => {
    expect(needsReauth({ ...healthy, accessTokenExpiresAt: new Date(Date.now() - MINUTE) })).toBe(
      false,
    );
  });

  it('is true for a legacy non-expiring token', () => {
    expect(needsReauth({ ...healthy, accessTokenExpiresAt: null })).toBe(true);
  });

  it('is true once the refresh token has expired', () => {
    expect(needsReauth({ ...healthy, refreshTokenExpiresAt: new Date(Date.now() - MINUTE) })).toBe(
      true,
    );
  });

  it('is true with no token at all', () => {
    expect(needsReauth({ ...healthy, accessToken: null })).toBe(true);
  });
});
