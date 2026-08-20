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
        : '');
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
        setStatus(status, '');
        form.removeAttribute('data-cited-form');
        form.submit();
      });
  });
})();
