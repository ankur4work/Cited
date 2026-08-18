import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { SessionBootstrap } from '../_components/session-bootstrap';
import { SettingsView } from '../_components/settings-view';
import { OpenFromAdmin } from '../_components/open-from-admin';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { shop?: string; id_token?: string };
}) {
  const session = await resolveEmbeddedSession({
    shop: searchParams.shop,
    idToken: searchParams.id_token,
  });

  if (session.state === 'no-shop') return <OpenFromAdmin title="Settings" />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;

  const store = session.store;

  return (
    <SettingsView
      shopDomain={store.shopDomain}
      plan={store.plan}
      reviewScopeGranted={store.reviewScopeGranted}
      scope={store.scope}
      installedAt={store.installedAt}
      accessTokenExpiresAt={store.accessTokenExpiresAt}
      analyticsPixelEnabled={store.analyticsPixelEnabled}
      gdprMode={store.gdprMode}
    />
  );
}
