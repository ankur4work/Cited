import { env } from './env';
import { logger } from './logger';
import { prisma } from './prisma';
import { ShopifyClient } from './shopify/client';
import { DEEP_LINK_APP_ID } from './shopify/widgets';

/**
 * Theme app block: placement and detection.
 *
 * Cited does not write to themes. Placement is the merchant's, through the
 * theme editor or a single App embeds toggle — asking for `write_themes` to
 * automate one click would give this app edit access to every merchant's live
 * storefront, which is not a trade worth making for a convenience.
 *
 * Detection is a different question, and it used to be answered by fetching a
 * product page and looking for our markup. That is honest but blind: a
 * password-protected storefront answers 302 to /password, so the check could
 * never do better than "unknown" — and the setup step stayed grey no matter
 * what the merchant did. It also cannot see an app embed that is present but
 * toggled off.
 *
 * So detection reads the theme itself. `read_themes` is read-only and cannot
 * modify anything; it answers the question directly rather than inferring it
 * from a page that may not be reachable.
 */

/**
 * The CLI's local `uid` from extensions/reviews-widget/shopify.extension.toml.
 *
 * Kept ONLY for detection, and only as one of two markers. It is not a uuid —
 * 44 characters — and it is not what a deep link is addressed by; used as one,
 * it produced "«reviews» not added. There is a problem with the app block." on
 * every Add widget button this app has ever rendered. Deep links now use
 * DEEP_LINK_APP_ID, which is the documented value.
 */
const EXTENSION_LOCAL_UID = '6cea37c8-6927-f5f3-2a46-b9a5792e946fa85d53f9';

/**
 * How one of our blocks appears in a theme file.
 *
 * Shopify writes an app block's type as
 * `shopify://apps/{app-handle}/blocks/{block}/{extension-uuid}`, so this
 * prefix identifies any Cited block without needing to know which uuid the
 * theme recorded — the question that made the deep link wrong for a year.
 */
const THEME_BLOCK_PREFIX = `shopify://apps/${env.SHOPIFY_APP_HANDLE}/blocks/`;

/**
 * Is this theme file referring to a Cited block?
 *
 * Two markers rather than one. The prefix is the one that should always match;
 * the local uid is kept because it is what the previous check looked for, and
 * detection reporting "missing" on a store that is working is worse than a
 * marker too many. Both strings are ours, so neither can match another app.
 */
function mentionsCited(content: string): boolean {
  return content.includes(THEME_BLOCK_PREFIX) || content.includes(EXTENSION_LOCAL_UID);
}

/** File name of blocks/reviews.liquid, without the extension. */
export const REVIEW_BLOCK_HANDLE = 'reviews';

/**
 * Where in the product template the editor should drop the block.
 *
 * `mainSection` puts reviews inside the theme's own product section, which is
 * where they belong — but it only works if that section declares support for
 * app blocks (`{"type": "@app"}` in its schema). Plenty of themes, and most
 * custom ones, do not. When the section refuses, the editor adds nothing and
 * shows "There is a problem with the app block. Contact the app developer.",
 * which reads like our bug and isn't.
 *
 * `newAppsSection` sidesteps that by creating a section of its own.
 */
export type ThemeEditorTarget = 'mainSection' | 'newAppsSection';

/**
 * Deep link that opens the theme editor on the product template with our block
 * ready to place.
 */
export function themeEditorDeepLink(
  shopDomain: string,
  target: ThemeEditorTarget = 'mainSection',
): string {
  // Built by hand rather than with URLSearchParams, which percent-encodes the
  // separator in `{id}/{handle}` to %2F. Shopify's editor expects a literal
  // slash there; encoded, it fails to resolve the block.
  //
  // Nothing here is user input — both values are module constants — so there
  // is no injection surface to encode against.
  return (
    `https://${shopDomain}/admin/themes/current/editor` +
    `?template=product` +
    `&addAppBlockId=${DEEP_LINK_APP_ID}/${REVIEW_BLOCK_HANDLE}` +
    `&target=${target}`
  );
}

export type ThemeBlockStatus = 'installed' | 'missing' | 'unknown';

const THEME_FILES = /* GraphQL */ `
  query CitedThemeFiles($filenames: [String!]!) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        files(filenames: $filenames, first: 10) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }
  }
`;

interface ThemeFilesResponse {
  themes: {
    nodes: Array<{
      id: string;
      files: { nodes: Array<{ filename: string; body: { content?: string } | null }> };
    }>;
  } | null;
}

/**
 * Is Cited actually rendering on this store's product pages?
 *
 * Answers 'installed' when EITHER route is live:
 *   * the app embed is switched on in theme settings, or
 *   * the app block is placed in a product template
 *
 * Both carry the extension's uid inside the block `type`, which is what makes
 * one substring search sufficient for either.
 *
 * Returns 'unknown' rather than guessing when the theme cannot be read at all
 * — no scope, an API failure — because reporting "missing" on a store that is
 * working is worse than admitting we do not know.
 */
export async function checkThemeBlock(
  storeId: string,
  shopDomain: string,
): Promise<ThemeBlockStatus> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, shopDomain: true },
  });
  if (!store) return 'unknown';

  try {
    const res = await new ShopifyClient(store).graphql<ThemeFilesResponse>(THEME_FILES, {
      filenames: ['config/settings_data.json', 'templates/product.json'],
    });

    const theme = res.data?.themes?.nodes?.[0];
    if (!theme) {
      logger.debug({ shop: shopDomain }, 'Theme check: no main theme returned');
      return 'unknown';
    }

    for (const file of theme.files.nodes) {
      const content = file.body?.content;
      if (!content) continue;

      if (file.filename === 'config/settings_data.json') {
        if (appEmbedEnabled(content)) return 'installed';
        continue;
      }

      // A template carries the block only when it is actually placed, so the
      // reference appearing at all is the answer.
      if (mentionsCited(content)) return 'installed';
    }

    return 'missing';
  } catch (err) {
    logger.debug(
      { shop: shopDomain, err: (err as Error).message },
      'Theme check failed — reporting unknown',
    );
    return 'unknown';
  }
}

/**
 * Is our app embed present AND switched on?
 *
 * Shopify keeps disabled embeds in settings_data.json with `"disabled": true`
 * rather than removing them, so a substring match alone would call a
 * toggled-off embed installed — and the merchant would be told the step was
 * done while their storefront showed nothing.
 */
function appEmbedEnabled(settingsJson: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsJson);
  } catch {
    // A theme may leave comments or trailing commas in settings_data.json.
    // Fall back to the substring, accepting that it cannot see `disabled`.
    return mentionsCited(settingsJson);
  }

  const blocks = (parsed as { current?: { blocks?: Record<string, unknown> } })?.current?.blocks;
  if (!blocks || typeof blocks !== 'object') return false;

  return Object.values(blocks).some((block) => {
    const entry = block as { type?: unknown; disabled?: unknown };
    return (
      typeof entry.type === 'string' && mentionsCited(entry.type) && entry.disabled !== true
    );
  });
}
