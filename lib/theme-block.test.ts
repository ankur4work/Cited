import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ env: { SHOPIFY_API_SECRET: 'x', SHOPIFY_SCOPES: 'read_themes' } }));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./shopify/client', () => ({ ShopifyClient: class {} }));
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { themeEditorDeepLink, THEME_EXTENSION_UUID } = await import('./theme-block');

describe('themeEditorDeepLink', () => {
  it('keeps the uuid/handle separator as a literal slash', () => {
    // URLSearchParams would encode it to %2F, and the editor then fails to
    // resolve the block — which surfaces as "there is a problem with the app
    // block" and reads like our bug.
    const link = themeEditorDeepLink('example.myshopify.com');
    expect(link).toContain(`addAppBlockId=${THEME_EXTENSION_UUID}/reviews`);
    expect(link).not.toContain('%2F');
  });

  it('defaults to the main product section', () => {
    expect(themeEditorDeepLink('example.myshopify.com')).toContain('target=mainSection');
  });

  it('can ask for a section of its own instead', () => {
    // The fallback for themes whose product section refuses app blocks.
    expect(themeEditorDeepLink('example.myshopify.com', 'newAppsSection')).toContain(
      'target=newAppsSection',
    );
  });

  it('opens the product template', () => {
    expect(themeEditorDeepLink('example.myshopify.com')).toContain('template=product');
  });
});
