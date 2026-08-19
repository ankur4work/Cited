import { describe, expect, it } from 'vitest';
import { APP_SCOPES, missingScopes } from './app-identity';

describe('missingScopes', () => {
  it('reports nothing missing when the grant matches', () => {
    expect(missingScopes(APP_SCOPES)).toEqual([]);
  });

  it('is order-insensitive and tolerates padding', () => {
    const shuffled = APP_SCOPES.split(',').reverse().map((s) => ` ${s} `).join(',');
    expect(missingScopes(shuffled)).toEqual([]);
  });

  it('catches the grant that shipped before write_products was requested', () => {
    // The exact scope string Shopify had on record, which quietly failed every
    // rating metafield write.
    expect(
      missingScopes('read_customers,read_metaobjects,read_orders,read_products,write_product_reviews'),
    ).toEqual(['write_products']);
  });

  it('treats a write grant as satisfying a read requirement', () => {
    // Guards the loop: if write_products did not satisfy a read_products
    // requirement, a merchant who granted everything would be sent back to the
    // authorize screen on every single page load.
    const granted = 'write_products,write_orders,write_customers,write_metaobjects,write_product_reviews';
    expect(missingScopes(granted)).toEqual([]);
  });

  it('does not treat a read grant as satisfying a write requirement', () => {
    expect(missingScopes('read_products')).toContain('write_products');
  });

  it('treats an absent grant as everything missing', () => {
    expect(missingScopes(null)).toHaveLength(APP_SCOPES.split(',').length);
    expect(missingScopes('')).toHaveLength(APP_SCOPES.split(',').length);
  });

  it('ignores extra scopes the token happens to carry', () => {
    expect(missingScopes(`${APP_SCOPES},read_themes,write_discounts`)).toEqual([]);
  });
});
