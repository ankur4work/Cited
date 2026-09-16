import { describe, expect, it, vi } from 'vitest';
import type { ReviewRequestInput } from './review-request';

vi.mock('@/lib/env', () => ({ env: { COMPANY_ADDRESS: 'Cited · Bangalore, India' } }));

const { renderReviewRequest } = await import('./review-request');

function input(over: Partial<ReviewRequestInput> = {}): ReviewRequestInput {
  return {
    shopDomain: 'acme.myshopify.com',
    shopName: 'Acme',
    customerName: 'Priya',
    products: [{ title: 'Merino Overshirt', handle: 'merino-overshirt', imageUrl: null }],
    unsubscribeToken: 'store_1.hash.sig',
    isReminder: false,
    ...over,
  };
}

describe('renderReviewRequest', () => {
  it('always ships a plain-text alternative', () => {
    // An HTML-only message is a strong spam signal and unreadable in
    // text-only clients.
    const out = renderReviewRequest(input());
    expect(out.text.length).toBeGreaterThan(0);
    expect(out.text).toContain('Merino Overshirt');
  });

  it('links to the merchant domain, never to ours', () => {
    // A link to our host inside an email branded as the store reads as
    // phishing, and gets reported rather than clicked.
    const out = renderReviewRequest(input());
    expect(out.html).toContain('https://acme.myshopify.com/products/merino-overshirt');
    expect(out.html).not.toContain('cited.solnix.store');
    expect(out.text).toContain('https://acme.myshopify.com/products/');
  });

  it('includes a working unsubscribe link in both parts', () => {
    const out = renderReviewRequest(input());
    expect(out.html).toContain('/apps/cited/unsubscribe?t=');
    expect(out.text).toContain('/apps/cited/unsubscribe?t=');
  });

  it('escapes shop and product names', () => {
    // Both are merchant-controlled and reach the HTML body.
    const out = renderReviewRequest(
      input({
        shopName: '<script>alert(1)</script>',
        products: [{ title: 'Bolt & "Nut"', handle: 'bolt', imageUrl: null }],
      }),
    );
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('Bolt &amp; &quot;Nut&quot;');
  });

  it('percent-encodes a handle so it cannot break out of the URL', () => {
    const out = renderReviewRequest(
      input({ products: [{ title: 'Odd', handle: 'a b&c', imageUrl: null }] }),
    );
    expect(out.html).toContain('/products/a%20b%26c');
  });

  it('does not double the full stop after a shop name ending in one', () => {
    // "Acme Supply Co." and "Something Ltd." are ordinary shop names, and
    // interpolating one before a full stop puts a typo in the first line of an
    // email sent on the merchant's behalf.
    const out = renderReviewRequest(input({ shopName: 'Acme Supply Co.' }));
    expect(out.text).toContain('Thanks for shopping with Acme Supply Co.');
    expect(out.text).not.toContain('Co..');
    expect(out.html).not.toContain('Co..');
    expect(out.text).not.toContain('Sent by Acme Supply Co..');
  });

  it('greets without a name when there is none', () => {
    const out = renderReviewRequest(input({ customerName: null }));
    expect(out.text.startsWith('Hi,')).toBe(true);
  });

  it('names the product in the subject for a single-item order', () => {
    expect(renderReviewRequest(input()).subject).toContain('Merino Overshirt');
  });

  it('falls back to the shop name for a multi-item order', () => {
    const out = renderReviewRequest(
      input({
        products: [
          { title: 'A', handle: 'a', imageUrl: null },
          { title: 'B', handle: 'b', imageUrl: null },
        ],
      }),
    );
    expect(out.subject).toContain('Acme');
  });

  it('uses different wording for a reminder', () => {
    const first = renderReviewRequest(input()).subject;
    const again = renderReviewRequest(input({ isReminder: true })).subject;
    expect(again).not.toBe(first);
  });

  it('includes the postal address required for bulk mail', () => {
    const out = renderReviewRequest(input());
    expect(out.text).toContain('Bangalore');
    expect(out.html).toContain('Bangalore');
  });
});
