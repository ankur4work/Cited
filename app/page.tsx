import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { getOverview, getRecentReviews, getSetupSteps } from '@/lib/dashboard';
import { checkThemeBlock } from '@/lib/theme-block';
import { SessionBootstrap } from './_components/session-bootstrap';
import { OverviewView } from './_components/overview-view';
import { SessionRecovery } from './_components/session-recovery';
import { ScopeUpgrade } from './_components/scope-upgrade';

export const dynamic = 'force-dynamic';

/**
 * The embedded app's home.
 *
 * Authentication happens before anything renders: `resolveEmbeddedSession`
 * exchanges the App Bridge session token when the store has no usable access
 * token, so a merchant never sees Shopify's authorize screen. Rendering is
 * delegated to a client view because Polaris cannot run in a server component.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: { shop?: string; host?: string; id_token?: string };
}) {
  const session = await resolveEmbeddedSession({
    shop: searchParams.shop,
    idToken: searchParams.id_token,
  });

  if (session.state === 'no-shop') return <SessionRecovery />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;
  if (session.state === 'needs-scopes')
    return <ScopeUpgrade shop={session.shop} missing={session.missing} />;

  const store = session.store;
  const overview = await getOverview(store.id);

  // Runs alongside the review query: the theme check is an outbound request to
  // the storefront, and serialising it would add its latency to every load.
  const [recent, themeBlock] = await Promise.all([
    getRecentReviews(store.id),
    checkThemeBlock(store.id, store.shopDomain),
  ]);

  return (
    <OverviewView
      shopDomain={store.shopDomain}
      reviewScopeGranted={store.reviewScopeGranted}
      overview={overview}
      steps={getSetupSteps(store, overview, themeBlock)}
      recent={recent}
    />
  );
}
