import { prisma } from '../prisma';
import { logger } from '../logger';
import { hashEmail } from '../crypto';

/**
 * Erasure. The half of GDPR/CCPA compliance that actually deletes things.
 *
 * Two decisions here are worth stating plainly, because both are judgement
 * calls a reviewer or a regulator may ask about.
 *
 * **Reviews are anonymised, not deleted.** A review's rating and body are the
 * merchant's product feedback and are what every aggregate, metafield and
 * storefront rating is computed from. Deleting them on an erasure request
 * would silently move a merchant's public star rating — visible to shoppers,
 * attributable to nothing. So the identifiers go (author name, email, IP and
 * user-agent hashes) and the opinion stays, with `redactedAt` set. Once the
 * link to a person is severed the remaining row is no longer personal data.
 *
 * **Suppression rows survive.** They hold a keyed hash and one fact: do not
 * email this person. Deleting that on request would mean the next campaign
 * emails someone who asked us to stop — honouring the erasure by breaking the
 * opt-out. This is the standard exception and it is documented in the privacy
 * policy rather than left implicit here.
 *
 * Everything else — the order mirror's email and name, question askers, send
 * records, review media — is erased outright.
 */

export interface RedactionCounts {
  orders: number;
  reviews: number;
  reviewMedia: number;
  questions: number;
  requestSends: number;
}

export interface CustomerRedactionResult {
  counts: RedactionCounts;
  /**
   * Reviews that were anonymised. The caller re-projects these: the author
   * name is a field on the Shopify `product_review` metaobject too, so an
   * erasure that stops at Postgres leaves the name rendering on the
   * storefront.
   */
  reviewIds: string[];
}

export interface RedactCustomerInput {
  storeId: string;
  /** Plaintext, straight off the webhook. Hashed here, never stored. */
  customerEmail: string | null;
  orderGids: string[];
}

const EMPTY_COUNTS: RedactionCounts = {
  orders: 0,
  reviews: 0,
  reviewMedia: 0,
  questions: 0,
  requestSends: 0,
};

/**
 * Erase one customer's personal data within one store.
 *
 * Idempotent: every write is a null-out or a delete, so a Shopify redelivery
 * finds nothing left to do and reports zeroes rather than failing.
 */
export async function redactCustomer(
  input: RedactCustomerInput,
): Promise<CustomerRedactionResult> {
  const { storeId, orderGids } = input;
  const emailHash = input.customerEmail ? hashEmail(input.customerEmail) : null;

  if (!emailHash && orderGids.length === 0) {
    // Shopify always sends one or the other. Neither means we cannot identify
    // a subject, and guessing is not an option — report honestly instead of
    // reporting a successful erasure of nothing.
    logger.warn({ storeId }, 'customers/redact carried neither an email nor any order — nothing identifiable to erase');
    return { counts: { ...EMPTY_COUNTS }, reviewIds: [] };
  }

  // Reviews are matched by author email and by the orders named in the
  // request: a review left through a one-click email link carries the order
  // but may predate us storing the address.
  const reviewWhere = {
    storeId,
    OR: [
      ...(emailHash ? [{ authorEmailHash: emailHash }] : []),
      ...(orderGids.length ? [{ orderShopifyGid: { in: orderGids } }] : []),
    ],
  };

  return prisma.$transaction(async (tx) => {
    const reviews = await tx.review.findMany({ where: reviewWhere, select: { id: true } });
    const reviewIds = reviews.map((r) => r.id);

    let reviewMedia = 0;
    if (reviewIds.length) {
      const media = await tx.reviewMedia.findMany({
        where: { reviewId: { in: reviewIds } },
        select: { id: true, r2Key: true },
      });

      if (media.length) {
        // There is no storage layer yet, so this branch should be unreachable.
        // If it ever runs, the rows go but the R2 objects do not — an erasure
        // that leaves the photo served from a public bucket is a failed
        // erasure, so it is logged at error rather than counted as success.
        logger.error(
          { storeId, count: media.length, keys: media.map((m) => m.r2Key) },
          'Review media rows erased but R2 objects were NOT deleted — wire object deletion into the storage layer',
        );
      }

      const deleted = await tx.reviewMedia.deleteMany({ where: { reviewId: { in: reviewIds } } });
      reviewMedia = deleted.count;

      await tx.review.updateMany({
        where: { id: { in: reviewIds } },
        data: {
          authorName: null,
          authorEmailEnc: null,
          authorEmailHash: null,
          ipHash: null,
          userAgentHash: null,
          redactedAt: new Date(),
        },
      });
    }

    const orders = await tx.order.updateMany({
      where: {
        storeId,
        OR: [
          ...(emailHash ? [{ customerEmailHash: emailHash }] : []),
          ...(orderGids.length ? [{ shopifyGid: { in: orderGids } }] : []),
        ],
      },
      data: {
        customerEmailEnc: null,
        customerEmailHash: null,
        customerName: null,
        customerLocale: null,
      },
    });

    const questions = emailHash
      ? await tx.question.updateMany({
          where: { storeId, askerEmailHash: emailHash },
          data: { askerName: null, askerEmailEnc: null, askerEmailHash: null },
        })
      : { count: 0 };

    const requestSends = emailHash
      ? await tx.requestSend.updateMany({
          where: { storeId, emailHash },
          // emailHash goes too. Send idempotency is keyed on
          // (campaign, order, reminder), so nothing depends on it.
          data: { emailEnc: null, emailHash: '' },
        })
      : { count: 0 };

    return {
      counts: {
        orders: orders.count,
        reviews: reviewIds.length,
        reviewMedia,
        questions: questions.count,
        requestSends: requestSends.count,
      },
      reviewIds,
    };
  });
}

