'use client';

/**
 * Show a toast in the Shopify admin.
 *
 * NOT Polaris's `<Toast>`. That component requires a `<Frame>` ancestor and
 * throws without one — and this app has no Frame, so every button that
 * reported success crashed the page instead: publish, hide, mark spam, and
 * saving a setting. The error surfaced as "Application error: a client-side
 * exception has occurred", which named neither the component nor the cause.
 *
 * App Bridge's toast is the right tool here anyway. It renders in the admin's
 * own chrome rather than inside our iframe, so it looks like every other
 * confirmation a merchant sees, survives navigation within the app, and needs
 * no provider at all.
 *
 * Silent when App Bridge is absent: that only happens outside the Shopify
 * admin, where the app refuses to run in the first place. A thrown error there
 * would replace a missing confirmation with a broken page, which is the trade
 * that caused this bug.
 */
export function showToast(message: string, options: { isError?: boolean } = {}): void {
  try {
    window.shopify?.toast?.show(message, {
      isError: options.isError === true,
      duration: options.isError ? 5000 : 3000,
    });
  } catch {
    // A toast is feedback, never the operation. The write already succeeded.
  }
}
