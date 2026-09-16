import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { SessionBootstrap } from '../_components/session-bootstrap';
import { SettingsView } from '../_components/settings-view';
import { SessionRecovery } from '../_components/session-recovery';
import { ScopeUpgrade } from '../_components/scope-upgrade';

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

  if (session.state === 'no-shop') return <SessionRecovery title="Settings" />;
  if (session.state === 'needs-token') return <SessionBootstrap shop={session.shop} />;
  if (session.state === 'needs-scopes')
    return <ScopeUpgrade shop={session.shop} missing={session.missing} />;

  const store = session.store;

  const campaign = await prisma.requestCampaign.findFirst({
    where: { storeId: store.id },
    select: {
      id: true,
      enabled: true,
      delayHours: true,
      subject: true,
      reminderCount: true,
      confirmedAt: true,
    },
  });

  // How many orders a first send would actually reach. Counted with the same
  // predicate the scheduler uses, so the number on screen is the number that
  // would be emailed — a warning that says "some" teaches a merchant nothing.
  const pendingCount = campaign
    ? await prisma.order.count({
        where: {
          storeId: store.id,
          requestScheduledAt: null,
          cancelledAt: null,
          refundedAt: null,
          customerEmailHash: { not: null },
          fulfilledAt: { not: null },
        },
      })
    : 0;

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
      campaign={
        campaign
          ? { ...campaign, pendingCount, safetyThreshold: env.SEND_SAFETY_GATE_THRESHOLD }
          : null
      }
    />
  );
}
