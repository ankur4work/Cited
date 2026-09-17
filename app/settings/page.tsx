import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { resolveEmbeddedSession } from '@/lib/shopify/embedded-session';
import { ensureDefaultCampaign } from '@/lib/shopify/store';
import { isPaid, reviewRequestCapFor, monthStartUtc } from '@/lib/entitlements';
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

  // Stores installed before review requests existed have no campaign row, and
  // would otherwise see no card at all until they happened to re-authorize.
  // Idempotent and cheap — it returns on the first query when one exists.
  await ensureDefaultCampaign(store.id);

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

  // Requests are a paid capability, capped monthly on Pro and uncapped on
  // Scale. Counted with the same predicate and window the scheduler enforces,
  // so the number on screen is the number the cap is actually measured against.
  const entitled = isPaid(store);
  const cap = reviewRequestCapFor(store);
  const usedThisMonth =
    entitled && Number.isFinite(cap)
      ? await prisma.requestSend.count({
          where: {
            storeId: store.id,
            status: { in: ['SCHEDULED', 'SENT'] },
            scheduledAt: { gte: monthStartUtc() },
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
          ? {
              ...campaign,
              pendingCount,
              safetyThreshold: env.SEND_SAFETY_GATE_THRESHOLD,
              entitled,
              usedThisMonth,
              monthlyCap: Number.isFinite(cap) ? cap : null,
            }
          : null
      }
    />
  );
}
