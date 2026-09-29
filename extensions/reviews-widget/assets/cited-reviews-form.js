/*
 * Submits the review without a page reload, and shows it immediately.
 *
 * This is an enhancement, not the mechanism. The form is a real <form> with a
 * real action, and with scripting off it posts normally and the app proxy
 * answers with a page rendered inside the merchant's theme. Everything here
 * only removes the round trip.
 *
 * Why the new review is rendered from the response rather than re-fetched:
 * the block reads reviews from a product metafield that syndication updates a
 * moment later, so an immediate reload would show the shopper the same page
 * they just submitted from and look like nothing happened.
 */
(function () {
  'use strict';

  var STAR =
    'M10 1.6l2.6 5.2 5.8.85-4.2 4.1 1 5.75L10 14.8l-5.2 2.7 1-5.75L1.6 7.65l5.8-.85z';

  function stars(rating, size) {
    var html = '<span class="cited-stars" role="img" aria-label="' + rating + ' out of 5 stars">';
    for (var i = 1; i <= 5; i++) {
      html +=
        '<svg class="cited-stars__star' +
        (i <= rating ? ' cited-stars__star--on' : '') +
        '" viewBox="0 0 20 20" width="' + size + '" height="' + size + '" aria-hidden="true">' +
        '<path fill="currentColor" d="' + STAR + '"/></svg>';
    }
    return html + '</span>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function photosHtml(photos) {
    if (!photos || !photos.length) return '';
    var html = '<div class="cited-review__media">';
    for (var i = 0; i < photos.length && i < 4; i++) {
      // Shopify CDN URLs only — the server produced these, not the page.
      html +=
        '<img class="cited-review__media-item" src="' + escapeHtml(photos[i]) +
        '" alt="Customer review photo" loading="lazy" decoding="async" width="88" height="88">';
    }
    return html + '</div>';
  }

  function renderReview(review) {
    var name = review.author || 'Anonymous';
    var li = document.createElement('li');
    li.className = 'cited-review';
    li.innerHTML =
      '<div class="cited-review__head">' + stars(review.rating, 15) + '</div>' +
      '<div class="cited-review__meta">' +
      '<span class="cited-review__avatar" aria-hidden="true">' +
      escapeHtml(name.charAt(0).toUpperCase()) +
      '</span><span class="cited-review__author">' + escapeHtml(name) + '</span>' +
      (review.verified
        ? '<span class="cited-review__verified">Verified purchase</span>'
        : '') +
      '</div>' +
      (review.body
        ? '<div class="cited-review__body">' + escapeHtml(review.body) + '</div>'
        : '') +
      photosHtml(review.photos);
    return li;
  }

  function setStatus(el, message, tone) {
    if (!el) return;
    el.textContent = message;
    if (tone) el.setAttribute('data-tone', tone);
    else el.removeAttribute('data-tone');
  }

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.hasAttribute || !form.hasAttribute('data-cited-form')) return;

    event.preventDefault();

    var section = form.closest('.cited-reviews');
    var status = form.querySelector('[data-cited-status]');
    var button = form.querySelector('button[type="submit"]');

    /*
     * No rating, no round trip.
     *
     * `required` on the radio group is supposed to make this unreachable, and
     * on most themes it does. It is not reliable enough to lean on: a theme
     * whose own CSS hides radios stops the browser being able to focus the
     * invalid control, and browsers disagree about what to do then — some
     * block the submit silently, some submit anyway. A merchant reported
     * exactly that, and the result was a full-page server error reading
     * "Choose a rating" for someone who was looking at the stars.
     *
     * Caught here, the answer appears beside the form with everything they
     * typed still in it.
     */
    if (!form.querySelector('input[name="rating"]:checked')) {
      setStatus(status, 'Please choose a star rating.', 'error');
      var stars = form.querySelector('.cited-rate__stars');
      if (stars && stars.scrollIntoView) stars.scrollIntoView({ block: 'center' });
      var firstStar = form.querySelector('.cited-rate__input');
      if (firstStar && firstStar.focus) firstStar.focus();
      return;
    }

    setStatus(status, 'Sending…');
    if (button) button.disabled = true;

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          // The server's message is the useful one — it distinguishes "you
          // already reviewed this" from a validation problem.
          setStatus(status, result.data.error || 'Your review could not be saved.', 'error');
          if (button) button.disabled = false;
          return;
        }

        setStatus(status, result.data.message || 'Thanks for your review.', 'ok');
        form.reset();

        if (!result.data.review || !section) return;

        var list = section.querySelector('.cited-reviews__list');
        if (!list) {
          // First review on this product: the empty state is what is on the
          // page, so replace it with a list rather than appending to nothing.
          var empty = section.querySelector('.cited-reviews__empty');
          list = document.createElement('ol');
          list.className = 'cited-reviews__list';
          list.setAttribute('role', 'list');
          if (empty && empty.parentNode) empty.parentNode.replaceChild(list, empty);
          else section.insertBefore(list, section.querySelector('.cited-reviews__form-wrap'));
        }
        list.insertBefore(renderReview(result.data.review), list.firstChild);
      })
      .catch(function () {
        // Network failure, or the proxy is unreachable. Fall back to a normal
        // submit rather than losing what they wrote.
        //
        // `form.submit()` and not `requestSubmit()` on purpose — but note what
        // that costs: submit() runs NO constraint validation and fires no
        // submit event, so anything the guard above would have caught goes
        // straight to the server and comes back as a full page. The guard
        // above is what makes that acceptable: by here, a rating exists.
        setStatus(status, '');
        form.removeAttribute('data-cited-form');
        form.submit();
      });
  });

  /*
   * ── Make a click on a star set the rating ──
   *
   * The strip is a radio group with each label drawn as a star, and an
   * invisible input laid over each one so the browser has something focusable
   * to validate. Clicking the star is therefore supposed to work twice over:
   * the click lands on the input, and failing that the label forwards it.
   *
   * Both of those depend on the theme not interfering, and a theme absolutely
   * can interfere — `pointer-events`, a stacking context, or its own
   * `input[type="radio"] { display: none }` are all common and all break one
   * or both. The symptom is the worst kind: the shopper clicks a star, the
   * star lights up under the cursor because that is pure CSS hover, and
   * nothing is actually selected. They then get told to pick a rating they
   * are certain they picked.
   *
   * So set it explicitly. Capture phase, because a theme that stops
   * propagation on click inside its product form would otherwise take this
   * with it. Additive as ever: with scripting off the label and the overlay
   * are unchanged, and this only ever agrees with what they would have done.
   */
  document.addEventListener(
    'click',
    function (event) {
      var node = event.target;
      if (!node || !node.closest) return;

      var label = node.closest('.cited-rate__label');
      if (!label) return;

      var id = label.getAttribute('for');
      var input = id ? document.getElementById(id) : null;
      if (!input || input.checked) return;

      input.checked = true;
      // Themes and our own code listen for change, never for the click.
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    true
  );
})();

