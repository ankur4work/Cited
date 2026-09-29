/*
 * Moves an app block under the product title.
 *
 * The Star Rating block renders exactly where the merchant dropped it in the
 * theme editor, and that is usually not where they meant: Shopify appends a
 * newly added app block to the END of the section, so a rating added from our
 * own "Add widget" button lands under the spec table, above Related products,
 * a screen and a half below the title it is meant to sit under. Our app
 * describes this widget as "in the buy column, under the product title", so
 * the default has to actually do that.
 *
 * Dragging the block up in the theme editor does the same job permanently and
 * costs nothing at runtime, which is why this is a setting the merchant can
 * turn off — a merchant who deliberately placed the rating beside Add to cart
 * should keep it there.
 *
 * Nothing here fetches or renders. The rating is already in the server's HTML
 * and is readable by Google and by AI shopping assistants whether or not this
 * file runs; if it fails, the rating is still on the page, just lower down.
 */
(function () {
  'use strict';

  var snaps = document.querySelectorAll('[data-cited-snap-title]');
  if (!snaps.length) return;

  /*
   * One rating under the title, however many blocks ask to be there.
   *
   * A merchant who presses "Add widget" twice — or who added the rating months
   * ago and adds it again from the app because they cannot see the first one
   * (it was at the bottom of the section, which is where Shopify puts a new
   * block) — ends up with two Star Rating blocks in the theme. They were far
   * apart and easy to miss until these started moving themselves to the same
   * spot, and then the page reads "5.0 ★★★★★ 1 review 5.0 ★★★★★ 1 review".
   *
   * Every block carrying this attribute has asked for the same destination, so
   * a second one is a duplicate by construction and the extras go. Only the
   * ones that opted into snapping: a rating the merchant deliberately placed
   * beside Add to cart has `snap_to_title` off, carries no attribute, and is
   * never touched here.
   *
   * This hides a misconfiguration rather than curing it — the real fix is
   * deleting the spare block in the theme editor — but a merchant should not
   * have to know that to avoid a page that looks broken.
   */
  for (var extra = snaps.length - 1; extra >= 1; extra--) {
    var dupe = snaps[extra];
    if (dupe.parentNode) dupe.parentNode.removeChild(dupe);
  }
  snaps = [snaps[0]];

  function visible(el) {
    if (!el) return false;
    if (!el.offsetParent) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /*
   * The buy form is the one landmark every product page has, whatever the
   * theme calls its classes, and it is how ties are broken: a page may carry
   * several elements that look like the title — a breadcrumb, a sticky
   * add-to-cart bar, a quick view inside a related-products carousel — and
   * the one that matters is in the same column as the thing you buy with.
   */
  function nearBuyForm(el) {
    var form = document.querySelector('form[action*="/cart/add"]');
    if (!form || !el) return false;
    var node = el.parentElement;
    for (var depth = 0; node && depth < 6; depth++) {
      if (node.contains(form)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /*
   * Re-found on every attempt, never cached: a theme that re-renders its
   * product column replaces the title NODE, and inserting next to a detached
   * element puts the block nowhere at all.
   *
   * Finding the title by CLASS cannot be made reliable — every theme names it
   * differently and a custom theme names it something nobody has seen — so the
   * exact title text, which the server knows, is the fallback that works
   * anywhere.
   */
  function findTitle(wanted) {
    var candidates = [];
    var byClass = [
      '.product__title h1',
      '.product__title',
      '.product-single__title',
      '.product-title',
      '.product-meta__title',
      '[data-product-title]'
    ];

    for (var i = 0; i < byClass.length; i++) {
      var hit = null;
      try {
        hit = document.querySelectorAll(byClass[i]);
      } catch (e) {
        hit = null;
      }
      if (!hit) continue;
      for (var j = 0; j < hit.length; j++) candidates.push(hit[j]);
    }

    if (wanted) {
      var scope = document.querySelector('main, #MainContent') || document.body;
      var headings = scope.querySelectorAll('h1, h2');
      for (var h = 0; h < headings.length; h++) {
        if ((headings[h].textContent || '').trim() === wanted) candidates.push(headings[h]);
      }
    }

    var spares = document.querySelectorAll('main h1, #MainContent h1, h1');
    for (var s = 0; s < spares.length; s++) candidates.push(spares[s]);

    /*
     * Responsive themes ship the title TWICE, once for mobile and once for
     * desktop, hiding whichever does not apply. Taking the first in document
     * order has a coin flip's chance of landing in the `display: none` copy,
     * where the block measures 0x0 and nobody ever sees it.
     */
    var visibleHit = null;
    for (var c = 0; c < candidates.length; c++) {
      var el = candidates[c];
      if (!el || !el.parentNode) continue;
      if (visible(el)) {
        if (nearBuyForm(el)) return el;
        if (!visibleHit) visibleHit = el;
      }
    }
    return visibleHit || null;
  }

  for (var n = 0; n < snaps.length; n++) {
    (function (block) {
      var wanted = (block.getAttribute('data-cited-snap-title') || '').trim();
      var anchoredTo = null;

      function wellPlaced() {
        return (
          block.isConnected &&
          anchoredTo &&
          anchoredTo.isConnected &&
          anchoredTo.nextSibling === block
        );
      }

      function place() {
        if (wellPlaced()) return;

        var title = findTitle(wanted);
        if (!title || !title.parentNode) return;
        // Never insert a block into its own subtree.
        if (block.contains(title)) return;

        if (title.nextSibling !== block) {
          title.parentNode.insertBefore(block, title.nextSibling);
        }
        anchoredTo = title;
      }

      place();

      /*
       * Themes re-render the product column — a `<product-info>` element that
       * upgrades, a variant picker swapping markup, a section rendered by the
       * Section Rendering API. Each replaces the title and strands anything a
       * script put beside it, so this watches rather than placing once.
       *
       * Affordable because the work per mutation batch is `wellPlaced()`:
       * three pointer comparisons and no DOM query. The correction cap stops
       * a theme that re-places the block itself from turning this into a
       * fight that burns a core.
       */
      if (typeof MutationObserver === 'function') {
        var queued = false;
        var corrections = 0;

        var observer = new MutationObserver(function () {
          if (queued) return;
          queued = true;

          requestAnimationFrame(function () {
            queued = false;
            if (wellPlaced()) return;
            try {
              place();
            } catch (e) {
              /* Presentation only — the rating is in the HTML regardless. */
            }
            if (++corrections > 50) observer.disconnect();
          });
        });

        observer.observe(document.body, { childList: true, subtree: true });
        window.addEventListener('load', function () {
          try {
            place();
          } catch (e) {
            /* as above */
          }
        });
      }
    })(snaps[n]);
  }
})();
