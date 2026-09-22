import { describe, expect, it, vi } from 'vitest';
import type { ShopifyClient } from './client';
import { listThemes, themeIdFromGid } from './themes';

function client(response: unknown): ShopifyClient {
  return {
    shopDomain: 'ptguyn-cg.myshopify.com',
    graphql: vi.fn().mockResolvedValue(response),
  } as unknown as ShopifyClient;
}

const theme = (id: string, name: string, role: string, files: string[]) => ({
  id: `gid://shopify/OnlineStoreTheme/${id}`,
  name,
  role,
  files: { nodes: files.map((filename) => ({ filename })) },
});

describe('themeIdFromGid', () => {
  it('takes the number the editor path wants', () => {
    expect(themeIdFromGid('gid://shopify/OnlineStoreTheme/182736455')).toBe('182736455');
  });
});

describe('listThemes', () => {
  it('puts the live theme first', async () => {
    const res = await listThemes(
      client({
        data: {
          themes: {
            nodes: [
              theme('1', 'Redesign', 'UNPUBLISHED', ['templates/index.json']),
              theme('2', 'pet-theme', 'MAIN', ['templates/index.json']),
            ],
          },
        },
      }),
    );

    expect(res.map((t) => t.name)).toEqual(['pet-theme', 'Redesign']);
    expect(res[0]!).toMatchObject({ id: '2', live: true });
  });

  it('calls a theme with JSON templates app-block capable', async () => {
    const res = await listThemes(
      client({
        data: {
          themes: { nodes: [theme('1', 'Dawn', 'MAIN', ['templates/product.json'])] },
        },
      }),
    );
    expect(res[0]!.supportsAppBlocks).toBe(true);
    expect(res[0]!.templates.map((t) => t.key)).toEqual(['product']);
  });

  it('calls a vintage theme incapable rather than offering it', async () => {
    // Only .liquid templates. Offering this one produces a deep link the
    // editor cannot honour, which reads as our bug.
    const res = await listThemes(
      client({
        data: { themes: { nodes: [theme('1', 'Brooklyn', 'MAIN', ['templates/product.liquid'])] } },
      }),
    );
    expect(res[0]!.supportsAppBlocks).toBe(false);
    expect(res[0]!.templates).toEqual([]);
  });

  it('answers [] when themes cannot be read at all', async () => {
    // An old token without read_themes. The dialog falls back to the live
    // theme, which still places the widget — throwing here would take the
    // whole Add widget button down with it.
    const broken = {
      shopDomain: 'ptguyn-cg.myshopify.com',
      graphql: vi.fn().mockRejectedValue(new Error('403')),
    } as unknown as ShopifyClient;

    await expect(listThemes(broken)).resolves.toEqual([]);
  });

  it('survives a theme that returned no files', async () => {
    const res = await listThemes(
      client({ data: { themes: { nodes: [{ ...theme('1', 'Dawn', 'MAIN', []), files: null }] } } }),
    );
    expect(res[0]!.supportsAppBlocks).toBe(false);
  });
});
