import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ env: { SHOPIFY_API_SECRET: 'x', SHOPIFY_SCOPES: 'read_products' } }));
vi.mock('./client', () => ({ ShopifyClient: class {} }));
vi.mock('../logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { buildReviewFields } = await import('./metaobjects');
const { driftedFieldKeys } = await import('./metaobject-payload');

function fields(overrides: Record<string, unknown> = {}) {
  return buildReviewFields({
    handle: 'cited-abc',
    productGid: 'gid://shopify/Product/1',
    rating: 4,
    submittedAt: new Date('2026-08-19T22:01:04.668Z'),
    verification: 'unverified',
    source: 'cited',
    ...overrides,
  } as never);
}

function valueOf(key: string, list: Array<{ key: string; value: string }>) {
  return list.find((f) => f.key === key)?.value;
}

describe('date_time serialization', () => {
  /*
   * Shopify truncates date_time to whole seconds. Sending milliseconds made
   * our serialization permanently unequal to the stored value, so reconcile
   * saw drift on every echo of our own write and rewrote the metaobject
   * forever. These tests exist to stop that loop coming back.
   */
  it('drops milliseconds from submitted_at', () => {
    expect(valueOf('submitted_at', fields())).toBe('2026-08-19T22:01:04Z');
  });

  it('drops milliseconds from published_at', () => {
    const list = fields({ publishedAt: new Date('2026-08-19T22:01:04.666Z') });
    expect(valueOf('published_at', list)).toBe('2026-08-19T22:01:04Z');
  });

  it('keeps a whole-second timestamp unchanged', () => {
    const list = fields({ submittedAt: new Date('2026-08-19T22:01:04.000Z') });
    expect(valueOf('submitted_at', list)).toBe('2026-08-19T22:01:04Z');
  });

  it('reports no drift against what Shopify actually stores', () => {
    // The exact payload Shopify returned for a real review, which the old
    // serialization disagreed with on two fields.
    const stored: Record<string, string> = {
      rating: JSON.stringify({ scale_min: '1.0', scale_max: '5.0', value: '4.0' }),
      submitted_at: '2026-08-19T22:01:04Z',
      published_at: '2026-08-19T22:01:04Z',
      source: 'cited',
      product: 'gid://shopify/Product/1',
      app_verification_status: 'unverified',
    };
    const list = fields({ publishedAt: new Date('2026-08-19T22:01:04.666Z') });
    expect(driftedFieldKeys(list, stored)).toEqual([]);
  });
});

describe('author fields', () => {
  it('puts the display name in author_display_name, never in author', () => {
    const list = fields({ author: 'Priya S' });
    expect(valueOf('author_display_name', list)).toBe('Priya S');
    // `author` is a customer_reference; a name there fails the whole upsert.
    expect(valueOf('author', list)).toBeUndefined();
  });

  it('only sends author when it is a real customer reference', () => {
    const list = fields({ author: 'Priya S', authorCustomerGid: 'gid://shopify/Customer/9' });
    expect(valueOf('author', list)).toBe('gid://shopify/Customer/9');
  });
});
