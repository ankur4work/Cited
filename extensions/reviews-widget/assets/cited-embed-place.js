/*
 * Positions the app-embed copy of the reviews block.
 *
 * Shopify injects app embeds at the end of <body>, after the footer, and
 * offers no way to say otherwise. This moves the block to where reviews
 * belong: immediately after the product's main content.
 *
 * What this script does NOT do is fetch, render or hydrate anything. The
 * reviews, the ratings and the JSON-LD are already in the server's HTML
 * before it runs — that is the whole SEO and AI-visibility claim, and it does
 * not depend on this file executing. If it fails, or scripting is off, the
 * reviews are still on the page and still readable; they just sit lower down.
 *
 * The app block path does not load this at all.
 */
(function () {
  'use strict';

  var embed = document.querySelector('[data-cited-embed]');
  if (!embed) return;

  /*
   * If the merchant has ALSO placed the app block, this copy is a duplicate.
   * Remove it rather than render reviews twice — a widget appearing twice on
   * a product page is the most common complaint levelled at review apps, and
   * shipping it ourselves while citing it as a competitor weakness would be
   * indefensible.
   */
  var placed = document.querySelector('[data-cited-product]:not([data-cited-embed])');
  if (placed) {
    embed.remove();
    return;
  }

  /*
   * Merchant override first, then a list of anchors ordered from most to
   * least specific. Dawn and most OS 2.0 themes match one of these; the
   * generic fallbacks catch the rest.
   */
  var candidates = [];
  var override = embed.getAttribute('data-cited-anchor');
  if (override) candidates.push(override);

  candidates.push(
    '.product__info-wrapper',
    '.product-single__meta',
    '.product__info-container',
    'product-info',
    '.product-form__buttons',
    '.shopify-payment-button',
    'main .product',
    '#MainContent .product',
    'main',
    '#MainContent'
  );

  var anchor = null;
  for (var i = 0; i < candidates.length; i++) {
    try {
      anchor = document.querySelector(candidates[i]);
    } catch (e) {
      // A merchant-supplied selector can be invalid. Skip it rather than
      // throwing and leaving the block stranded at the end of the document.
      anchor = null;
    }
    if (anchor) break;
  }

  if (!anchor) return;

  /*
   * Insert after the anchor's outermost section rather than beside a nested
   * element, so the reviews land between the product and whatever follows it
   * instead of inside the buy-button column.
   */
  var target = anchor.closest('section, .shopify-section') || anchor;
  if (target.parentNode) {
    target.parentNode.insertBefore(embed, target.nextSibling);
  }
})();
