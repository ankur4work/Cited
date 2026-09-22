import { describe, expect, it } from 'vitest';
import { APP_CLIENT_ID } from './app-identity';
import { WIDGETS, DEEP_LINK_APP_ID, themeEditorUrl } from './widgets';

describe('DEEP_LINK_APP_ID', () => {
  it('is the app client id, which is what Shopify resolves', () => {
    // Shopify documents `addAppBlockId={api_key}/{handle}` — the api_key being
    // the client_id. Three other ids in this project look plausible: the CLI's
    // local `uid` (44 characters, shipped in 22b4d64 and never worked), the
    // version-scoped id in the CDN asset path, and the uuid in the deploy
    // bundle manifest. None of them is the documented one.
    expect(DEEP_LINK_APP_ID).toBe(APP_CLIENT_ID);
  });

  it('carries no slash, which would split the block reference', () => {
    // The parameter is `{id}/{handle}`; a slash in the id silently addresses a
    // different block and the editor adds nothing.
    expect(DEEP_LINK_APP_ID).not.toContain('/');
  });
});

describe('themeEditorUrl', () => {
  const shop = 'ptguyn-cg.myshopify.com';
  const byId = (id: string) => WIDGETS.find((w) => w.id === id)!;

  it('addresses a block as id/handle on its own template', () => {
    const url = new URL(themeEditorUrl(shop, byId('review-carousel')));
    expect(url.searchParams.get('addAppBlockId')).toBe(`${DEEP_LINK_APP_ID}/review-carousel`);
    // A carousel belongs on the home page; sending it to the product editor
    // reads to a merchant as a broken button.
    expect(url.searchParams.get('template')).toBe('index');
  });

  it('defaults a block with no template to product', () => {
    const url = new URL(themeEditorUrl(shop, byId('review-display')));
    expect(url.searchParams.get('template')).toBe('product');
  });

  it('targets the Apps section, the one every JSON template must accept', () => {
    // `mainSection` needs the theme's product section to declare `@app`
    // support. Plenty do not, and when it is absent the editor adds nothing
    // and blames the app block.
    const url = new URL(themeEditorUrl(shop, byId('review-display')));
    expect(url.searchParams.get('target')).toBe('newAppsSection');
  });

  it('activates the embed rather than adding it', () => {
    // An embed is toggled in theme settings, not placed in a template. The
    // wrong parameter opens the editor with nothing selected.
    const url = new URL(themeEditorUrl(shop, byId('auto-embed')));
    expect(url.searchParams.get('activateAppId')).toBe(`${DEEP_LINK_APP_ID}/reviews-embed`);
    expect(url.searchParams.get('addAppBlockId')).toBeNull();
  });

  it('strips the .myshopify.com suffix from the admin path', () => {
    expect(themeEditorUrl(shop, byId('review-display'))).toContain(
      '/store/ptguyn-cg/themes/current/editor',
    );
  });

  it('opens the theme the merchant chose, not the published one', () => {
    // Without this, a merchant building an unpublished redesign was sent to
    // edit the theme their shoppers are looking at.
    const url = themeEditorUrl(shop, byId('review-display'), {
      themeId: '182736455',
      template: 'page.faq',
    });
    expect(url).toContain('/themes/182736455/editor');
    expect(new URL(url).searchParams.get('template')).toBe('page.faq');
  });

  it('keeps the slash in the block reference literal', () => {
    // Percent-encoded to %2F, the editor does not resolve the block — and
    // every documented example writes it plainly.
    expect(themeEditorUrl(shop, byId('review-display'))).toContain(
      `addAppBlockId=${DEEP_LINK_APP_ID}/reviews`,
    );
    expect(themeEditorUrl(shop, byId('auto-embed'))).toContain(
      `activateAppId=${DEEP_LINK_APP_ID}/reviews-embed`,
    );
  });
});
