'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Banner, BlockStack, Card, Page, Spinner, Text } from '@shopify/polaris';

declare global {
  interface Window {
    /**
     * App Bridge, loaded from Shopify's CDN. The single declaration for the
     * whole app — session-recovery.tsx reads `config.shop` from it too.
     */
    shopify?: {
      idToken?: () => Promise<string>;
      config?: { shop?: string };
      /** App Bridge toast — renders in the admin's chrome, needs no Frame. */
      toast?: { show: (message: string, options?: { isError?: boolean; duration?: number }) => void };
    };
  }
}

/**
 * Establishes a session without the merchant doing anything.
 *
 * Rendered only when the server could not authenticate the request — first
 * open after install, or a stored token that cannot be refreshed. App Bridge
 * mints a session token in the browser, we exchange it server-side, and the
 * page reloads into the real app.
 *
 * This replaces the old "Install / Reconnect" button that sent merchants to
 * Shopify's authorize screen. That screen is not supposed to appear at all
 * under managed installation, and appearing after the app was already
 * installed is what made Cited feel broken.
 */
export function SessionBootstrap({ shop }: { shop: string }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // App Bridge loads from Shopify's CDN as a plain script, so on a very
        // fast first paint `window.shopify` can still be undefined.
        const idToken = await waitForIdToken();
        if (!idToken) throw new Error('App Bridge unavailable');

        const res = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) throw new Error(`session exchange ${res.status}`);

        if (!cancelled) router.refresh();
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (failed) {
    return (
      <Page title="Cited">
        <Banner
          tone="warning"
          title="Couldn't connect to Shopify"
          action={{ content: 'Try again', onAction: () => window.location.reload() }}
        >
          <p>
            Cited could not authenticate with {shop}. This usually clears on a retry.
            If it keeps happening, open the app from your Shopify admin rather than a
            saved link.
          </p>
        </Banner>
      </Page>
    );
  }

  return (
    <Page title="Cited">
      <Card>
        <BlockStack gap="300" inlineAlign="center">
          <Spinner accessibilityLabel="Connecting to Shopify" size="large" />
          <Text as="p" tone="subdued">
            Connecting to {shop}…
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}

/**
 * App Bridge is a CDN script, not a bundled module, so it may not have
 * executed when React mounts. Poll briefly rather than failing the first open.
 */
async function waitForIdToken(timeoutMs = 5000): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const idToken = window.shopify?.idToken;
    if (typeof idToken === 'function') return idToken();
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
