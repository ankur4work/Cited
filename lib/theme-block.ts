import { logger } from './logger';
import { prisma } from './prisma';

/**
 * Theme app block: placement and detection.
 *
 * Cited cannot add the block itself. Writing into a theme needs
 * `read_themes`/`write_themes`, which this app deliberately does not request —
 * app blocks are placed by the merchant in the theme editor, and asking for
 * theme write access to automate one click would widen the app's blast radius
 * over every merchant's live storefront.
 *
 * So the app does the two things it can: send the merchant straight to the
 * right editor screen with the block preselected, and then verify from the
 * public storefront whether the block actually renders.
 */

/** Must match `uid` in extensions/reviews-widget/shopify.extension.toml. */
export const THEME_EXTENSION_UUID = '6cea37c8-6927-f5f3-2a46-b9a5792e946fa85d53f9';

/** File name of blocks/reviews.liquid, without the extension. */
export const REVIEW_BLOCK_HANDLE = 'reviews';

/**
 * Deep link that opens the theme editor on the product template with our block
 * ready to place.
 *
 * `template=product` picks the product template, `addAppBlockId` preselects the
 * block, and `target=mainSection` drops it into the main product section rather
 * than a sidebar. If the theme editor cannot resolve the block it still opens
 * the right template, so the worst case is the merchant adding it by hand
 * instead of a dead end.
 */
export function themeEditorDeepLink(shopDomain: string): string {
  const params = new URLSearchParams({
    template: 'product',
    addAppBlockId: `${THEME_EXTENSION_UUID}/${REVIEW_BLOCK_HANDLE}`,
    target: 'mainSection',
  });
  return `https://${shopDomain}/admin/themes/current/editor?${params.toString()}`;
}

export type ThemeBlockStatus = 'installed' | 'missing' | 'unknown';

/**
 * Is the block actually on the storefront?
 *
 * Detected by fetching a real product page and looking for the attribute the
 * block renders. This is deliberately an outside-in check: it answers "does a
 * shopper see reviews", which is the only version of the question that matters,
 * and it needs no theme permissions at all.
 *
 * Returns 'unknown' rather than guessing when the storefront is password
 * protected or unreachable — a development store is usually locked, and
 * reporting "not installed" there would be a lie a merchant can't act on.
 */
export async function checkThemeBlock(
  storeId: string,
  shopDomain: string,
): Promise<ThemeBlockStatus> {
  const product = await prisma.product.findFirst({
    where: { storeId, status: 'ACTIVE' },
    select: { handle: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!product?.handle) return 'unknown';

  try {
    const res = await fetch(`https://${shopDomain}/products/${product.handle}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'Cited/1.0 (+theme block check)' },
    });

    // 30x is the password page; 401/403 likewise. Not evidence either way.
    if (res.status >= 300) return 'unknown';

    const html = await res.text();
    return html.includes('data-cited-product') ? 'installed' : 'missing';
  } catch (err) {
    logger.debug(
      { shop: shopDomain, err: (err as Error).message },
      'Theme block check failed — reporting unknown',
    );
    return 'unknown';
  }
}
