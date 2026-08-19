'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BlockStack, Card, Page, Spinner, Text } from '@shopify/polaris';
import { OpenFromAdmin } from './open-from-admin';

// `window.shopify` is declared once, in session-bootstrap.tsx — repeating the
// interface here with a different shape is a merge conflict, not an addition.

/**
 * Recovers the shop when the URL lost it.
 *
 * The server identifies the store from `?shop=` on the request. That parameter
 * is on the URL Shopify opens the app with, and it survives exactly as long as
 * nothing navigates without carrying it forward — so a tab, a nav-menu link, a
 * refresh or a bookmark all used to land on "Open Cited from your Shopify
 * admin" while the merchant was demonstrably inside the Shopify admin.
 *
 * The server cannot tell those two situations apart; it sees a request with no
 * shop either way. The client can: App Bridge only exists inside the admin
 * iframe. So being unable to identify the shop is not an answer, it is a
 * question to ask the browser.
 *
 * Recovery is a URL rewrite rather than a token exchange. The store already has
 * a working access token in almost every case — what was lost is the pointer to
 * which store — so putting `shop` back on the URL is enough, and it leaves the
 * merchant on an address that survives a reload. `replace`, not `push`, so Back
 * does not walk into the same dead end.
 */
export function SessionRecovery({ title }: { title?: string }) {
  const router = useRouter();
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function recover() {
      const shop = await waitForShop();
      if (cancelled) return;

      if (!shop) {
        // Genuinely outside the admin. The static message is the right answer.
        setUnavailable(true);
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set('shop', shop);
      router.replace(`${url.pathname}${url.search}`);
    }

    void recover();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (unavailable) return <OpenFromAdmin title={title} />;

  return (
    <Page title={title ?? 'Cited'}>
      <Card>
        <BlockStack gap="300" inlineAlign="center">
          <Spinner accessibilityLabel="Connecting to Shopify" size="large" />
          <Text as="p" tone="subdued">
            Connecting…
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}

/**
 * App Bridge loads from Shopify's CDN as a plain script, so `window.shopify`
 * can still be undefined on a fast first paint. Poll briefly rather than
 * declaring the merchant to be outside the admin when they are not.
 *
 * Falls back to the session token's `dest` claim when `config.shop` is absent,
 * since older App Bridge builds expose one but not the other.
 */
async function waitForShop(timeoutMs = 5000): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const shop = window.shopify?.config?.shop;
    if (typeof shop === 'string' && shop.endsWith('.myshopify.com')) return shop;

    const idToken = window.shopify?.idToken;
    if (typeof idToken === 'function') {
      try {
        const claims = JSON.parse(atob((await idToken()).split('.')[1]!)) as { dest?: string };
        if (typeof claims.dest === 'string') {
          const host = new URL(claims.dest).host;
          if (host.endsWith('.myshopify.com')) return host;
        }
      } catch {
        // Malformed or unavailable token — fall through and keep polling.
      }
    }

    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
