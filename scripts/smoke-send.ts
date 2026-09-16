/**
 * Send one real review request email.
 *
 * Goes through the same sendEmail() and renderReviewRequest() the worker uses,
 * so a pass here means the provider, the credentials, the verified sender and
 * the template all work together — which is the one thing no unit test can
 * tell you.
 *
 *   npx tsx --env-file=.env scripts/smoke-send.ts you@example.com
 */
import { sendEmail, emailProvider, emailConfigured } from '../lib/email/send';
import { renderReviewRequest } from '../lib/email/review-request';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) {
    console.error('Usage: tsx scripts/smoke-send.ts <recipient@example.com>');
    process.exit(1);
  }

  console.log(`provider:   ${emailProvider()}`);
  console.log(`configured: ${emailConfigured()}`);
  if (!emailConfigured()) process.exit(1);

  const rendered = renderReviewRequest({
    shopDomain: 'acme.myshopify.com',
    shopName: 'Acme Supply Co.',
    customerName: 'Priya',
    products: [
      { title: 'Merino Overshirt', handle: 'merino-overshirt', imageUrl: null },
    ],
    unsubscribeToken: 'store_1.hash.signature',
    isReminder: false,
  });

  const result = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    fromName: 'Acme Supply Co.',
    tags: { cited_send: 'smoke', cited_kind: 'request' },
  });

  console.log(`sent:       ${result.providerId}`);
  console.log(`subject:    ${rendered.subject}`);
  console.log('\nCheck the inbox. Confirm: sender shows the STORE name, the');
  console.log('product link works, and the unsubscribe link is present.');
}

main().catch((err) => {
  console.error('SEND FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
