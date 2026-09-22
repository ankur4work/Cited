import { describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({
  env: {
    SHOPIFY_API_SECRET: 'x',
    SHOPIFY_SCOPES: 'read_themes',
    SHOPIFY_APP_HANDLE: 'cited-reviews',
  },
}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./shopify/client', () => ({ ShopifyClient: class {} }));
vi.mock('./logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { themeEditorDeepLink } = await import('./theme-block');
const { DEEP_LINK_APP_ID } = await import('./shopify/widgets');

describe('themeEditorDeepLink', () => {
  it('addresses the block by the app id Shopify documents', () => {
    // This link carried the CLI's local 44-character `uid` instead, so the
    // dashboard's "Add block to theme" failed the same way the Widgets page's
    // Add widget button did — "there is a problem with the app block", which
    // reads like our bug and was.
    expect(themeEditorDeepLink('example.myshopify.com')).toContain(
      `addAppBlockId=${DEEP_LINK_APP_ID}/reviews`,
    );
  });

  it('keeps the id/handle separator as a literal slash', () => {
    // URLSearchParams would encode it to %2F, and the editor then fails to
    // resolve the block.
    expect(themeEditorDeepLink('example.myshopify.com')).not.toContain('%2F');
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
