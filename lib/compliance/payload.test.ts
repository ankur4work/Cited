import { describe, it, expect } from 'vitest';
import { parseCompliancePayload, isComplianceTopic, COMPLIANCE_TOPICS } from './payload';

/**
 * These bodies are the one place where misreading a field means silently
 * failing to erase a real person's data — the parse returns something
 * plausible, the purge matches nothing, and the ledger records a successful
 * erasure of zero rows. So the cases below are mostly about the shapes
 * Shopify actually sends rather than the happy path.
 */
describe('isComplianceTopic', () => {
  it('accepts exactly the three mandatory topics', () => {
    expect(isComplianceTopic('customers/data_request')).toBe(true);
    expect(isComplianceTopic('customers/redact')).toBe(true);
    expect(isComplianceTopic('shop/redact')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isComplianceTopic('orders/paid')).toBe(false);
    expect(isComplianceTopic('customers/update')).toBe(false);
    expect(isComplianceTopic('')).toBe(false);
  });
});

describe('parseCompliancePayload', () => {
  it('converts numeric order ids to GIDs', () => {
    const parsed = parseCompliancePayload({
      shop_domain: 'example.myshopify.com',
      customer: { id: 191167, email: 'John@Example.com' },
      orders_to_redact: [299938, 280263],
    });

    expect(parsed.orderGids).toEqual([
      'gid://shopify/Order/299938',
      'gid://shopify/Order/280263',
    ]);
  });

  it('reads orders_requested for data requests', () => {
    const parsed = parseCompliancePayload({
      shop_domain: 'example.myshopify.com',
      orders_requested: [1],
    });
    expect(parsed.orderGids).toEqual(['gid://shopify/Order/1']);
  });

  it('lowercases the email so hashing matches stored values', () => {
    // Order.customerEmailHash is computed from a lowercased address; a
    // mixed-case redact request must hash to the same value or it erases
    // nothing.
    const parsed = parseCompliancePayload({ customer: { id: 1, email: '  John@Example.COM ' } });
    expect(parsed.customerEmail).toBe('john@example.com');
  });

  it('lowercases the shop domain', () => {
    const parsed = parseCompliancePayload({ shop_domain: 'Example.MyShopify.com' });
    expect(parsed.shopDomain).toBe('example.myshopify.com');
  });

  it('preserves large ids exactly rather than routing them through a float', () => {
    // Shopify IDs can exceed 2^53. Formatting one back out of a JS number
    // would corrupt the last digits and target the wrong order.
    const parsed = parseCompliancePayload({ orders_to_redact: ['9007199254740993'] });
    expect(parsed.orderGids).toEqual(['gid://shopify/Order/9007199254740993']);
  });

  it('passes through an id that already arrives as a GID', () => {
    const parsed = parseCompliancePayload({
      orders_to_redact: ['gid://shopify/Order/42'],
    });
    expect(parsed.orderGids).toEqual(['gid://shopify/Order/42']);
  });

  it('handles shop/redact, which carries no customer and no orders', () => {
    const parsed = parseCompliancePayload({ shop_id: 954889, shop_domain: 'x.myshopify.com' });

    expect(parsed.customerEmail).toBeNull();
    expect(parsed.customerShopifyId).toBeNull();
    expect(parsed.orderGids).toEqual([]);
  });

  it('survives a missing or malformed customer object', () => {
    expect(parseCompliancePayload({ customer: null }).customerEmail).toBeNull();
    expect(parseCompliancePayload({ customer: 'nope' }).customerEmail).toBeNull();
    expect(parseCompliancePayload({}).customerShopifyId).toBeNull();
  });

  it('drops unusable order entries instead of emitting a broken GID', () => {
    const parsed = parseCompliancePayload({
      orders_to_redact: [123, null, {}, '', 456],
    });
    expect(parsed.orderGids).toEqual([
      'gid://shopify/Order/123',
      'gid://shopify/Order/456',
    ]);
  });

  it('treats a non-array orders field as no orders', () => {
    expect(parseCompliancePayload({ orders_to_redact: 'all' }).orderGids).toEqual([]);
  });

  it('exposes the topic constants used to route', () => {
    expect(COMPLIANCE_TOPICS.SHOP_REDACT).toBe('shop/redact');
  });
});
