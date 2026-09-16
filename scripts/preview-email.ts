/**
 * Print the review request and reminder as a shopper receives them.
 *
 * No network, no database — just the renderer. Exists so the copy can be read
 * and argued about without enabling a campaign and waiting a week for a real
 * order to become eligible.
 *
 *   npx tsx --env-file=.env scripts/preview-email.ts
 *   npx tsx --env-file=.env scripts/preview-email.ts --html > preview.html
 */
import { renderReviewRequest } from '../lib/email/review-request';

const SHOP_NAME = 'Acme Supply Co.';

const base = {
  shopDomain: 'acme.myshopify.com',
  shopName: SHOP_NAME,
  customerName: 'Priya',
  products: [
    { title: 'Merino Overshirt', handle: 'merino-overshirt', imageUrl: null },
  ],
  unsubscribeToken: 'store_1.abc123.signature',
};

if (process.argv.includes('--html')) {
  process.stdout.write(renderReviewRequest({ ...base, isReminder: false }).html);
} else {
  for (const isReminder of [false, true]) {
    const out = renderReviewRequest({ ...base, isReminder });
    console.log(`\n${'='.repeat(64)}`);
    console.log(isReminder ? 'REMINDER (7 days later)' : 'FIRST REQUEST');
    console.log('='.repeat(64));
    console.log(`From:     ${SHOP_NAME} <no-reply@yourdomain.com>`);
    console.log(`Reply-To: hello@acme.com   (the merchant's contact address)`);
    console.log(`Subject:  ${out.subject}`);
    console.log('-'.repeat(64));
    console.log(out.text);
  }
}