/*
 * Show what has been picked for upload.
 *
 * The photo and video inputs are real <input type="file"> elements hidden
 * under a styled tile, so choosing a file changed nothing visible — no name,
 * no count, no thumbnail. A shopper had no way to tell an upload that worked
 * from one that silently did not, and the only way to check was to submit.
 *
 * Purely additive: with scripting off, the native control and its own "2
 * files selected" text are what the browser shows. Nothing here is required
 * for the form to submit.
 */
(function () {
  'use strict';

  var MAX_NAME = 28;

  function short(name) {
    if (name.length <= MAX_NAME) return name;
    // Keep the extension — "holiday-photo-2026…jpg" is readable, a bare
    // truncation to "holiday-photo-2026…" is not.
    var dot = name.lastIndexOf('.');
    var ext = dot > -1 ? name.slice(dot) : '';
    return name.slice(0, MAX_NAME - ext.length - 1) + '…' + ext;
  }

  function chip(file) {
    var li = document.createElement('li');
    li.className = 'cited-upload__chip';

    // A thumbnail for images, because recognising the picture is the whole
    // point of the confirmation. Object URLs are revoked once drawn.
    if (file.type.indexOf('image/') === 0 && window.URL && window.URL.createObjectURL) {
      var img = document.createElement('img');
      img.className = 'cited-upload__thumb';
      img.alt = '';
      img.src = window.URL.createObjectURL(file);
      img.onload = function () { window.URL.revokeObjectURL(img.src); };
      li.appendChild(img);
    }

    var name = document.createElement('span');
    name.className = 'cited-upload__name';
    name.textContent = short(file.name);
    li.appendChild(name);
    return li;
  }

  function wire(input) {
    var wrap = input.closest ? input.closest('.cited-upload') : null;
    if (!wrap) return;

    var list = document.createElement('ul');
    list.className = 'cited-upload__chosen';
    // Announced, so a screen reader hears the file was accepted rather than
    // being told nothing at all.
    list.setAttribute('aria-live', 'polite');
    wrap.appendChild(list);

    input.addEventListener('change', function () {
      list.textContent = '';
      var files = input.files;
      if (!files) return;
      for (var i = 0; i < files.length; i++) list.appendChild(chip(files[i]));
    });
  }

  var inputs = document.querySelectorAll('.cited-reviews .cited-upload__input');
  for (var i = 0; i < inputs.length; i++) wire(inputs[i]);
})();
