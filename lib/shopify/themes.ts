import { logger } from '../logger';
import type { ShopifyClient } from './client';
import { parseTemplates, type ThemeTemplate } from './templates';

/**
 * The themes a widget can be placed in, and what each of them can hold.
 *
 * Placement used to be a single button pointing at `themes/current` and a
 * template we guessed — so a merchant working on an unpublished redesign was
 * sent to their live storefront, and a merchant whose theme has no
 * `templates/index.json` was sent to a template that does not exist. Both read
 * as a broken button, because from the merchant's side they are one.
 *
 * Read-only throughout. `read_themes` is what makes this possible and it is
 * the widest access Cited asks for on a theme — nothing here writes, and the
 * placement itself is still the merchant's to make in the theme editor.
 */

/**
 * Both `first:` values are cost limits, not guesses.
 *
 * A GraphQL query is charged roughly its requested connection sizes, and one
 * over 1000 points is rejected outright rather than throttled — so this is
 * 20 × (1 + 30) ≈ 620, with room to spare. 20 covers every theme a standard
 * plan can save. 30 template files is more than a theme normally has; a theme
 * with more alternates than that loses the tail of the list rather than
 * failing, which is why the two numbers are stated here together.
 */
const THEMES = /* GraphQL */ `
  query CitedThemeTemplates {
    themes(first: 20, roles: [MAIN, UNPUBLISHED, DEVELOPMENT]) {
      nodes {
        id
        name
        role
        files(filenames: ["templates/*.json"], first: 30) {
          nodes {
            filename
          }
        }
      }
    }
  }
`;

interface ThemesResponse {
  themes: {
    nodes: Array<{
      id: string;
      name: string;
      role: string;
      files: { nodes: Array<{ filename: string }> } | null;
    }>;
  } | null;
}

export interface ThemeSummary {
  /** Numeric id, which is what the theme editor's path takes. */
  id: string;
  name: string;
  /** True for the theme currently serving the storefront. */
  live: boolean;
  /**
   * Whether this theme can hold an app block at all.
   *
   * Equivalent to "is it Online Store 2.0" — a theme with JSON templates has
   * an Apps section in every one of them, and a theme without has nowhere for
   * a block to go.
   */
  supportsAppBlocks: boolean;
  templates: ThemeTemplate[];
}

/** `gid://shopify/OnlineStoreTheme/123` → `123`. The editor path takes the number. */
export function themeIdFromGid(gid: string): string {
  const tail = gid.split('/').pop() ?? gid;
  return tail;
}

/**
 * Every theme a merchant could place a widget in, live one first.
 *
 * Returns [] rather than throwing when the themes cannot be read — an old
 * token without `read_themes`, an API hiccup. The picker treats that as "fall
 * back to the live theme and let them choose in the editor", which is the
 * behaviour this replaced and is still a working path.
 */
export async function listThemes(client: ShopifyClient): Promise<ThemeSummary[]> {
  let res;
  try {
    res = await client.graphql<ThemesResponse>(THEMES);
  } catch (err) {
    logger.warn(
      { shop: client.shopDomain, err: (err as Error).message },
      'Could not list themes — widget picker will fall back to the live theme',
    );
    return [];
  }

  if (res.errors?.length) {
    logger.warn(
      { shop: client.shopDomain, errors: res.errors.map((e) => e.message) },
      'themes query returned errors',
    );
  }

  const nodes = res.data?.themes?.nodes ?? [];

  const themes = nodes.map((node) => {
    const templates = parseTemplates((node.files?.nodes ?? []).map((f) => f.filename));
    return {
      id: themeIdFromGid(node.id),
      name: node.name,
      live: node.role === 'MAIN',
      supportsAppBlocks: templates.length > 0,
      templates,
    };
  });

  // The live theme first: it is the one a merchant means unless they say
  // otherwise, and it is the only one their shoppers can see.
  return themes.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
