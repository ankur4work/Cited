import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { getOverview, getRecentReviews, getSetupSteps } from '@/lib/dashboard';
import { SessionBootstrap } from './_components/session-bootstrap';
import { OverviewView } from './_components/overview-view';
import { OpenFromAdmin } from './_components/open-from-admin';

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

  if (session.state === 'no-shop') return <OpenFromAdmin />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;

  const store = session.store;
  const overview = await getOverview(store.id);
  const recent = await getRecentReviews(store.id);

  return (
    <OverviewView
      shopDomain={store.shopDomain}
      reviewScopeGranted={store.reviewScopeGranted}
      overview={overview}
      steps={getSetupSteps(store, overview)}
      recent={recent}
    />
  );
}
