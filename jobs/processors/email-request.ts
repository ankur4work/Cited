import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { decrypt } from '@/lib/crypto';
import { sendEmail, EmailError, emailConfigured } from '@/lib/email/send';
import { renderReviewRequest } from '@/lib/email/review-request';
import { unsubscribeToken } from '@/lib/email/unsubscribe';
import { syncShopProfile } from '@/lib/shopify/shop-profile';
import { enqueueReviewRequest } from '../enqueue';
import type { EmailJobData, EmailJobName } from '../queue';

/**
 * Send one review request, then schedule its reminder.
 *
 * Every check that could cancel a send happens here rather than at schedule
 * time, because hours or days pass in between: the customer may have
 * unsubscribed, the order may have been refunded, they may have already
 * reviewed the thing we are about to ask them about. Asking someone to review
 * a product they returned is the kind of email that gets an app uninstalled.
 */
export async function emailRequestProcessor(
  job: Job<EmailJobData, unknown, EmailJobName>,
): Promise<void> {
  const { storeId, campaignId, orderShopifyGid } = job.data;
  if (!campaignId || !orderShopifyGid) {
    throw new Error('email:request requires campaignId and orderShopifyGid');
  }

  if (!emailConfigured()) {
    logger.info({ storeId }, 'Review request skipped — email is not configured');
    return;
  }

  const isReminder = job.name === 'email:reminder';
  const reminderIndex = isReminder ? 1 : 0;

  const send = await prisma.requestSend.findUnique({
    where: {
      campaignId_orderShopifyGid_reminderIndex: {
        campaignId,
        orderShopifyGid,
        reminderIndex,
      },
    },
    select: { id: true, status: true, emailHash: true },
  });

  if (!send) {
    logger.debug({ storeId, orderShopifyGid, reminderIndex }, 'No send row — nothing to do');
    return;
  }
  // Already sent, cancelled or suppressed. A retry must not double-send.
  if (send.status !== 'SCHEDULED') return;

  const [store, campaign, order] = await Promise.all([
    prisma.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        shopDomain: true,
        name: true,
        email: true,
        accessToken: true,
        uninstalledAt: true,
      },
    }),
    prisma.requestCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, enabled: true, reminderCount: true, reminderDelayHours: true },
    }),
    prisma.order.findFirst({
      where: { storeId, shopifyGid: orderShopifyGid },
      select: {
        id: true,
        customerEmailEnc: true,
        customerName: true,
        cancelledAt: true,
        refundedAt: true,
        lineItems: { select: { productId: true } },
      },
    }),
  ]);

  if (!store || store.uninstalledAt || !campaign?.enabled || !order) {
    await cancel(send.id, 'store, campaign or order no longer eligible');
    return;
  }

  // Refunded or cancelled since scheduling.
  if (order.cancelledAt || order.refundedAt) {
    await cancel(send.id, 'order cancelled or refunded');
    return;
  }

  // Opted out since scheduling.
  const suppressed = await prisma.suppression.findUnique({
    where: { storeId_emailHash: { storeId, emailHash: send.emailHash } },
    select: { id: true },
  });
  if (suppressed) {
    await prisma.requestSend.update({ where: { id: send.id }, data: { status: 'SUPPRESSED' } });
    return;
  }

  // Stores installed before the profile sync existed have no name on file, and
  // will not re-authorize just because we would like them to. Fetched once,
  // here, so their customers see the shop name rather than a bare address.
  let shopName = store.name;
  let replyTo = store.email;
  if (!shopName) {
    await syncShopProfile(store);
    const fresh = await prisma.store.findUnique({
      where: { id: store.id },
      select: { name: true, email: true },
    });
    shopName = fresh?.name ?? null;
    // Re-read alongside the name: the sync writes both, and reading a stale
    // `store.email` here would drop the merchant's reply address on exactly
    // the installs this backfill exists for.
    replyTo = fresh?.email ?? null;
  }

  const productIds = order.lineItems.map((l) => l.productId).filter((id): id is string => !!id);
  if (productIds.length === 0) {
    await cancel(send.id, 'no resolvable products on the order');
    return;
  }

  // Already reviewed everything we would ask about. Chasing someone who has
  // already done the thing is the most annoying email an app can send.
  const reviewed = await prisma.review.findMany({
    where: { storeId, authorEmailHash: send.emailHash, productId: { in: productIds } },
    select: { productId: true },
  });
  const outstanding = productIds.filter((id) => !reviewed.some((r) => r.productId === id));
  if (outstanding.length === 0) {
    await cancel(send.id, 'customer has already reviewed these products');
    return;
  }

  const products = await prisma.product.findMany({
    where: { id: { in: outstanding }, storeId },
    // Three is where a request stops reading as a question and starts reading
    // as a task. The rest stay reviewable from the storefront.
    take: 3,
    select: { title: true, handle: true, imageUrl: true },
  });
  if (products.length === 0) {
    await cancel(send.id, 'products no longer in the catalogue');
    return;
  }

  if (!order.customerEmailEnc) {
    await cancel(send.id, 'no address on file');
    return;
  }

  let to: string;
  try {
    to = decrypt(order.customerEmailEnc);
  } catch (err) {
    // Undecryptable means the key rotated. Retrying cannot fix it.
    await fail(send.id, `could not decrypt recipient: ${(err as Error).message}`);
    return;
  }

  const rendered = renderReviewRequest({
    shopDomain: store.shopDomain,
    shopName: shopName ?? store.shopDomain,
    customerName: order.customerName,
    products,
    unsubscribeToken: unsubscribeToken(storeId, send.emailHash),
    isReminder,
  });

  try {
    const { providerId } = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // Falls back to the shop's own domain rather than to nothing: a bare
      // `no-reply@…` in the inbox is both worse for the merchant and more
      // likely to be reported as spam than a recognisable store name.
      fromName: shopName ?? store.shopDomain.replace(/\.myshopify\.com$/, ''),
      // Replies go to the merchant. A customer answering a review request is
      // talking to the store, not to us, and routing that to a no-reply
      // address loses a real conversation.
      replyTo: replyTo ?? undefined,
      tags: { cited_send: send.id, cited_kind: isReminder ? 'reminder' : 'request' },
    });

    await prisma.requestSend.update({
      where: { id: send.id },
      data: { status: 'SENT', sentAt: new Date(), providerId },
    });

    logger.info(
      { storeId, sendId: send.id, products: products.length, reminder: isReminder },
      'Review request sent',
    );
  } catch (err) {
    if (err instanceof EmailError && !err.retryable) {
      await fail(send.id, err.message);
      return;
    }
    throw err;
  }

  // One reminder, and only after the first send actually succeeded.
  if (!isReminder && campaign.reminderCount > 0) {
    await prisma.requestSend
      .create({
        data: {
          storeId,
          campaignId,
          orderShopifyGid,
          emailHash: send.emailHash,
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() + campaign.reminderDelayHours * 3600_000),
          reminderIndex: 1,
        },
      })
      .then(() =>
        enqueueReviewRequest({
          storeId,
          campaignId,
          orderShopifyGid,
          reminderIndex: 1,
          delayMs: campaign.reminderDelayHours * 3600_000,
        }),
      )
      .catch((err: Error) =>
        logger.debug({ storeId, sendId: send.id, err: err.message }, 'Reminder already scheduled'),
      );
  }
}

async function cancel(id: string, reason: string): Promise<void> {
  await prisma.requestSend.update({
    where: { id },
    data: { status: 'CANCELLED', failureReason: reason.slice(0, 500) },
  });
  logger.debug({ sendId: id, reason }, 'Review request cancelled');
}

async function fail(id: string, reason: string): Promise<void> {
  await prisma.requestSend.update({
    where: { id },
    data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
  });
  logger.error({ sendId: id, reason }, 'Review request failed permanently');
}
