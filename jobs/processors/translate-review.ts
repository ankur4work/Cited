import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { checkAiEntitlement } from '@/lib/entitlements';
import { ShopifyClient } from '@/lib/shopify/client';
import { MetaobjectError } from '@/lib/shopify/metaobjects';
import {
  publishedLocales,
  translatableDigests,
  registerTranslations,
  missingLocales,
  type TranslationInput,
} from '@/lib/shopify/translations';
import { translateReview, TranslateError } from '@/lib/ai/translate';
import type { AiJobData, AiJobName } from '../queue';

/**
 * Translate one review into every published locale it is missing.
 *
 * Registered with Shopify rather than stored here, so the translated text IS
 * the review in that locale for every surface at once — the storefront in the
 * shopper's language, the Shop app, the merchant's Translate & Adapt admin, and
 * any other app reading the metaobject. Our theme block needs no translation
 * code at all; Shopify serves the right text for the request's locale.
 *
 * Runs after syndication, because a translation attaches to a metaobject and
 * there is nothing to attach to until one exists.
 */
export async function translateReviewProcessor(
  job: Job<AiJobData, unknown, AiJobName>,
): Promise<void> {
  const { storeId, reviewId } = job.data;
  if (!reviewId) throw new Error('ai:translate-review requires reviewId');

  const gate = await checkAiEntitlement(storeId);
  if (!gate.ok) {
    logger.debug({ storeId, reviewId, reason: gate.reason }, 'Translation skipped — not entitled');
    return;
  }

  const review = await prisma.review.findFirst({
    where: { id: reviewId, storeId },
    select: {
      id: true,
      title: true,
      body: true,
      language: true,
      status: true,
      metaobjectGid: true,
      translatedLocales: true,
    },
  });

  if (!review) return;
  // Only published reviews are worth translating. A pending one may never go
  // live, and paying to translate something a merchant is about to reject is
  // spending a store's budget on nothing.
  if (review.status !== 'PUBLISHED' || !review.metaobjectGid) {
    logger.debug({ storeId, reviewId }, 'Translation skipped — not a live metaobject');
    return;
  }
  if (!review.title?.trim() && !review.body?.trim()) return;

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, shopDomain: true, accessToken: true, uninstalledAt: true },
  });
  if (!store || store.uninstalledAt) return;

  const client = new ShopifyClient(store);

  let locales;
  try {
    locales = await publishedLocales(client);
  } catch (err) {
    // The most likely cause is the merchant not yet having re-authorized for
    // `write_translations`. That is a permanent state until they act, so it
    // must not be retried into the dead-letter queue.
    if (err instanceof MetaobjectError && err.terminal) {
      logger.info(
        { storeId, reviewId, err: err.message },
        'Translation unavailable — scope not granted yet',
      );
      return;
    }
    throw err;
  }

  const targets = missingLocales(locales, review.language, review.translatedLocales);

  if (targets.length === 0) {
    logger.debug({ storeId, reviewId }, 'Translation skipped — nothing missing');
    return;
  }

  // Digests are read once and reused across locales. They are a hash of the
  // SOURCE text, which does not change between targets, and re-reading per
  // locale would triple the API cost of a three-language store.
  const digests = await translatableDigests(client, review.metaobjectGid);
  const titleDigest = digests.get('title');
  const bodyDigest = digests.get('body');

  if (!titleDigest && !bodyDigest) {
    logger.info({ storeId, reviewId }, 'Translation skipped — no translatable content on Shopify');
    return;
  }

  const registered: string[] = [];
  let spentCents = 0;

  for (const locale of targets) {
    // Re-checked inside the loop: a store with many locales could otherwise
    // blow well past its cap in a single job.
    const budget = await checkAiEntitlement(storeId);
    if (!budget.ok) {
      logger.info({ storeId, reviewId, locale, reason: budget.reason }, 'Translation budget spent');
      break;
    }

    try {
      const result = await translateReview({
        title: review.title,
        body: review.body,
        sourceLocale: review.language,
        targetLocale: locale,
      });
      spentCents += result.costCents;

      const translations: TranslationInput[] = [];
      if (titleDigest && result.content.title.trim()) {
        translations.push({
          key: 'title',
          locale,
          value: result.content.title,
          translatableContentDigest: titleDigest.digest,
        });
      }
      if (bodyDigest && result.content.body.trim()) {
        translations.push({
          key: 'body',
          locale,
          value: result.content.body,
          translatableContentDigest: bodyDigest.digest,
        });
      }

      await registerTranslations(client, review.metaobjectGid, translations);
      registered.push(locale);
    } catch (err) {
      if (err instanceof TranslateError && !err.retryable) {
        logger.error({ storeId, reviewId, locale, err: err.message }, 'Translation failed');
        continue;
      }
      if (err instanceof MetaobjectError && err.terminal) {
        // Usually a stale digest: the review text moved while we were
        // translating. Abandoning the whole job is right — every remaining
        // locale would be translating superseded wording.
        logger.info(
          { storeId, reviewId, locale, err: err.message },
          'Translation abandoned — source text changed',
        );
        break;
      }
      throw err;
    }
  }

  if (spentCents > 0) {
    await prisma.store.update({
      where: { id: storeId },
      data: { aiCentsUsedMtd: { increment: spentCents } },
    });
  }

  if (registered.length > 0) {
    await prisma.review.update({
      where: { id: review.id },
      data: { translatedLocales: { push: registered } },
    });
  }

  logger.info(
    { storeId, reviewId, registered, attempted: targets.length, costCents: spentCents },
    'Review translations registered',
  );
}
