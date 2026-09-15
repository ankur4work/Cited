import type { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ShopifyClient } from '@/lib/shopify/client';
import { resolveMediaUrl } from '@/lib/shopify/files';
import { enqueueReviewSyndication } from '../enqueue';
import type { MaintenanceJobData, MaintenanceJobName } from '../queue';

/**
 * Fill in public URLs for media Shopify had not finished processing.
 *
 * Images usually resolve inside the upload request, so for photos this is a
 * rare race. Video is the opposite: Shopify transcodes it, which takes longer
 * than any shopper will wait, so every review video is stored with a null URL
 * and depends on this job to ever become visible. `backfillImageUrl` existed
 * for the image case and was never called by anything — which was survivable
 * for photos and would have meant video reviews silently never appearing.
 *
 * Runs two ways: once per review shortly after a video upload, and on a
 * schedule as a safety net for anything the targeted pass missed (a transcode
 * slower than the delay, a worker restart mid-job, a transient API failure).
 */
export async function mediaBackfillProcessor(
  job: Job<MaintenanceJobData, unknown, MaintenanceJobName>,
): Promise<void> {
  const { storeId, reviewId } = job.data;

  const pending = await prisma.reviewMedia.findMany({
    where: {
      url: null,
      ...(storeId ? { storeId } : {}),
      ...(reviewId ? { reviewId } : {}),
      // Anything older than a day is not still transcoding — it failed, and
      // re-asking forever would turn a handful of dead rows into a permanent
      // background load against the merchant's API limits.
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    // Bounded so a scheduled pass over a large backlog cannot run unbounded
    // against the Admin API. Whatever it does not reach is picked up next run.
    take: 100,
    orderBy: { createdAt: 'asc' },
    select: { id: true, storeId: true, reviewId: true, r2Key: true, type: true },
  });

  if (pending.length === 0) return;

  // Group by store: every lookup needs that store's own access token, and
  // rebuilding a client per row would re-read the token for each one.
  const byStore = new Map<string, typeof pending>();
  for (const media of pending) {
    const bucket = byStore.get(media.storeId) ?? [];
    bucket.push(media);
    byStore.set(media.storeId, bucket);
  }

  let resolved = 0;
  // Keyed by review, carrying its own store: the scheduled pass runs with no
  // storeId of its own and spans every tenant, so taking it from the job data
  // would send a review's re-syndication to whichever store happened to be in
  // scope — or to `undefined`.
  const touchedReviews = new Map<string, string>();

  for (const [id, items] of byStore) {
    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, shopDomain: true, accessToken: true, uninstalledAt: true },
    });
    if (!store || store.uninstalledAt) continue;

    const client = new ShopifyClient(store);

    for (const media of items) {
      try {
        const result = await resolveMediaUrl(client, media.r2Key);
        // Still processing. Not an error and not worth logging per item — the
        // next scheduled pass will try again.
        if (!result.url) continue;

        await prisma.reviewMedia.update({
          where: { id: media.id },
          data: {
            url: result.url,
            posterKey: result.posterUrl,
            width: result.width,
            height: result.height,
            durationSec: result.durationSec,
          },
        });

        resolved++;
        touchedReviews.set(media.reviewId, media.storeId);
      } catch (err) {
        logger.warn(
          { storeId: store.id, mediaId: media.id, type: media.type, err: (err as Error).message },
          'Media URL backfill failed for one item',
        );
      }
    }
  }

  // The metaobject was written when the review was created, with this media
  // missing from `media_urls` because there was no URL yet. Re-syndicating is
  // what actually puts the video on the storefront — without it the row is
  // correct in our database and the shopper still sees nothing.
  for (const [id, owner] of touchedReviews) {
    await enqueueReviewSyndication({ storeId: owner, reviewId: id });
  }

  logger.info(
    { pending: pending.length, resolved, reviews: touchedReviews.size },
    'Media URL backfill complete',
  );
}