/**
 * Erase an entire shop, 48 hours after uninstall.
 *
 * Deleting the Store row cascades to every tenant-owned table by foreign key,
 * which is the point: a hand-written list of tables to clear would silently
 * miss whichever model is added next. The two records that deliberately
 * survive — the compliance ledger and the audit trail — are `SetNull` rather
 * than `Cascade` precisely so the proof of erasure outlives the erased.
 */
export async function redactShop(input: { storeId: string; shopDomain: string }): Promise<{
  deleted: boolean;
  counts: RedactionCounts;
}> {
  const counts = await countStoreData(input.storeId);

  try {
    await prisma.store.delete({ where: { id: input.storeId } });
  } catch (err) {
    // Already gone — a redelivery, or a manual purge. Not an error.
    logger.info(
      { storeId: input.storeId, shopDomain: input.shopDomain, err: (err as Error).message },
      'shop/redact found no store to delete',
    );
    return { deleted: false, counts };
  }

  return { deleted: true, counts };
}

async function countStoreData(storeId: string): Promise<RedactionCounts> {
  const [orders, reviews, reviewMedia, questions, requestSends] = await Promise.all([
    prisma.order.count({ where: { storeId } }),
    prisma.review.count({ where: { storeId } }),
    prisma.reviewMedia.count({ where: { storeId } }),
    prisma.question.count({ where: { storeId } }),
    prisma.requestSend.count({ where: { storeId } }),
  ]);

  return { orders, reviews, reviewMedia, questions, requestSends };
}

/**
 * Compile everything held about one customer, for `customers/data_request`.
 *
 * The merchant — not the customer — is the recipient; Shopify's contract is
 * that we hand the data to the store owner, who answers their shopper. So this
 * returns a structure rather than emailing anyone.
 *
 * Emails are returned in plaintext because that is the point of a subject
 * access request. The caller is responsible for auditing the decryption, which
 * is why this is the one function here that reverses encryption at all.
 */
export async function compileDataRequest(input: {
  storeId: string;
  customerEmail: string | null;
  orderGids: string[];
}): Promise<Record<string, unknown>> {
  const emailHash = input.customerEmail ? hashEmail(input.customerEmail) : null;

  const orders = await prisma.order.findMany({
    where: {
      storeId: input.storeId,
      OR: [
        ...(emailHash ? [{ customerEmailHash: emailHash }] : []),
        ...(input.orderGids.length ? [{ shopifyGid: { in: input.orderGids } }] : []),
      ],
    },
    select: {
      shopifyGid: true,
      orderNumber: true,
      customerName: true,
      customerLocale: true,
      processedAt: true,
      fulfilledAt: true,
      lineItems: { select: { title: true, quantity: true, productShopifyGid: true } },
    },
  });

  const reviews = emailHash
    ? await prisma.review.findMany({
        where: { storeId: input.storeId, authorEmailHash: emailHash },
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          authorName: true,
          submittedAt: true,
          publishedAt: true,
          status: true,
          verification: true,
          productId: true,
        },
      })
    : [];

  const questions = emailHash
    ? await prisma.question.findMany({
        where: { storeId: input.storeId, askerEmailHash: emailHash },
        select: { id: true, body: true, askerName: true, createdAt: true, status: true },
      })
    : [];

  const sends = emailHash
    ? await prisma.requestSend.findMany({
        where: { storeId: input.storeId, emailHash },
        select: { scheduledAt: true, sentAt: true, openedAt: true, clickedAt: true, status: true },
      })
    : [];

  const suppressed = emailHash
    ? (await prisma.suppression.count({ where: { storeId: input.storeId, emailHash } })) > 0
    : false;

  return {
    // Echoed back so the merchant can see which subject this describes without
    // us storing the address anywhere new.
    subject: { email: input.customerEmail },
    orders,
    reviews,
    questions,
    emailsSent: sends,
    suppressedFromEmail: suppressed,
    generatedAt: new Date().toISOString(),
  };
}
