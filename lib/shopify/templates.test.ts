import { describe, expect, it } from 'vitest';
import { parseTemplates, suggestTemplate } from './templates';

/** A file list shaped like a real Online Store 2.0 theme's. */
const DAWN = [
  'templates/index.json',
  'templates/product.json',
  'templates/collection.json',
  'templates/list-collections.json',
  'templates/cart.json',
  'templates/page.contact.json',
  'templates/product.promotions.json',
  'templates/page.about-us.json',
  'templates/page.faq.json',
  'templates/product.remote.seller.json',
  'templates/customers/account.json',
  'templates/password.json',
  'templates/gift_card.liquid',
  'assets/base.css',
  'sections/main-product.liquid',
];

describe('parseTemplates', () => {
  it('names the standard templates the way a merchant would', () => {
    const labels = parseTemplates(DAWN)
      .filter((t) => t.isDefault)
      .map((t) => t.label);

    expect(labels).toEqual([
      'Home page',
      'Product page',
      'Collections',
      'Collections list',
      'Cart page',
    ]);
  });

  it('names an alternate by its suffix alone', () => {
    const faq = parseTemplates(DAWN).find((t) => t.key === 'page.faq');
    expect(faq).toMatchObject({ label: 'faq', base: 'page', icon: 'page', isDefault: false });
  });

  it('treats further dots as part of the suffix, not a nested type', () => {
    // `product.remote.seller` is ONE alternate product template. Splitting on
    // every dot would call its base `product` and its suffix `remote`, and
    // deep-link to a template that does not exist.
    const alt = parseTemplates(DAWN).find((t) => t.key === 'product.remote.seller');
    expect(alt).toMatchObject({ label: 'remote.seller', base: 'product', icon: 'product' });
  });

  it('lists the standard pages before the alternates', () => {
    const keys = parseTemplates(DAWN).map((t) => t.key);
    expect(keys.indexOf('cart')).toBeLessThan(keys.indexOf('page.contact'));
  });

  it('ignores liquid templates, which cannot hold an app block', () => {
    // The vintage/2.0 distinction. A merchant sent to place a widget in a
    // .liquid template finds nothing to drop it into.
    const keys = parseTemplates(['templates/index.liquid', 'templates/product.liquid']);
    expect(keys).toEqual([]);
  });

  it('leaves out account, password and gift card templates', () => {
    const keys = parseTemplates(DAWN).map((t) => t.key);
    expect(keys).not.toContain('password');
    expect(keys.some((k) => k.startsWith('customers/'))).toBe(false);
  });

  it('ignores anything outside templates/', () => {
    const keys = parseTemplates(DAWN).map((t) => t.key);
    expect(keys).not.toContain('base.css');
    expect(keys.every((k) => !k.includes('/'))).toBe(true);
  });

  it('still shows a template type it cannot name', () => {
    // Shopify has added template types before. One with a generic icon beats
    // a widget the merchant cannot place.
    const [only] = parseTemplates(['templates/some-new-thing.json']);
    expect(only).toMatchObject({ key: 'some-new-thing', label: 'some-new-thing', icon: 'template' });
  });

  it('does not list the same template twice', () => {
    const keys = parseTemplates(['templates/index.json', 'templates/index.json']);
    expect(keys).toHaveLength(1);
  });
});

describe('suggestTemplate', () => {
  const templates = parseTemplates(DAWN);

  it('picks the widget’s natural template when the theme has it', () => {
    expect(suggestTemplate(templates, 'index')?.key).toBe('index');
    expect(suggestTemplate(templates, 'product')?.key).toBe('product');
  });

  it('falls back to an alternate of the right type', () => {
    // A theme with only `product.promotions.json` and no `product.json` still
    // has somewhere sensible to put a product widget.
    const partial = parseTemplates(['templates/product.promotions.json']);
    expect(suggestTemplate(partial, 'product')?.key).toBe('product.promotions');
  });

  it('suggests nothing rather than something wrong', () => {
    // Pointing at a template the theme does not have is the failure this
    // whole dialog replaced.
    expect(suggestTemplate(parseTemplates(['templates/cart.json']), 'index')).toBeUndefined();
  });
});
