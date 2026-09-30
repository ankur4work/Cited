import { describe, it, expect, vi, beforeEach } from 'vitest';

const findUnique = vi.fn();
const update = vi.fn();
const refreshOfflineAccessToken = vi.fn();

vi.mock('../prisma', () => ({
  prisma: { store: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) } },
}));
/*
 * The mock has to carry the real error class, not just the function: the
 * module under test narrows with `instanceof`, and a mock that omits it turns
 * the branch into a TypeError at exactly the moment it matters.
 */
class TokenGrantRejectedError extends Error {
  constructor(
    public readonly shop: string,
    public readonly status: number,
    operation: string,
  ) {
    super(`${operation} rejected for ${shop} (HTTP ${status})`);
    this.name = 'TokenGrantRejectedError';
  }
}

vi.mock('./token-exchange', () => ({
  refreshOfflineAccessToken: (...a: unknown[]) => refreshOfflineAccessToken(...a),
  TokenGrantRejectedError,
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

/*
 * Written after ke5uzu-8s.myshopify.com spent days failing its token refresh
 * with a 403 and dead-lettering jobs every fifteen minutes: three attempts
 * with backoff, then "manual intervention required", then the same again.
 *
 * Nothing about that store was fixable by retrying. A 403 from the token
 * endpoint means the app was uninstalled or the authorization revoked — but
 * every non-2xx threw the same generic `Error: refresh failed: ${status}`, so
 * a revoked grant was indistinguishable from a 500 and was treated like one.
 *
 * The conversion below is what lets the job layer stop: `ReauthRequiredError`
 * is documented as "stop, not retry", and the worker turns it into BullMQ's
 * UnrecoverableError.
 */
describe('a grant Shopify has rejected', () => {
  it('becomes ReauthRequiredError, not a retryable failure', async () => {
    findUnique.mockResolvedValue(
      storeRow({ accessTokenExpiresAt: new Date(Date.now() - MINUTE) }),
    );
    refreshOfflineAccessToken.mockRejectedValue(
      new TokenGrantRejectedError('x.myshopify.com', 403, 'Token refresh'),
    );

    const err = await getAccessToken('s1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ReauthRequiredError);
    expect((err as InstanceType<typeof ReauthRequiredError>).reason).toBe('refresh-rejected');
    expect((err as InstanceType<typeof ReauthRequiredError>).shopDomain).toBe('x.myshopify.com');
  });

  it('does not overwrite the stored credentials on the way out', async () => {
    findUnique.mockResolvedValue(
      storeRow({ accessTokenExpiresAt: new Date(Date.now() - MINUTE) }),
    );
    refreshOfflineAccessToken.mockRejectedValue(
      new TokenGrantRejectedError('x.myshopify.com', 403, 'Token refresh'),
    );

    await getAccessToken('s1').catch(() => {});

    // The row is the only record of what this store once had; a failed refresh
    // must not half-write over it.
    expect(update).not.toHaveBeenCalled();
  });

  /*
   * A 500 or a 429 is the opposite case and must stay retryable — classifying
   * everything as terminal would turn a Shopify blip into a store that stops
   * syncing until someone notices.
   */
  it('leaves a transient failure retryable', async () => {
    findUnique.mockResolvedValue(
      storeRow({ accessTokenExpiresAt: new Date(Date.now() - MINUTE) }),
    );
    refreshOfflineAccessToken.mockRejectedValue(new Error('Token refresh failed: 503'));

    const err = await getAccessToken('s1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ReauthRequiredError);
  });
});
