/**
 * The widgets a merchant can place, and the deep links that place them.
 *
 * Every widget here is a real block in the theme app extension. A card for
 * something unbuilt would send a merchant to a theme editor that offers them
 * nothing, so this list and extensions/reviews-widget/blocks/ must stay in
 * step.
 */

import { APP_CLIENT_ID } from './app-identity';

/**
 * The id a theme-editor deep link addresses this app's blocks by.
 *
 * Shopify writes it as `{uuid}/{handle}`, which reads like the theme app
 * extension's uuid and is not: the documented value is **the app's api_key**,
 * i.e. the `client_id` in shopify.app.toml.
 *
 *   https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
 *   .../editor?template={template}&addAppBlockId={api_key}/{handle}&target=newAppsSection
 *
 * Three other ids in this project look like candidates and none of them is
 * this one:
 *
 *   - `uid` in extensions/reviews-widget/shopify.extension.toml —
 *     `6cea37c8…a85d53f9`, 44 characters, not a uuid at all. It is the CLI's
 *     local handle for the directory. This is what shipped in 22b4d64, so
 *     every "Add widget" button since has produced "«reviews» not added.
 *     There is a problem with the app block."
 *   - the id in the CDN asset path, `cdn.shopify.com/extensions/{id}/…`.
 *     Tempting, because it is right there in any storefront's HTML — but it
 *     is scoped to the VERSION. Releasing cited-reviews-34 changed it from
 *     `01a0c045-…` to `01a0c42b-…`, so pinning it would break the links again
 *     on the next deploy.
 *   - the `uuid` in .shopify/deploy-bundle/manifest.json, which is stable
 *     across releases — that is a real property, and it is why 61f1906 chose
 *     it — but stable is not the same as correct, and it is a build artefact
 *     that is not even committed.
 *
 * The client id is the documented one, it is already asserted against the
 * environment by the health check, and it cannot drift: it identifies the app,
 * not a version or a directory.
 */
export const DEEP_LINK_APP_ID = APP_CLIENT_ID;

/**
 * Where in the template the editor drops the block.
 *
 * `mainSection` puts it INSIDE the theme's own product section, which is where
 * reviews belong — directly under the product, above whatever the template
 * puts next. It requires that section to declare app-block support
 * (`{"type": "@app"}`), and a theme that does not adds nothing and says "There
 * is a problem with the app block."
 *
 * `newAppsSection` creates a section of its own. It cannot be refused — every
 * JSON template in a Theme Store theme must accept app blocks there — but the
 * new section lands at the END of the template, so on a product page the
 * reviews appear below Related products rather than below the product.
 */
export type DeepLinkTarget = 'mainSection' | 'newAppsSection';

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
  /**
   * Where on the storefront this ends up, in one line.
   *
   * The cards showed a picture and a description and never said which page the
   * thing lands on, or whereabouts. A merchant looking at seven drawings could
   * not tell that three of them are product-page widgets and four are not —
   * and after placing one, could not tell where to go and look at it.
   */
  where: string;
  /**
   * Where in the template this one belongs, by default.
   *
   * `mainSection` means INSIDE the theme's product section — which on every
   * modern theme is the narrow right-hand column beside the product image.
   * That is exactly right for a rating line or a one-line quote, and wrong for
   * the full reviews section: defaulting the whole thing there squeezed a
   * two-column layout, a photo strip and a review grid into a 420px sidebar.
   *
   * So it is per widget rather than one default for all of them. Anything
   * full-width goes to `newAppsSection`, which is its own section below the
   * product.
   */
  target: DeepLinkTarget;
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
    where: "On a product page, below the product — the full reviews section",
    target: 'newAppsSection',
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
    where: "On a product page, under the title or beside the price",
    target: 'mainSection',
    points: ['Links to the reviews below', 'No JavaScript', 'Matches your theme’s colours'],
  },
  {
    id: 'review-snippet',
    name: 'Review Snippet',
    description:
      'A short quote from a real review, placed next to the Add to cart button where hesitation happens.',
    handle: 'review-snippet',
    kind: 'block',
    where: "On a product page, next to the Add to cart button",
    target: 'mainSection',
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
    where: "On your home page or any landing page — a scrollable row",
    target: 'newAppsSection',
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
    where: "On your home page or an About page — a quiet quote strip",
    target: 'newAppsSection',
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
    where: "Anywhere small: a header, a footer, or beside a hero",
    target: 'newAppsSection',
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
    where: "On a page template of its own — a browsable grid",
    target: 'newAppsSection',
    points: ['Add to any page template', 'Reflows to the space your theme gives it', 'Store rating at the top'],
  },
  {
    id: 'auto-embed',
    name: 'Automatic placement',
    description:
      'One toggle, every product. Puts the rating under your product title and the reviews below the product — no placement step, and it works on themes that do not accept app blocks.',
    handle: 'reviews-embed',
    kind: 'embed',
    where: "On every product page at once, with nothing to place",
    target: 'newAppsSection',
    points: [
      'Works on any theme',
      'Nothing to position by hand',
      'Turns itself off where you placed a block yourself',
    ],
  },
];

export interface DeepLinkOptions {
  /** Numeric theme id. Omitted means the published theme. */
  themeId?: string;
  /** Template key, e.g. `product` or `page.faq`. Omitted uses the widget's own. */
  template?: string;
  /** Omitted defaults to `newAppsSection`, the one that cannot be refused. */
  target?: DeepLinkTarget;
}

/**
 * Deep link into the theme editor with this widget ready to place.
 *
 * The two kinds take different parameters — an app block is ADDED to a
 * template, an app embed is ACTIVATED in theme settings — and using the wrong
 * one opens the editor with nothing selected, which reads as a broken button.
 *
 * `target=newAppsSection` rather than `mainSection`. Every JSON template in a
 * Theme Store theme is required to accept app blocks in its Apps section,
 * which makes this the one target that cannot be refused; `mainSection` needs
 * the theme's own product section to declare `{"type": "@app"}`, and when it
 * does not the editor adds nothing and says "There is a problem with the app
 * block. Contact the app developer." The merchant drags it where they want it
 * from there, which the dialog tells them to do.
 *
 * `themes/current` when no theme is named: resolving the published theme costs
 * an API call and goes stale the moment a merchant publishes another one.
 */
export function themeEditorUrl(
  shopDomain: string,
  widget: WidgetDef,
  opts: DeepLinkOptions = {},
): string {
  const store = shopDomain.replace(/\.myshopify\.com$/, '');
  const theme = opts.themeId ? encodeURIComponent(opts.themeId) : 'current';
  const base = `https://admin.shopify.com/store/${store}/themes/${theme}/editor`;

  // Written out rather than built with URLSearchParams, which percent-encodes
  // the separator in `{id}/{handle}` to %2F. Every documented example carries a
  // literal slash, and lib/theme-block.ts records that the encoded form fails
  // to resolve. Nothing here is user input — the id is a module constant and
  // the handle comes from the table above — so there is no injection surface
  // that encoding would be protecting.
  const ref = `${DEEP_LINK_APP_ID}/${widget.handle}`;

  if (widget.kind === 'embed') {
    return `${base}?context=apps&activateAppId=${ref}`;
  }

  // The template key is the one value that reaches here from outside, picked
  // from the theme's own file list. Encoded because a template name is not
  // ours to vouch for.
  const template = encodeURIComponent(opts.template ?? widget.template ?? 'product');
  return `${base}?template=${template}&addAppBlockId=${ref}&target=${opts.target ?? widget.target}`;
}
