import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Erasure is the one path in this codebase where a silent no-op is worse than
 * a crash: it reports success, closes the ledger, and leaves the data in
 * place. These tests exist to pin the behaviour that would fail quietly —
 * which rows get matched, which get anonymised rather than deleted, and what
 * happens when the request identifies nobody.
 *
 * Prisma and the crypto keying are mocked so this runs without a database or a
 * SESSION_SECRET. What is under test is the decision-making, not Postgres.
 */

// vi.hoisted, because vi.mock is lifted above ordinary const declarations and
// its factory would otherwise close over uninitialised bindings.
const { tx, store } = vi.hoisted(() => ({
  tx: {
    review: { findMany: vi.fn(), updateMany: vi.fn() },
    reviewMedia: { findMany: vi.fn(), deleteMany: vi.fn() },
    order: { updateMany: vi.fn() },
    question: { updateMany: vi.fn() },
    requestSend: { updateMany: vi.fn() },
  },
  store: { delete: vi.fn() },
}));

vi.mock('../prisma', () => ({
  prisma: {
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    store,
    order: { count: vi.fn().mockResolvedValue(2) },
    review: { count: vi.fn().mockResolvedValue(3) },
    reviewMedia: { count: vi.fn().mockResolvedValue(0) },
    question: { count: vi.fn().mockResolvedValue(1) },
    requestSend: { count: vi.fn().mockResolvedValue(4) },
  },
}));

vi.mock('../crypto', () => ({
  hashEmail: (email: string) => `hash(${email.trim().toLowerCase()})`,
}));

import { redactCustomer, redactShop } from './redact';

/**
 * First argument the mock was called with.
 *
 * `mock.calls[0][0]` is possibly-undefined under strict TS, and asserting it
 * away with `!` would turn "the call never happened" into an unreadable
 * property-of-undefined error several lines later.
 */
function firstArg(fn: { mock: { calls: unknown[][] } }): Record<string, any> {
  const call = fn.mock.calls[0];
  if (!call) throw new Error('expected the mock to have been called, but it was not');
  return call[0] as Record<string, any>;
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.review.findMany.mockResolvedValue([]);
  tx.reviewMedia.findMany.mockResolvedValue([]);
  tx.reviewMedia.deleteMany.mockResolvedValue({ count: 0 });
  tx.review.updateMany.mockResolvedValue({ count: 0 });
  tx.order.updateMany.mockResolvedValue({ count: 0 });
  tx.question.updateMany.mockResolvedValue({ count: 0 });
  tx.requestSend.updateMany.mockResolvedValue({ count: 0 });
  store.delete.mockResolvedValue({});
});

describe('redactCustomer', () => {
  it('refuses to act when the request identifies nobody', async () => {
    const result = await redactCustomer({
      storeId: 's1',
      customerEmail: null,
      orderGids: [],
    });

    // The important half: it reports zeroes rather than reporting a
    // successful erasure, and it touches nothing.
    expect(result.counts).toEqual({
      orders: 0,
      reviews: 0,
      reviewMedia: 0,
      questions: 0,
      requestSends: 0,
    });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(tx.review.findMany).not.toHaveBeenCalled();
  });

  it('matches reviews by author email AND by the orders named in the request', async () => {
    await redactCustomer({
      storeId: 's1',
      customerEmail: 'a@b.com',
      orderGids: ['gid://shopify/Order/1'],
    });

    const where = firstArg(tx.review.findMany).where;
    expect(where.storeId).toBe('s1');
    expect(where.OR).toEqual([
      { authorEmailHash: 'hash(a@b.com)' },
      { orderShopifyGid: { in: ['gid://shopify/Order/1'] } },
    ]);
  });

  it('anonymises reviews instead of deleting them', async () => {
    tx.review.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    const result = await redactCustomer({
      storeId: 's1',
      customerEmail: 'a@b.com',
      orderGids: [],
    });

    // No deleteMany on reviews anywhere — the rating and body are the
    // merchant's product feedback and every public star rating is computed
    // from them.
    expect(tx.review.updateMany).toHaveBeenCalledTimes(1);
    const update = firstArg(tx.review.updateMany);

    expect(update.where).toEqual({ id: { in: ['r1', 'r2'] } });
    expect(update.data).toMatchObject({
      authorName: null,
      authorEmailEnc: null,
      authorEmailHash: null,
      ipHash: null,
      userAgentHash: null,
    });
    expect(update.data.redactedAt).toBeInstanceOf(Date);

    // The body and rating are never mentioned, so they cannot be cleared.
    expect(update.data).not.toHaveProperty('body');
    expect(update.data).not.toHaveProperty('rating');

    // Caller needs these to re-project the metaobject, where the author name
    // also lives.
    expect(result.reviewIds).toEqual(['r1', 'r2']);
  });

  it('clears the order mirror identifiers but keeps the order', async () => {
    await redactCustomer({ storeId: 's1', customerEmail: 'a@b.com', orderGids: [] });

    const update = firstArg(tx.order.updateMany);
    expect(update.data).toEqual({
      customerEmailEnc: null,
      customerEmailHash: null,
      customerName: null,
      customerLocale: null,
    });
  });

  it('never deletes suppression entries', async () => {
    // Deleting "do not email this person" would honour the erasure by
    // breaking the opt-out. There is deliberately no suppression client on
    // the transaction at all, so this asserts the shape of what runs.
    await redactCustomer({ storeId: 's1', customerEmail: 'a@b.com', orderGids: [] });
    expect(Object.keys(tx)).not.toContain('suppression');
  });

  it('skips hash-keyed tables when only order ids were supplied', async () => {
    await redactCustomer({
      storeId: 's1',
      customerEmail: null,
      orderGids: ['gid://shopify/Order/9'],
    });

    // Questions and sends are only findable by email hash. With no email
    // there is nothing to match, and a bare updateMany would erase the whole
    // store's rows.
    expect(tx.question.updateMany).not.toHaveBeenCalled();
    expect(tx.requestSend.updateMany).not.toHaveBeenCalled();
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it('reports counts from what was actually touched', async () => {
    tx.review.findMany.mockResolvedValue([{ id: 'r1' }]);
    tx.reviewMedia.deleteMany.mockResolvedValue({ count: 2 });
    tx.order.updateMany.mockResolvedValue({ count: 3 });
    tx.question.updateMany.mockResolvedValue({ count: 1 });
    tx.requestSend.updateMany.mockResolvedValue({ count: 5 });

    const result = await redactCustomer({
      storeId: 's1',
      customerEmail: 'a@b.com',
      orderGids: [],
    });

    expect(result.counts).toEqual({
      orders: 3,
      reviews: 1,
      reviewMedia: 2,
      questions: 1,
      requestSends: 5,
    });
  });
});

describe('redactShop', () => {
  it('deletes the store and lets the cascade do the rest', async () => {
    const result = await redactShop({ storeId: 's1', shopDomain: 'x.myshopify.com' });

    expect(store.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    expect(result.deleted).toBe(true);
    expect(result.counts.reviews).toBe(3);
  });

  it('treats an already-deleted store as done, not as a failure', async () => {
    store.delete.mockRejectedValue(new Error('Record to delete does not exist'));

    const result = await redactShop({ storeId: 'gone', shopDomain: 'x.myshopify.com' });

    // A redelivery must not fail the job — there is nothing left to erase.
    expect(result.deleted).toBe(false);
  });
});
