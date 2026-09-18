/*
 * Positions the app-embed copy of the reviews block.
 *
 * Shopify injects app embeds at the end of <body>, after the footer, and
 * offers no way to say otherwise. This moves two things:
 *
 *   1. the rating summary   → directly under the product title
 *   2. the rest of the block → after the product's main content
 *
 * What this script does NOT do is fetch, render or hydrate anything. The
 * reviews, the ratings and the JSON-LD are already in the server's HTML
 * before it runs — that is the whole SEO and AI-visibility claim, and it does
 * not depend on this file executing. If it fails, or scripting is off, the
 * reviews are still on the page and still readable; they just sit lower down.
 *
 * The app block path does not load this at all: there the merchant chose the
 * position themselves, and overriding that would be rude.
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

  function first(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var found = null;
      try {
        found = document.querySelector(selectors[i]);
      } catch (e) {
        // A merchant-supplied selector can be invalid. Skip it rather than
        // throwing and leaving the block stranded at the end of the document.
        found = null;
      }
      if (found) return found;
    }
    return null;
  }

  /* ── 1. The rating summary, under the product title ────────────────
   *
   * Finding the title by CLASS cannot be made reliable: every theme names it
   * differently, and a custom theme names it something nobody has seen. But
   * the server knows the product's exact title, so the element can be found by
   * its text instead — which works on any theme, including one written
   * yesterday, without maintaining a list of selectors.
   *
   * Class selectors are still tried first, because they are cheaper and
   * unambiguous on the themes that do use them; the text match is what makes
   * this work everywhere else.
   */
  var summary = embed.querySelector('[data-cited-summary]');
  var title = null;

  if (summary) {
    var wanted = (embed.getAttribute('data-cited-title') || '').trim();

    title = first([
      '.product__title h1',
      '.product__title',
      '.product-single__title',
      '.product-title',
      '.product-meta__title',
      '[data-product-title]'
    ]);

    if (!title && wanted) {
      var scope = document.querySelector('main, #MainContent') || document.body;
      var headings = scope.querySelectorAll('h1, h2');
      for (var h = 0; h < headings.length; h++) {
        if ((headings[h].textContent || '').trim() === wanted) {
          title = headings[h];
          break;
        }
      }
    }

    // Last resort: the first h1 in the main content. On a product page that is
    // the product title in every theme that is not actively misusing h1.
    if (!title) title = first(['main h1', '#MainContent h1', 'h1']);

    if (title && title.parentNode) {
      // After the title's own element, not after its wrapper: the wrapper
      // frequently contains the price and the buy button too, and inserting
      // after it would put the rating below the add-to-cart.
      title.parentNode.insertBefore(summary, title.nextSibling);
      summary.classList.add('cited-rating--placed');
    }
    // If no title was found the summary simply stays inside the block, which
    // is where it renders without this script at all.
  }

  /* ── 2. The rest of the block, after the product section ───────────── */
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

  var anchor = first(candidates);
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
