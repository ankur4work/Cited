import type { Job } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { checkAiEntitlement } from '@/lib/entitlements';
import { ShopifyClient } from '@/lib/shopify/client';
import { setProductSummaryMetafield, MetaobjectError } from '@/lib/shopify/metaobjects';
import {
  summarizeProductReviews,
  SummarizeError,
  isRenderable,
  type StoredSummary,
} from '@/lib/ai/summarize';
import { relevanceScore } from '@/lib/reviews/relevance';
import type { AiJobData, AiJobName } from '../queue';

/**
 * Regenerate one product's AI review summary and publish it to the storefront.
 *
 * Enqueued from the aggregate syndication job, which already fires on every
 * change to a product's published review set and is already debounced — so a
 * burst of reviews produces one summary rather than one per review.
 *
 * This is the first processor gated on `Store.plan`. It returns instead of
 * throwing on every denial: a Free store is not a transient failure, and
 * throwing would hand it to BullMQ's exponential backoff to be retried three
 * times before landing in the dead-letter queue, where it would look like an
 * outage rather than a store that has not upgraded.
 */
export async function summarizeProductProcessor(
  job: Job<AiJobData, unknown, AiJobName>,
): Promise<void> {
  const { storeId, productId } = job.data;
  if (!productId) throw new Error('ai:summarize-product requires productId');

  const gate = await checkAiEntitlement(storeId);
  if (!gate.ok) {
    logger.debug({ storeId, productId, reason: gate.reason }, 'Summary skipped — not entitled');
    return;
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, storeId },
    select: { id: true, title: true, shopifyGid: true },
  });
  if (!product) {
    logger.debug({ storeId, productId }, 'Summary skipped — product not found');
    return;
  }

  const existing = await prisma.summary.findUnique({
    where: { productId },
    select: { id: true, reviewCountAtGen: true },
  });

  const publishedCount = await prisma.review.count({
    where: { storeId, productId, status: 'PUBLISHED' },
  });

  // Below the floor a summary cannot carry mention counts, and a claim with
  // nothing behind it is the one thing this feature must never render. If a
  // summary already exists — reviews were hidden, redacted or deleted since —
  // retract it rather than leaving a stale one on the page.
  if (publishedCount < env.AI_SUMMARY_MIN_REVIEWS) {
    if (existing) {
      await retract({ storeId, productId, productGid: product.shopifyGid });
      logger.info(
        { storeId, productId, publishedCount },
        'Summary retracted — review count fell below threshold',
      );
    }
    return;
  }

  // Cost control: regenerate on material change, not on every trigger. Without
  // this a store with steady review flow would re-summarise its whole catalogue
  // continuously and the only thing that would change is the bill.
  if (existing && publishedCount < existing.reviewCountAtGen + env.AI_SUMMARY_REGEN_DELTA) {
    logger.debug(
      { storeId, productId, publishedCount, at: existing.reviewCountAtGen },
      'Summary still fresh — regeneration skipped',
    );
    return;
  }

  const reviews = await prisma.review.findMany({
    where: { storeId, productId, status: 'PUBLISHED' },
    orderBy: { submittedAt: 'desc' },
    take: env.AI_SUMMARY_MAX_REVIEWS,
    select: {
      id: true,
      rating: true,
      title: true,
      body: true,
      authorName: true,
      helpfulCount: true,
      notHelpfulCount: true,
      verification: true,
      submittedAt: true,
      _count: { select: { media: true } },
    },
  });

  // A review row with no title and no body is a bare star rating. It counts
  // toward the aggregate but contributes no text, so sending it costs tokens
  // and tells the model nothing.
  const withText = reviews.filter((r) => (r.title ?? r.body ?? '').trim().length > 0);
  if (withText.length < env.AI_SUMMARY_MIN_REVIEWS) {
    logger.debug(
      { storeId, productId, withText: withText.length },
      'Summary skipped — not enough reviews carry text',
    );
    return;
  }

  let result;
  try {
    result = await summarizeProductReviews({
      productTitle: product.title,
      reviews: withText.map((r) => ({
        rating: r.rating,
        title: r.title,
        body: r.body,
        authorName: r.authorName,
      })),
    });
  } catch (err) {
    if (err instanceof SummarizeError && !err.retryable) {
      logger.error({ storeId, productId, err: err.message }, 'Summary failed permanently');
      return;
    }
    throw err;
  }

  // Debit first. If the write below fails and the job retries, the spend has
  // still happened — a budget that is only debited on full success is a budget
  // that can be overrun by anything that fails late.
  await prisma.store.update({
    where: { id: storeId },
    data: { aiCentsUsedMtd: { increment: result.costCents } },
  });

  // Smart sorting. Rescored here rather than in its own job because this is the
  // one moment both inputs are in hand: the deterministic signals just loaded
  // above, and the model's view of which reviews were worth quoting. One clock
  // for the whole batch, so the recency term cannot drift mid-loop.
  await rescore(withText, new Set(result.highlightedIndexes));

  if (!isRenderable(result.content)) {
    // Every point the model raised fell below the two-mention floor. That is a
    // legitimate outcome for a corpus with no consensus, and rendering the
    // empty shell of a summary would imply we found nothing worth saying about
    // a product people liked.
    if (existing) await retract({ storeId, productId, productGid: product.shopifyGid });
    logger.info({ storeId, productId }, 'Summary produced no supported points — nothing rendered');
    return;
  }

  await prisma.summary.upsert({
    where: { productId },
    create: {
      storeId,
      productId,
      model: result.model,
      // Prisma's InputJsonValue demands an index signature, which a named
      // interface does not have. The shape is plain JSON by construction —
      // it came out of a JSON schema — so the cast asserts what the type
      // system cannot see rather than papering over a real mismatch.
      contentJson: result.content as unknown as Prisma.InputJsonObject,
      reviewCountAtGen: publishedCount,
      costCents: result.costCents,
    },
    update: {
      model: result.model,
      // Prisma's InputJsonValue demands an index signature, which a named
      // interface does not have. The shape is plain JSON by construction —
      // it came out of a JSON schema — so the cast asserts what the type
      // system cannot see rather than papering over a real mismatch.
      contentJson: result.content as unknown as Prisma.InputJsonObject,
      reviewCountAtGen: publishedCount,
      costCents: result.costCents,
      generatedAt: new Date(),
    },
  });

  await publish({ storeId, productGid: product.shopifyGid, summary: result.content });

  logger.info(
    {
      storeId,
      productId,
      reviews: withText.length,
      pros: result.content.pros.length,
      cons: result.content.cons.length,
      highlights: result.content.highlights.length,
      costCents: result.costCents,
    },
    'Product summary published',
  );
}

