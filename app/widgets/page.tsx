import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { WIDGETS, themeEditorUrl } from '@/lib/shopify/widgets';
import { ShopifyClient } from '@/lib/shopify/client';
import { getWidgetSettings } from '@/lib/shopify/shop-metafields';
import { parseWidgetSettings, WIDGET_DEFAULTS } from '@/lib/widgets/settings';
import { logger } from '@/lib/logger';
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

  // Read from Shopify rather than a local copy: the metafield IS the record
  // the storefront renders from, so anything else here could disagree with
  // what a merchant is actually looking at on their own product page.
  let settings = WIDGET_DEFAULTS;
  try {
    settings = parseWidgetSettings(await getWidgetSettings(new ShopifyClient(session.store)));
  } catch (err) {
    // Defaults are a correct answer for a store that has never saved, and the
    // customiser should still open if Shopify is briefly unavailable.
    logger.warn(
      { storeId: session.store.id, err: (err as Error).message },
      'Could not read widget settings — showing defaults',
    );
  }

  return (
    <WidgetsView
      shopDomain={shopDomain}
      settings={settings}
      widgets={WIDGETS.map((w) => ({ ...w, addUrl: themeEditorUrl(shopDomain, w) }))}
    />
  );
}
