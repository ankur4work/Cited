import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { WIDGETS, themeEditorUrl } from '@/lib/shopify/widgets';
import { SessionBootstrap } from '../_components/session-bootstrap';
import { SessionRecovery } from '../_components/session-recovery';
import { ScopeUpgrade } from '../_components/scope-upgrade';
import { WidgetsView } from '../_components/widgets-view';

export const dynamic = 'force-dynamic';

export default async function WidgetsPage({
  searchParams,
}: {
  searchParams: { shop?: string; id_token?: string };
}) {
  const session = await resolveEmbeddedSession({
    shop: searchParams.shop,
    idToken: searchParams.id_token,
  });

  if (session.state === 'no-shop') return <SessionRecovery title="Widgets" />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;
  if (session.state === 'needs-scopes')
    return <ScopeUpgrade shop={session.shop} missing={session.missing} />;

  const shopDomain = session.store.shopDomain;

  return (
    <WidgetsView
      shopDomain={shopDomain}
      widgets={WIDGETS.map((w) => ({ ...w, addUrl: themeEditorUrl(shopDomain, w) }))}
    />
  );
}