interface ScorableRow {
  id: string;
  rating: number;
  body: string | null;
  helpfulCount: number;
  notHelpfulCount: number;
  verification: 'VERIFIED_BUYER' | 'VERIFIED_REVIEWER' | 'UNVERIFIED';
  submittedAt: Date;
  _count: { media: number };
}

/**
 * Recompute relevance for the reviews that were summarised.
 *
 * Only the sampled window is rescored — the newest AI_SUMMARY_MAX_REVIEWS — not
 * the whole product. Reviews outside it keep whatever score they had, which is
 * correct: they were not candidates for the storefront list anyway, and
 * rescoring thousands of rows on every summary regeneration would make the cost
 * of this feature a function of catalogue age.
 */
async function rescore(rows: ScorableRow[], highlighted: Set<number>): Promise<void> {
  const now = new Date();

  await Promise.all(
    rows.map((row, i) =>
      prisma.review.update({
        where: { id: row.id },
        data: {
          relevanceScore: relevanceScore(
            {
              rating: row.rating,
              body: row.body,
              helpfulCount: row.helpfulCount,
              notHelpfulCount: row.notHelpfulCount,
              verification: row.verification,
              mediaCount: row._count.media,
              submittedAt: row.submittedAt,
              highlighted: highlighted.has(i),
            },
            now,
          ),
        },
      }),
    ),
  );
}

/** Drop the stored summary and clear the storefront metafield together. */
async function retract(input: {
  storeId: string;
  productId: string;
  productGid: string;
}): Promise<void> {
  await prisma.summary.deleteMany({ where: { productId: input.productId } });
  await publish({ storeId: input.storeId, productGid: input.productGid, summary: null });
}

/**
 * Push the summary to the product metafield the theme block reads.
 *
 * Note this needs `write_products`, which every install has — NOT the
 * restricted `write_product_reviews`. A store still waiting on Shopify's review
 * scope approval gets summaries today.
 */
async function publish(input: {
  storeId: string;
  productGid: string;
  summary: StoredSummary | null;
}): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { id: input.storeId },
    select: { id: true, shopDomain: true, accessToken: true, uninstalledAt: true },
  });
  if (!store || store.uninstalledAt) return;

  try {
    await setProductSummaryMetafield(new ShopifyClient(store), {
      productGid: input.productGid,
      summary: input.summary,
    });
  } catch (err) {
    if (err instanceof MetaobjectError && err.terminal) {
      logger.error(
        { storeId: input.storeId, productGid: input.productGid, err: err.message },
        'Summary metafield write failed permanently',
      );
      return;
    }
    throw err;
  }
}
