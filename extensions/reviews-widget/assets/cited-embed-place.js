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

  /*
   * Does this element actually render?
   *
   * Responsive themes very commonly ship the product title TWICE — once in a
   * mobile header and once in a desktop one — and hide whichever does not
   * apply. Taking the first match in document order therefore had a coin
   * flip's chance of inserting the rating into the copy that is
   * `display: none`, where it measured 0×0 and nobody ever saw it. On the
   * store this was built against, that is exactly what happened: the stars
   * went into `header.mobile-only` and were invisible on every desktop.
   *
   * `offsetParent` is null for a hidden element and for its descendants, which
   * is the cheap check; the rect guards against an element that is technically
   * laid out but collapsed to nothing.
   */
  function visible(el) {
    if (!el) return false;
    if (!el.offsetParent) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /*
   * First VISIBLE match, falling back to the first match of any kind.
   *
   * The fallback matters: this script runs at `defer`, and a theme that reveals
   * the product area with script of its own may not have done so yet. Placing
   * the block beside a not-yet-visible title is still better than abandoning
   * it after the footer.
   */
  function first(selectors) {
    var fallback = null;

    for (var i = 0; i < selectors.length; i++) {
      var matches = null;
      try {
        matches = document.querySelectorAll(selectors[i]);
      } catch (e) {
        // A merchant-supplied selector can be invalid. Skip it rather than
        // throwing and leaving the block stranded at the end of the document.
        matches = null;
      }
      if (!matches) continue;

      for (var j = 0; j < matches.length; j++) {
        if (visible(matches[j])) return matches[j];
        if (!fallback) fallback = matches[j];
      }
    }

    return fallback;
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
  var wanted = (embed.getAttribute('data-cited-title') || '').trim();

  /*
   * The buy form is the one landmark every product page has, whatever the
   * theme calls its classes. It is used to break ties: a theme may carry
   * several elements that look like the title — a breadcrumb, a sticky
   * add-to-cart bar, a quick-view in a related-products carousel — and the
   * one that matters is the one in the same column as the thing you buy with.
   */
  function buyForm() {
    return document.querySelector('form[action*="/cart/add"]');
  }

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
   * Re-found on every attempt rather than cached.
   *
   * A theme that re-renders its product column replaces the title NODE, so a
   * reference taken at defer time points at detached markup a second later —
   * and inserting next to a detached element puts the rating nowhere at all.
   */
  function findTitle() {
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

    /*
     * By text, because finding the title by CLASS cannot be made reliable:
     * every theme names it differently and a custom theme names it something
     * nobody has seen. The server knows the product's exact title, so the
     * element can be found by what it says instead.
     */
    if (wanted) {
      var scope = document.querySelector('main, #MainContent') || document.body;
      var headings = scope.querySelectorAll('h1, h2');
      for (var h = 0; h < headings.length; h++) {
        if ((headings[h].textContent || '').trim() === wanted) candidates.push(headings[h]);
      }
    }

    // Last resort. On a product page the first h1 in main is the title in
    // every theme that is not actively misusing h1.
    var spares = document.querySelectorAll('main h1, #MainContent h1, h1');
    for (var s = 0; s < spares.length; s++) candidates.push(spares[s]);

    /*
     * Best match wins, in this order, and the order is the whole point:
     *
     *   visible AND beside the buy form  — the product title, certainly
     *   visible                          — a title, probably the right one
     *   anything                         — better than abandoning it after
     *                                      the footer
     *
     * Responsive themes ship the title TWICE, once in a mobile header and
     * once in a desktop one, hiding whichever does not apply. Taking the
     * first in document order had a coin flip's chance of inserting the
     * rating into the `display: none` copy, where it measured 0x0 and nobody
     * ever saw it.
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
    if (visibleHit) return visibleHit;

    for (var f = 0; f < candidates.length; f++) {
      if (candidates[f] && candidates[f].parentNode) return candidates[f];
    }
    return null;
  }

  var anchoredTo = null;

  /*
   * The cheap check, run on every DOM mutation on the page: is the rating
   * still attached, still after the title we put it after, and is that title
   * still in the document? Three pointer comparisons and no DOM query, which
   * is what makes a permanent observer affordable.
   */
  function wellPlaced() {
    return (
      summary.isConnected &&
      anchoredTo &&
      anchoredTo.isConnected &&
      anchoredTo.nextSibling === summary
    );
  }

  function placeSummary() {
    if (!summary) return true;
    if (wellPlaced()) return true;

    var title = findTitle();
    if (!title || !title.parentNode) return false;

    if (title.nextSibling !== summary) {
      // After the title's own element, not after its wrapper: the wrapper
      // frequently contains the price and the buy button too, and inserting
      // after it would put the rating below the add-to-cart.
      title.parentNode.insertBefore(summary, title.nextSibling);
      summary.classList.add('cited-rating--placed');
    }

    anchoredTo = title;
    return true;
  }

  placeSummary();

  /*
   * ── Stay there ────────────────────────────────────────────────────────
   *
   * Placing once, at defer time, assumes the product column it inserted into
   * is the one that will still be on screen a second later. Plenty of themes
   * break that assumption: a `<product-info>` custom element that upgrades
   * and re-renders, a variant picker that swaps the whole block on selection,
   * a section rendered by the Section Rendering API. Each of those replaces
   * the title, and the rating — which is OUR element, not part of the markup
   * the theme re-rendered — is left behind wherever the old column ended,
   * which on a long product page is far below the fold.
   *
   * So watch, and put it back.
   *
   * This observer does NOT expire. A ten-second window was the first attempt
   * and it is worthless: the re-render that matters most is a variant change,
   * which happens whenever the shopper clicks, minutes after load. Tested by
   * stranding the rating at the end of <body> and re-rendering the column out
   * from under it — with the timeout, both stayed broken.
   *
   * Affordable because the work per mutation batch is `wellPlaced()`: three
   * pointer comparisons, no DOM query. Only when that fails does anything
   * search the document. Mutations are coalesced to one rAF, and our own
   * insertion is a no-op on the next pass rather than a loop.
   */
  if (summary && typeof MutationObserver === 'function') {
    var queued = false;
    /*
     * A theme that re-places the rating itself on every mutation would fight
     * this forever and burn a core doing it. Fifty corrections is far beyond
     * any legitimate re-render — a page doing more than that has a conflict no
     * amount of insisting will win, and a rating in the wrong place is better
     * than a hot laptop.
     */
    var corrections = 0;

    var observer = new MutationObserver(function () {
      if (queued) return;
      queued = true;

      requestAnimationFrame(function () {
        queued = false;
        if (wellPlaced()) return;

        try {
          placeSummary();
        } catch (e) {
          /* Presentation only. The rating is in the server's HTML regardless. */
        }

        if (++corrections > 50) observer.disconnect();
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Worth a check even if nothing mutated in between: the theme finishing
    // its own scripts, and a section that waits for load before rendering.
    window.addEventListener('load', function () {
      try {
        placeSummary();
      } catch (e) {
        /* as above */
      }
    });
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

  /* ── 3. Take this theme's content width ─────────────────────────────
   *
   * Being inserted as a SIBLING of a section means the parent is the page
   * wrapper, which is full-bleed. There is no container here to inherit a
   * width from, so without this the block either runs the entire window or
   * falls back to a cap of ours that matches nothing on the page — which is
   * what made the reviews 740px wide, and offset, beside 1280px sections.
   *
   * Rather than maintaining a list of theme container class names, measure:
   * the width this theme uses for MOST of its sections IS this theme's content
   * measure. Sections that are deliberately full-bleed (a hero, a gallery) are
   * the minority and lose the vote. The block then centres on exactly the
   * edges the product information above it uses, on any theme, including one
   * written yesterday.
   *
   * Everything below is presentation only. If it throws, is blocked, or the
   * page has nothing to measure, the CSS fallback applies and the reviews are
   * still there — this cannot prevent them rendering.
   */
  function shell() {
    var parent = embed.parentNode;
    if (!parent || !parent.children) return null;

    var tally = {};
    var best = null;
    var bestCount = 0;

    for (var i = 0; i < parent.children.length; i++) {
      var el = parent.children[i];
      if (el === embed) continue;

      var w = Math.round(el.getBoundingClientRect().width);
      /*
       * Ignore the empty and the hidden. A theme leaves collapsed sections in
       * the markup at width 0, and a 200px floor keeps a stray sidebar or an
       * announcement bar from winning a vote about the page's measure.
       */
      if (w < 200) continue;

      tally[w] = (tally[w] || 0) + 1;
      /*
       * Ties go to the WIDER width. A tie means the theme has no clear measure,
       * and being too narrow is the visible failure — it reads as broken, where
       * slightly too wide just reads as a full-width section.
       */
      if (tally[w] > bestCount || (tally[w] === bestCount && w > best)) {
        best = w;
        bestCount = tally[w];
      }
    }

    return best;
  }

  function applyShell() {
    try {
      var w = shell();
      if (w) embed.style.setProperty('--cited-shell', w + 'px');
    } catch (e) {
      /* Presentation only — the reviews do not depend on it. */
    }
  }

  applyShell();

  /*
   * Re-measure on resize, because the value is a px snapshot of a width that is
   * itself responsive. Debounced: this runs on a storefront, and a measurement
   * per resize event is a measurement per frame while the window is dragged.
   */
  var pending;
  window.addEventListener(
    'resize',
    function () {
      clearTimeout(pending);
      pending = setTimeout(applyShell, 150);
    },
    { passive: true }
  );
})();
