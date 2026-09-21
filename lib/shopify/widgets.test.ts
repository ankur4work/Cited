import { describe, expect, it } from 'vitest';
import { WIDGETS, THEME_EXTENSION_UID, themeEditorUrl } from './widgets';

describe('THEME_EXTENSION_UID', () => {
  it('is a well-formed uuid', () => {
    // The value that shipped in 22b4d64 was the CLI's local `uid` —
    // 44 characters, a uuid with eight more hex digits stuck on the end.
    // Shopify could not resolve it, so every Add widget button answered
    // "there is a problem with the app block" and added nothing. A length
    // check is all it would have taken.
    expect(THEME_EXTENSION_UID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('themeEditorUrl', () => {
  const shop = 'ptguyn-cg.myshopify.com';
  const byId = (id: string) => WIDGETS.find((w) => w.id === id)!;

  it('addresses a block as uuid/handle on its own template', () => {
    const url = new URL(themeEditorUrl(shop, byId('review-carousel')));
    expect(url.searchParams.get('addAppBlockId')).toBe(
      `${THEME_EXTENSION_UID}/review-carousel`,
    );
    // A carousel belongs on the home page; sending it to the product editor
    // reads to a merchant as a broken button.
    expect(url.searchParams.get('template')).toBe('index');
  });

  it('defaults a block with no template to product', () => {
    const url = new URL(themeEditorUrl(shop, byId('review-display')));
    expect(url.searchParams.get('template')).toBe('product');
  });

  it('activates the embed rather than adding it', () => {
    // An embed is toggled in theme settings, not placed in a template. The
    // wrong parameter opens the editor with nothing selected.
    const url = new URL(themeEditorUrl(shop, byId('auto-embed')));
    expect(url.searchParams.get('activateAppId')).toBe(
      `${THEME_EXTENSION_UID}/reviews-embed`,
    );
    expect(url.searchParams.get('addAppBlockId')).toBeNull();
  });

  it('strips the .myshopify.com suffix from the admin path', () => {
    expect(themeEditorUrl(shop, byId('review-display'))).toContain(
      '/store/ptguyn-cg/themes/current/editor',
    );
  });
});
