import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { enqueueReviewRequest } from '../enqueue';
import type { EmailJobData } from '../queue';

/**
 * Find orders due a review request and queue one each.
 *
 * A periodic sweep rather than a delayed job created at fulfilment. Both work,
 * but a sweep is recoverable: if the worker is down for an hour, or a webhook
 * is missed, or a merchant enables their campaign a week after installing, the
 * next pass picks up everything that became eligible in the meantime. A
 * week-long delayed job created at fulfilment time has no such second chance —
 * anything lost is lost silently, and "silently" is the word that matters when
 * the missing thing is the review a merchant was expecting.
 *
 * Idempotency comes from `Order.requestScheduledAt`, set in the same
 * transaction as the RequestSend row. An order is eligible exactly once.
 */
export async function emailScheduleProcessor(
  _job: Job<EmailJobData, unknown, 'email:schedule-batch'>,
): Promise<void> {
  const campaigns = await prisma.requestCampaign.findMany({
    where: {
      enabled: true,
      store: { uninstalledAt: null },
    },
    select: {
      id: true,
      storeId: true,
      delayHours: true,
      trigger: true,
      requiresConfirmation: true,
      confirmedAt: true,
    },
  });

  if (campaigns.length === 0) return;

  let queued = 0;

  for (const campaign of campaigns) {
    const cutoff = new Date(Date.now() - campaign.delayHours * 60 * 60 * 1000);

    // `requestScheduledAt: null` is the whole guard. Imported historical
    // orders are stamped at ingest precisely so a freshly installed store
    // cannot email months of past customers on day one.
    const where = {
      storeId: campaign.storeId,
      requestScheduledAt: null,
      cancelledAt: null,
      refundedAt: null,
      customerEmailHash: { not: null },
      ...(campaign.trigger === 'ORDER_PAID'
        ? { processedAt: { lte: cutoff, not: null } }
        : { fulfilledAt: { lte: cutoff, not: null } }),
    } as const;

    const eligible = await prisma.order.findMany({
      where,
      // Bounded per pass. A store with a large backlog drains over several
      // runs rather than queueing tens of thousands of jobs in one go.
      take: 500,
      orderBy: { fulfilledAt: 'asc' },
      select: { id: true, shopifyGid: true, customerEmailHash: true },
    });

    if (eligible.length === 0) continue;

    // The send-safety gate. Directly targets the competitor failure in
    // PLAN.md §2 (W4): 3,620 emails sent on a default template with nobody's
    // approval. Above the threshold the merchant confirms once, explicitly.
    if (
      campaign.requiresConfirmation &&
      !campaign.confirmedAt &&
      eligible.length >= env.SEND_SAFETY_GATE_THRESHOLD
    ) {
      logger.warn(
        { storeId: campaign.storeId, campaignId: campaign.id, pending: eligible.length },
        'Review requests held — batch exceeds the safety threshold and needs merchant confirmation',
      );
      continue;
    }

    for (const order of eligible) {
      // Never email an address that has opted out or hard-bounced.
      const suppressed = await prisma.suppression.findUnique({
        where: {
          storeId_emailHash: {
            storeId: campaign.storeId,
            emailHash: order.customerEmailHash!,
          },
        },
        select: { id: true },
      });

      try {
        await prisma.$transaction([
          prisma.order.update({
            where: { id: order.id },
            data: { requestScheduledAt: new Date() },
          }),
          prisma.requestSend.create({
            data: {
              storeId: campaign.storeId,
              campaignId: campaign.id,
              orderShopifyGid: order.shopifyGid,
              emailHash: order.customerEmailHash!,
              // Recorded, not silently skipped: a merchant asking "why did
              // this customer never get one?" deserves an answer, and a
              // missing row is not one.
              status: suppressed ? 'SUPPRESSED' : 'SCHEDULED',
              scheduledAt: new Date(),
            },
          }),
        ]);
      } catch (err) {
        // The unique constraint on (campaign, order, reminderIndex) makes a
        // duplicate structurally impossible; losing that race is correct
        // behaviour, not an error worth failing the sweep over.
        logger.debug(
          { storeId: campaign.storeId, order: order.shopifyGid, err: (err as Error).message },
          'Review request not scheduled — already exists',
        );
        continue;
      }

      if (suppressed) continue;

      await enqueueReviewRequest({
        storeId: campaign.storeId,
        campaignId: campaign.id,
        orderShopifyGid: order.shopifyGid,
      });
      queued++;
    }
  }

  if (queued > 0) {
    logger.info({ campaigns: campaigns.length, queued }, 'Review requests queued');
  }
}
