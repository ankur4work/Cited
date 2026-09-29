/*
 * Puts each Cited widget where the app says it goes, and keeps exactly one of
 * it on the page.
 *
 * Two problems, one script.
 *
 * POSITION. Shopify appends a newly added app block to the END of its section,
 * so a widget added from our own "Add widget" button lands under the spec
 * table, above Related products — nowhere near the place the app's own gallery
 * describes ("in the buy column, under the product title", "next to the Add to
 * cart button"). A merchant who cannot see the thing they just added presses
 * the button again, which is how stores end up with two.
 *
 * COUNT. The same widget twice on one page is never what anyone wanted: the
 * page reads "5.0 ★★★★★ 1 review 5.0 ★★★★★ 1 review" and looks broken. The
 * first one wins.
 *
 * Only widgets that OPT IN are touched, via `data-cited-snap`. A merchant who
 * turns the setting off and drags the block exactly where they want it keeps
 * it there — and dragging remains the better answer, because it costs nothing
 * at runtime and survives with scripting off.
 *
 * Nothing here fetches or renders. Every rating, quote and review is already
 * in the server's HTML — which is the entire SEO and AI-visibility claim — so
 * if this file never runs, the widgets are still on the page and still
 * readable. They are just in the wrong order.
 */
(function () {
  'use strict';

  var widgets = document.querySelectorAll('[data-cited-widget]');
  if (!widgets.length) return;

  /* ── 1. One of each kind ──────────────────────────────────────────────
   *
   * Deliberately scoped to what `data-cited-widget` marks, which is the
   * product-page set. A home page with two review carousels in two different
   * sections is a layout decision, not a mistake, and this must not delete
   * someone's content to enforce a rule they never asked for.
   */
  var kept = [];
  var seen = {};

  for (var i = 0; i < widgets.length; i++) {
    var node = widgets[i];
    var kind = node.getAttribute('data-cited-widget');

    if (seen[kind]) {
      if (node.parentNode) node.parentNode.removeChild(node);
      continue;
    }

    seen[kind] = true;
    kept.push(node);
  }

  /* ── 2. Where each one belongs ───────────────────────────────────────── */

  function visible(el) {
    if (!el) return false;
    if (!el.offsetParent) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function buyForm() {
    return document.querySelector('form[action*="/cart/add"]');
  }

  /*
   * The buy form is the one landmark every product page has, whatever the
   * theme calls its classes, and it breaks ties: a page may carry several
   * things that look like the title — a breadcrumb, a sticky add-to-cart bar,
   * a quick view inside a related-products carousel — and the one that matters
   * is in the same column as the thing you buy with.
   */
  function nearBuyForm(el) {
    var form = buyForm();
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
   * element puts the widget nowhere at all.
   *
   * Finding the title by CLASS cannot be made reliable — every theme names it
   * differently and a custom theme names it something nobody has seen — so the
   * exact title text, which the server knows, is the fallback that works
   * anywhere, including on a theme written yesterday.
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
     * where the widget measures 0x0 and nobody ever sees it.
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

  /*
   * Anchors, and which side of them the widget sits.
   *
   * `cart` goes BEFORE the form rather than inside it. Inserting into a
   * theme's buy form puts our markup in the middle of something the theme's
   * own script reads, re-renders on variant change, and sometimes serialises —
   * a quote sitting between the variant picker and the submit button is a
   * support ticket waiting to happen.
   */
  var ANCHORS = {
    title: function (wanted) {
      var el = findTitle(wanted);
      return el ? { el: el, where: 'after' } : null;
    },
    cart: function () {
      var form = buyForm();
      if (form && visible(form)) return { el: form, where: 'before' };
      // A product with no buy form (sold out, or a theme that renders the
      // button by script) still has a title to sit under.
      var el = findTitle('');
      return el ? { el: el, where: 'after' } : null;
    }
  };

  for (var k = 0; k < kept.length; k++) {
    (function (widget) {
      var snap = widget.getAttribute('data-cited-snap');
      if (!snap || !ANCHORS[snap]) return;

      var wanted = (widget.getAttribute('data-cited-title') || '').trim();
      var anchoredTo = null;
      var anchoredWhere = null;

      /*
       * The cheap check, run on every DOM mutation on the page: still
       * attached, still beside the anchor we chose, anchor still in the
       * document. Three pointer comparisons and no DOM query — which is what
       * makes a permanent observer affordable.
       */
      function wellPlaced() {
        if (!widget.isConnected || !anchoredTo || !anchoredTo.isConnected) return false;
        return anchoredWhere === 'before'
          ? anchoredTo.previousSibling === widget
          : anchoredTo.nextSibling === widget;
      }

      function place() {
        if (wellPlaced()) return;

        var target = ANCHORS[snap](wanted);
        if (!target || !target.el || !target.el.parentNode) return;
        // Never insert a widget into its own subtree.
        if (widget.contains(target.el)) return;

        target.el.parentNode.insertBefore(
          widget,
          target.where === 'before' ? target.el : target.el.nextSibling,
        );

        anchoredTo = target.el;
        anchoredWhere = target.where;
      }

      place();

      /*
       * Themes re-render the product column — a `<product-info>` element that
       * upgrades, a variant change, a section rendered by the Section
       * Rendering API. Each replaces the anchor and strands anything a script
       * put beside it, so this watches rather than placing once. A ten-second
       * window was tried and is useless: the re-render that matters most is a
       * variant change, which happens whenever the shopper clicks.
       *
       * The correction cap stops a theme that re-places the widget itself from
       * turning this into a fight that burns a core.
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
              /* Presentation only — the widget is in the HTML regardless. */
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
    })(kept[k]);
  }
})();
