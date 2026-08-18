import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifyWebhookRequest, claimWebhookEvent } from '@/lib/shopify/webhook';
import { fetchActiveSubscription, planFromSubscription } from '@/lib/shopify/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `app_subscriptions/update` — plan changes, cancellations, failed payments.
 *
 * The payload names a status, but the plan is resolved by asking the Admin API
 * what the shop's active subscription actually is, rather than by mapping the
 * status in the body. Statuses arrive out of order — a DECLINED for a
 * superseded charge can land after the ACTIVE for its replacement — and
 * trusting the last message received would downgrade a paying merchant on a
 * stale notification. Re-reading is authoritative and costs one call on an
 * event that fires a handful of times per store per year.
 *
 * Every transition is written to BillingEvent. Plan changes are the single
 * most disputed thing a merchant contacts support about, and an unexplained
 * downgrade needs an answer better than a guess.
 */
export async function POST(req: NextRequest) {
  const verification = await verifyWebhookRequest(req);

  if (!verification.ok) {
    logger.warn({ reason: verification.reason }, 'Subscription webhook rejected');
    return NextResponse.json({ error: verification.reason }, { status: verification.status });
  }

  const { topic, shopDomain, webhookId, payload } = verification.webhook;

  if (topic !== 'app_subscriptions/update') {
    logger.warn({ topic, shopDomain }, 'Non-subscription topic delivered to subscriptions route');
    return NextResponse.json({ ok: true, ignored: 'wrong_topic' });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, plan: true, uninstalledAt: true, shopDomain: true, accessToken: true },
  });

  if (!store || store.uninstalledAt) {
    return NextResponse.json({ ok: true, ignored: 'store_not_installed' });
  }

  const claim = await claimWebhookEvent({
    topic,
    webhookId,
    storeId: store.id,
    payload: {
      status:
        typeof payload.app_subscription === 'object' && payload.app_subscription !== null
          ? ((payload.app_subscription as Record<string, unknown>).status ?? null)
          : null,
    },
  });

  if (claim.duplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const subscription = await fetchActiveSubscription({
      id: store.id,
      shopDomain: store.shopDomain,
    });
    const plan = planFromSubscription(subscription);

    if (plan !== store.plan) {
      await prisma.$transaction([
        prisma.store.update({
          where: { id: store.id },
          data: {
            plan,
            planUpdatedAt: new Date(),
            shopifyChargeId: subscription?.id ?? null,
          },
        }),
        prisma.billingEvent.create({
          data: {
            storeId: store.id,
            eventType: `plan.${store.plan.toLowerCase()}_to_${plan.toLowerCase()}`,
            shopifyChargeId: subscription?.id ?? null,
          },
        }),
      ]);

      logger.info({ shopDomain, from: store.plan, to: plan }, 'Plan changed');
    }
  } catch (err) {
    // 500 so Shopify retries. Leaving a merchant on the wrong plan is a
    // billing dispute; retrying a read is cheap.
    logger.error(
      { shopDomain, webhookId, err: (err as Error).message },
      'Failed to resolve subscription after update webhook',
    );
    return NextResponse.json({ error: 'resolve failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
