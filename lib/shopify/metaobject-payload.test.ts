import { describe, it, expect } from 'vitest';
import {
  driftedFieldKeys,
  normalizeMetaobjectGid,
  parseMetaobjectWebhookPayload,
  reviewIdFromHandle,
  reviewMetaobjectHandle,
} from './metaobject-payload';

describe('normalizeMetaobjectGid', () => {
  it('passes a GID through unchanged', () => {
    expect(normalizeMetaobjectGid('gid://shopify/Metaobject/123')).toBe(
      'gid://shopify/Metaobject/123',
    );
  });

  // Review.metaobjectGid stores the GID form. A bare numeric id that stayed
  // numeric would match no row, and every webhook would look foreign.
  it('promotes a bare numeric id to a GID, as string or number', () => {
    expect(normalizeMetaobjectGid('123')).toBe('gid://shopify/Metaobject/123');
    expect(normalizeMetaobjectGid(123)).toBe('gid://shopify/Metaobject/123');
  });

  it('rejects junk rather than fabricating a GID', () => {
    expect(normalizeMetaobjectGid('')).toBeNull();
    expect(normalizeMetaobjectGid('  ')).toBeNull();
    expect(normalizeMetaobjectGid(null)).toBeNull();
    expect(normalizeMetaobjectGid(undefined)).toBeNull();
    expect(normalizeMetaobjectGid('not-an-id')).toBeNull();
    expect(normalizeMetaobjectGid(-5)).toBeNull();
  });
});

describe('handle round trip', () => {
  it('recovers the review id from a handle we wrote', () => {
    const id = 'clxyz0123abc';
    expect(reviewIdFromHandle(reviewMetaobjectHandle(id))).toBe(id);
  });

  it('treats a foreign handle as not ours', () => {
    expect(reviewIdFromHandle('judgeme-review-42')).toBeNull();
    expect(reviewIdFromHandle('cited-')).toBeNull();
  });
});

describe('parseMetaobjectWebhookPayload', () => {
  it('accepts fields as an object', () => {
    const parsed = parseMetaobjectWebhookPayload({
      id: 'gid://shopify/Metaobject/1',
      type: 'product_review',
      handle: 'cited-abc',
      updated_at: '2026-08-14T00:00:00Z',
      fields: { rating: '{"value":"5.0"}', body: 'Great' },
    });
    expect(parsed?.fields).toEqual({ rating: '{"value":"5.0"}', body: 'Great' });
    expect(parsed?.handle).toBe('cited-abc');
  });

  // Shopify's review-app docs and its general metaobject docs disagree on the
  // shape. Guessing wrong would make every webhook look like drift.
  it('accepts fields as a key/value array', () => {
    const parsed = parseMetaobjectWebhookPayload({
      id: 'gid://shopify/Metaobject/1',
      fields: [
        { key: 'rating', value: '{"value":"5.0"}' },
        { key: 'body', value: 'Great' },
      ],
    });
    expect(parsed?.fields).toEqual({ rating: '{"value":"5.0"}', body: 'Great' });
  });

  it('distinguishes "no fields sent" from "fields are empty"', () => {
    expect(parseMetaobjectWebhookPayload({ id: '1' })?.fields).toBeNull();
    expect(parseMetaobjectWebhookPayload({ id: '1', fields: {} })?.fields).toEqual({});
  });

  it('normalises an unset field value to an empty string', () => {
    const parsed = parseMetaobjectWebhookPayload({
      id: '1',
      fields: [{ key: 'title', value: null }],
    });
    expect(parsed?.fields).toEqual({ title: '' });
  });

  it('returns null when there is no usable id', () => {
    expect(parseMetaobjectWebhookPayload({ type: 'product_review' })).toBeNull();
    expect(parseMetaobjectWebhookPayload(null)).toBeNull();
    expect(parseMetaobjectWebhookPayload('nope')).toBeNull();
  });
});

describe('driftedFieldKeys', () => {
  const expected = [
    { key: 'rating', value: '{"value":"5.0"}' },
    { key: 'body', value: 'Great' },
  ];

  // The echo of our own write. Must be empty or the app rewrites the
  // metaobject, gets a webhook about its own rewrite, and loops forever.
  it('reports nothing when the stored copy matches', () => {
    expect(driftedFieldKeys(expected, { rating: '{"value":"5.0"}', body: 'Great' })).toEqual([]);
  });

  it('reports a changed value', () => {
    expect(driftedFieldKeys(expected, { rating: '{"value":"1.0"}', body: 'Great' })).toEqual([
      'rating',
    ]);
  });

  it('reports a field that was removed entirely', () => {
    expect(driftedFieldKeys(expected, { rating: '{"value":"5.0"}' })).toEqual(['body']);
  });

  // We have no opinion about fields we do not write. Treating them as drift
  // would mean fighting another app forever over a field we do not own.
  it('ignores extra fields we do not manage', () => {
    expect(
      driftedFieldKeys(expected, {
        rating: '{"value":"5.0"}',
        body: 'Great',
        some_other_app_field: 'x',
      }),
    ).toEqual([]);
  });
});
