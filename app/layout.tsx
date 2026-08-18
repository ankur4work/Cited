import type { Metadata } from 'next';
import { env } from '@/lib/env';
import '@shopify/polaris/build/esm/styles.css';
import { PolarisProvider } from './_components/polaris-provider';
import { NavMenu } from './_components/nav-menu';

export const metadata: Metadata = {
  title: 'Cited — Product Reviews & AI Visibility',
  description:
    'Collect reviews, then make them work in Google and AI shopping assistants — not just on your product page.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          App Bridge must load from Shopify's CDN as a plain script in <head>,
          before any other script. Bundling it or deferring it breaks embedding
          and fails Built for Shopify review.
        */}
        <meta name="shopify-api-key" content={env.SHOPIFY_API_KEY} />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body>
        <PolarisProvider>
          <NavMenu />
          {children}
        </PolarisProvider>
      </body>
    </html>
  );
}
