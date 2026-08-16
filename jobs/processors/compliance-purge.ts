import type { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import type { MaintenanceJobData, MaintenanceJobName } from '../queue';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { audit, AUDIT } from '@/lib/audit';
import { redactCustomer, redactShop, compileDataRequest } from '@/lib/compliance/redact';
import { enqueueReviewSyndication } from '../enqueue';

/**
 * Executes one GDPR/CCPA compliance request.
 *
 * Runs on the maintenance queue rather than in the webhook because an erasure
 * spans several tables and can touch thousands of rows, and because a failure
 * has to retry — Shopify's five-second webhook window offers neither.
 *
 * The ledger row is the unit of work. It is opened by the route, moved through
 * IN_PROGRESS here, and closed with counts of what was actually touched. If
 * this throws, BullMQ retries and the row stays open; that is the intended
 * shape, because an unfinished erasure should look unfinished.
 */
export async function compliancePurgeProcessor(
  job: Job<MaintenanceJobData, unknown, MaintenanceJobName>,
): Promise<void> {
  const { complianceRequestId, storeId, shopDomain, type, customerEmail, orderGids } = job.data;

  if (!complianceRequestId || !type) {
    throw new Error('compliance:purge job missing complianceRequestId or type');
  }

  const request = await prisma.complianceRequest.findUnique({
    where: { id: complianceRequestId },
    select: { status: true },
  });

  if (!request) {
    // The ledger row is the authority. If it is gone the request is not ours
    // to run, and inventing one would erase data with no record of why.
    logger.error({ complianceRequestId }, 'Compliance request row missing — refusing to act');
    return;
  }

  if (request.status === 'COMPLETED') {
    logger.debug({ complianceRequestId }, 'Compliance request already completed');
    return;
  }

  await prisma.complianceRequest.update({
    where: { id: complianceRequestId },
    data: { status: 'IN_PROGRESS', attempts: { increment: 1 } },
  });

  try {
    // ── shop/redact ──────────────────────────────────────────
    if (type === 'SHOP_REDACT') {
      if (!storeId) {
        await close(complianceRequestId, { nothingToErase: true });
        return;
      }

      const { deleted, counts } = await redactShop({ storeId, shopDomain: shopDomain ?? '' });

      // Audited BEFORE the ledger closes and with storeId already detached by
      // the delete's SetNull — the shop is gone, so this row and the ledger
      // are the only remaining evidence the data ever existed.
      await audit({
        action: AUDIT.SHOP_REDACT,
        storeId: null,
        actor: 'SHOPIFY',
        subjectType: 'Store',
        subjectId: storeId,
        recordCount: counts.orders + counts.reviews + counts.questions,
        meta: { shopDomain, deleted, ...counts },
      });

      await close(complianceRequestId, { deleted, ...counts });
      logger.info({ shopDomain, ...counts }, 'shop/redact completed');
      return;
    }

    // ── customers/redact ─────────────────────────────────────
    if (type === 'CUSTOMER_REDACT') {
      if (!storeId) {
        await close(complianceRequestId, { nothingToErase: true });
        return;
      }

      const { counts, reviewIds } = await redactCustomer({
        storeId,
        customerEmail: customerEmail ?? null,
        orderGids: orderGids ?? [],
      });

      // The author name is a field on the Shopify metaobject too. Stripping it
      // in Postgres alone leaves the erased name rendering on the storefront,
      // so each anonymised review is re-projected. `repairKey` bypasses the
      // per-review coalescing deliberately: an erasure must never be swallowed
      // by an in-flight or recently-completed sync of the pre-redaction row.
      for (const reviewId of reviewIds) {
        await enqueueReviewSyndication({
          storeId,
          reviewId,
          repairKey: `redact:${complianceRequestId}`,
        });
      }

      await audit({
        action: AUDIT.CUSTOMER_REDACT,
        storeId,
        actor: 'SHOPIFY',
        subjectType: 'Customer',
        recordCount: counts.orders + counts.reviews + counts.questions + counts.requestSends,
        meta: { ...counts, reviewsResyndicated: reviewIds.length },
      });

      await close(complianceRequestId, { ...counts, reviewsResyndicated: reviewIds.length });
      logger.info({ shopDomain, ...counts }, 'customers/redact completed');
      return;
    }

    // ── customers/data_request ───────────────────────────────
    //
    // Produces rather than deletes, and the recipient is the MERCHANT: Shopify's
    // contract is that we hand the data to the store owner, who answers their
    // shopper. There is no email layer yet, so the export is not delivered from
    // here — it is compiled on demand by the audited admin endpoint, and this
    // job's job is to prove the request arrived and raise it loudly enough that
    // a human acts inside the 30-day window.
    if (!storeId) {
      await close(complianceRequestId, { nothingToDisclose: true });
      return;
    }

    const data = await compileDataRequest({
      storeId,
      customerEmail: customerEmail ?? null,
      orderGids: orderGids ?? [],
    });

    const summary = {
      orders: Array.isArray(data.orders) ? data.orders.length : 0,
      reviews: Array.isArray(data.reviews) ? data.reviews.length : 0,
      questions: Array.isArray(data.questions) ? data.questions.length : 0,
    };

    // Counts only. The compiled export is discarded here rather than stored —
    // persisting a subject access request would create a second, unencrypted
    // copy of exactly the data it concerns.
    logger.warn(
      { complianceRequestId, shopDomain, ...summary, actionRequired: true },
      'customers/data_request received — fetch the export from the admin endpoint and send it to the merchant within 30 days',
    );

    await prisma.complianceRequest.update({
      where: { id: complianceRequestId },
      data: { resultJson: { ...summary, awaitingMerchantDelivery: true } },
    });
    return;
  } catch (err) {
    await prisma.complianceRequest
      .update({
        where: { id: complianceRequestId },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000) },
      })
      .catch(() => undefined);
    throw err;
  }
}

async function close(id: string, result: Prisma.InputJsonObject): Promise<void> {
  await prisma.complianceRequest.update({
    where: { id },
    data: { status: 'COMPLETED', completedAt: new Date(), resultJson: result, error: null },
  });
}
