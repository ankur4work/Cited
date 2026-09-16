import { env } from '@/lib/env';

/**
 * The review request email.
 *
 * Hand-written HTML rather than a rendered React tree. Email clients support a
 * subset of CSS from roughly 2005 — Outlook renders through Word — so the
 * useful abstraction layer is "table, inline styles, no external anything",
 * which a component library mostly hides rather than helps with. It also keeps
 * the worker free of a React render dependency.
 *
 * Design constraints that are not cosmetic:
 *  * Every link is absolute and points at the MERCHANT's domain via the app
 *    proxy. A link to our host would look like phishing next to their brand.
 *  * A plain-text alternative always ships. A text/html-only message is a
 *    strong spam signal and is unreadable in text-only clients.
 *  * The unsubscribe link is one click and never a login. Burying it is how a
 *    complaint becomes a spam report, which costs every merchant on the SES
 *    account, not just this one.
 */

export interface ReviewRequestProduct {
  title: string;
  handle: string;
  imageUrl: string | null;
}

export interface ReviewRequestInput {
  shopDomain: string;
  shopName: string;
  customerName: string | null;
  products: ReviewRequestProduct[];
  /** Opaque, single-purpose token. Never the customer's email. */
  unsubscribeToken: string;
  isReminder: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Shop name as it appears mid-sentence.
 *
 * Trailing punctuation is stripped because plenty of real shops are called
 * "Acme Supply Co." or "Something Ltd.", and interpolating that before a full
 * stop produces "Thanks for shopping with Acme Supply Co.." — a typo in the
 * first line of an email sent on the merchant's behalf.
 */
function inSentence(name: string): string {
  return name.trim().replace(/[.\s]+$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Absolute URL on the merchant's own domain, through the app proxy. */
function productUrl(shopDomain: string, handle: string): string {
  return `https://${shopDomain}/products/${encodeURIComponent(handle)}#cited-reviews`;
}

function unsubscribeUrl(shopDomain: string, token: string): string {
  return `https://${shopDomain}/apps/cited/unsubscribe?t=${encodeURIComponent(token)}`;
}

export function renderReviewRequest(input: ReviewRequestInput): RenderedEmail {
  const { shopDomain, shopName, customerName, products, unsubscribeToken, isReminder } = input;

  const first = products[0];
  const greeting = customerName ? `Hi ${customerName},` : 'Hi,';

  const subject = isReminder
    ? `A quick thought on your ${first ? first.title : 'order'}?`
    : products.length === 1 && first
      ? `How is your ${first.title}?`
      : `How was your order from ${shopName}?`;

  const sentenceName = inSentence(shopName);

  const intro = isReminder
    ? `We asked a little while back — if you have a minute, other shoppers would find your take genuinely useful.`
    : `Thanks for shopping with ${escapeHtml(sentenceName)}. If you have a moment, how did it work out?`;

  const rows = products
    .map((p) => {
      const url = productUrl(shopDomain, p.handle);
      const image = p.imageUrl
        ? `<td width="64" style="padding:0 12px 0 0;"><img src="${escapeHtml(p.imageUrl)}" width="64" height="64" alt="" style="display:block;border-radius:6px;object-fit:cover;"></td>`
        : '';
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              ${image}
              <td style="vertical-align:middle;">
                <div style="font-size:15px;font-weight:600;color:#1a1a1a;">${escapeHtml(p.title)}</div>
                <a href="${url}" style="display:inline-block;margin-top:8px;font-size:14px;color:#1a1a1a;text-decoration:underline;">Write a review</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
    })
    .join('');

  const unsub = unsubscribeUrl(shopDomain, unsubscribeToken);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f6f7;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f6f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:10px;padding:28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:16px;color:#1a1a1a;">${escapeHtml(greeting)}</td></tr>
        <tr><td style="padding-top:10px;font-size:15px;line-height:1.6;color:#4b5563;">${intro}</td></tr>
        <tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px;">${rows}</table></td></tr>
        <tr><td style="padding-top:20px;font-size:13px;line-height:1.6;color:#6b7280;">
          It takes about a minute, and it helps the next person decide.
        </td></tr>
        <tr><td style="padding-top:24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#9ca3af;">
          Sent by ${escapeHtml(sentenceName)}.
          <a href="${unsub}" style="color:#9ca3af;">Unsubscribe from review requests</a>.<br>
          ${escapeHtml(env.COMPANY_ADDRESS)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    greeting,
    '',
    isReminder
      ? 'We asked a little while back — if you have a minute, other shoppers would find your take genuinely useful.'
      : `Thanks for shopping with ${sentenceName}. If you have a moment, how did it work out?`,
    '',
    ...products.map((p) => `${p.title}\n${productUrl(shopDomain, p.handle)}`),
    '',
    'It takes about a minute, and it helps the next person decide.',
    '',
    `Sent by ${sentenceName}.`,
    `Unsubscribe from review requests: ${unsub}`,
    env.COMPANY_ADDRESS,
  ].join('\n');

  return { subject, html, text };
}
