import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { planSelectionUrl } from '@/lib/shopify/billing';
import { SessionBootstrap } from '../_components/session-bootstrap';
import { SessionRecovery } from '../_components/session-recovery';
import { ScopeUpgrade } from '../_components/scope-upgrade';
import { PlansView } from '../_components/plans-view';

export const dynamic = 'force-dynamic';

export default async function PlansPage({
  searchParams,
}: {
  searchParams: { shop?: string; id_token?: string };
}) {
  const session = await resolveEmbeddedSession({
    shop: searchParams.shop,
    idToken: searchParams.id_token,
  });

  if (session.state === 'no-shop') return <SessionRecovery title="Plans" />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;
  if (session.state === 'needs-scopes')
    return <ScopeUpgrade shop={session.shop} missing={session.missing} />;

  return (
    <PlansView
      plan={session.store.plan}
      planSelectionUrl={planSelectionUrl(session.store.shopDomain)}
    />
  );
}
