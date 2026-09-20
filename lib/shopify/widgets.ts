/**
 * The widgets a merchant can place, and the deep links that place them.
 *
 * Every widget here is a real block in the theme app extension. A card for
 * something unbuilt would send a merchant to a theme editor that offers them
 * nothing, so this list and extensions/reviews-widget/blocks/ must stay in
 * step.
 */

/**
 * The theme app extension's uid, from extensions/reviews-widget/shopify.extension.toml.
 *
 * Shopify's theme-editor deep links address a block as `{uuid}/{handle}`, and
 * the uuid is the EXTENSION's, not the app's. It changes only if the extension
 * is recreated, which would also change every block handle beneath it.
 */
export const THEME_EXTENSION_UID = '6cea37c8-6927-f5f3-2a46-b9a5792e946fa85d53f9';

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  /** Block file name without .liquid, or the embed handle. */
  handle: string;
  /** App blocks are added to a template; embeds are toggled in Theme settings. */
  kind: 'block' | 'embed';
  /**
   * Which template the theme editor should open on.
   *
   * A carousel belongs on the home page and a snippet belongs beside a buy
   * button, so sending both to `product` would drop half of these into a
   * template they make no sense in — and a merchant who lands in the wrong
   * editor mostly concludes the button is broken.
   */
  template?: 'product' | 'index' | 'page' | 'collection';
  /** What the merchant gets, in their words, for the card body. */
  points: string[];
}

export const WIDGETS: WidgetDef[] = [
  {
    id: 'review-display',
    name: 'Review Display',
    description:
      'The full reviews section — rating breakdown, every review with photos, and the write-a-review form.',
    handle: 'reviews',
    kind: 'block',
    points: [
      'Rating breakdown graph',
      'Reviews with photos and video',
      'Write-a-review form',
      'In your page’s HTML, so Google and AI assistants read it',
    ],
  },
  {
    id: 'star-rating',
    name: 'Star Rating',
    description:
      'Just the rating line — score, stars and review count — to sit under your product title or beside the price.',
    handle: 'star-rating',
    kind: 'block',
    points: ['Links to the reviews below', 'No JavaScript', 'Matches your theme’s colours'],
  },
  {
    id: 'review-snippet',
    name: 'Review Snippet',
    description:
      'A short quote from a real review, placed next to the Add to cart button where hesitation happens.',
    handle: 'review-snippet',
    kind: 'block',
    points: [
      'Picks reviews that actually said something',
      'Most helpful first, not newest',
      'Shows the verified-purchase badge',
    ],
  },
  {
    id: 'review-carousel',
    name: 'Review Carousel',
    description:
      'Your best reviews in a scrollable row, for the home page or any landing page — anywhere there is no single product.',
    handle: 'review-carousel',
    kind: 'block',
    template: 'index',
    points: [
      'Works on any page, not just products',
      'Scrolls by touch, trackpad, keyboard and scrollbar',
      'Each review links to the product it is about',
    ],
  },
  {
    id: 'testimonials',
    name: 'Testimonials',
    description:
      'The same reviews, presented larger and quieter. A carousel sells products; a testimonial strip sells the store.',
    handle: 'testimonials',
    kind: 'block',
    template: 'index',
    points: ['Fewer, longer quotes', 'Reads rather than skims', 'No product thumbnails by default'],
  },
  {
    id: 'review-counter',
    name: 'Review Counter',
    description:
      'Your store’s overall rating as a compact badge — for a header, a footer, or beside a hero.',
    handle: 'review-counter',
    kind: 'block',
    template: 'index',
    points: [
      'Averaged across reviews, not across products',
      'One line or stacked',
      'Tiny — it fits in a header',
    ],
  },
  {
    id: 'review-page',
    name: 'Review Page',
    description:
      'A dedicated page showing reviews from across your store in a grid, for browsing rather than glancing.',
    handle: 'review-page',
    kind: 'block',
    template: 'page',
    points: ['Add to any page template', 'Reflows to the space your theme gives it', 'Store rating at the top'],
  },
  {
    id: 'auto-embed',
    name: 'Automatic placement',
    description:
      'One toggle, every product. Puts the rating under your product title and the reviews below the product — no placement step, and it works on themes that do not accept app blocks.',
    handle: 'reviews-embed',
    kind: 'embed',
    points: [
      'Works on any theme',
      'Nothing to position by hand',
      'Turns itself off where you placed a block yourself',
    ],
  },
];

/**
 * Deep link into the theme editor with this widget ready to place.
 *
 * `themes/current` rather than a theme id: resolving the published theme would
 * cost an API call and go stale the moment a merchant publishes another one.
 *
 * The two kinds take different parameters — an app block is ADDED to a
 * template, an app embed is ACTIVATED in theme settings — and using the wrong
 * one opens the editor with nothing selected, which reads as a broken button.
 */
export function themeEditorUrl(shopDomain: string, widget: WidgetDef): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, '');
  const base = `https://admin.shopify.com/store/${store}/themes/current/editor`;
  const target = `${THEME_EXTENSION_UID}/${widget.handle}`;

  if (widget.kind === 'embed') {
    return `${base}?context=apps&activateAppId=${encodeURIComponent(target)}`;
  }

  const template = widget.template ?? 'product';
  return `${base}?template=${template}&addAppBlockId=${encodeURIComponent(target)}&target=mainSection`;
}
