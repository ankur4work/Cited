'use client';

import { AppProvider } from '@shopify/polaris';
import en from '@shopify/polaris/locales/en.json';

/**
 * Polaris needs a provider at the root for translations, portals (modals,
 * toasts) and theme tokens. It is a client component because Polaris is
 * context-driven, but everything inside it can still be a server component —
 * the pages below fetch their own data on the server and pass plain props.
 */
export function PolarisProvider({ children }: { children: React.ReactNode }) {
  return <AppProvider i18n={en}>{children}</AppProvider>;
}
