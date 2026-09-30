import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shopify/metaobject-payload', () => ({
  reviewMetaobjectHandle: (id: string) => `cited-${id}`,
}));

const { mediaPublicUrl, reviewMetaobjectInput } = await import('./projection');

/** A published review with everything the projection needs and no media. */
function reviewFixture(
  media: Array<{ r2Key: string; url?: string | null }> = [],
): Parameters<typeof reviewMetaobjectInput>[0] {
  return {
    id: 'rev_1',
    rating: 5,
    title: 'Good',
    body: 'Works well.',
    authorName: 'Sam',
    orderShopifyGid: null,
    variantShopifyGid: null,
    merchantReply: null,
    merchantRepliedAt: null,
    language: 'en',
    submittedAt: new Date('2026-09-30T10:00:00Z'),
    publishedAt: new Date('2026-09-30T10:00:00Z'),
    verification: 'UNVERIFIED',
    sourceLabel: 'cited:storefront',
    status: 'PUBLISHED',
    product: { shopifyGid: 'gid://shopify/Product/1' },
    media,
  };
}

const original = process.env.R2_PUBLIC_BASE_URL;
afterEach(() => {
  if (original === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = original;
});

describe('mediaPublicUrl', () => {
  it('builds a bucket URL for an R2-backed object', () => {
    process.env.R2_PUBLIC_BASE_URL = 'https://media.example.com';
    expect(mediaPublicUrl('reviews/abc.jpg')).toBe('https://media.example.com/reviews/abc.jpg');
  });

  it('tolerates a trailing slash on the base', () => {
    process.env.R2_PUBLIC_BASE_URL = 'https://media.example.com/';
    expect(mediaPublicUrl('reviews/abc.jpg')).toBe('https://media.example.com/reviews/abc.jpg');
  });

  it('returns null when no bucket is configured', () => {
    delete process.env.R2_PUBLIC_BASE_URL;
    expect(mediaPublicUrl('reviews/abc.jpg')).toBeNull();
  });

  it('never derives a URL from a Shopify file GID', () => {
    // Shopify-Files-backed media stores the file GID in this column. Prefixing
    // the bucket onto it produces a syntactically valid, entirely broken URL —
    // and because it is non-null it reaches the metaobject's media_urls and
    // renders on the storefront as a dead image. Latent for photos, whose URL
    // usually resolves during upload; the default path for video, which is
    // always pending until the transcode finishes.
    process.env.R2_PUBLIC_BASE_URL = 'https://media.example.com';
    expect(mediaPublicUrl('gid://shopify/Video/123')).toBeNull();
    expect(mediaPublicUrl('gid://shopify/MediaImage/456')).toBeNull();
  });
});

/*
 * These exist because review photos never once reached a storefront.
 *
 * A shopper attached a photo, the response came back carrying a real Shopify
 * CDN URL, they saw it on their own review — and nobody else ever did. Two
 * faults stacked: syndication was queued by `createReview` before the upload
 * finished, so the metaobject was written with no media and nothing revisited
 * it; and the storefront then could not iterate the field it was handed.
 *
 * This half of it is the contract the projection owes: given media rows with
 * URLs, `mediaUrls` carries them. Nothing asserted that, which is how it
 * shipped empty and stayed empty.
 */
describe('reviewMetaobjectInput — media', () => {
  it('carries the URL of an uploaded photo', () => {
    const input = reviewMetaobjectInput(
      reviewFixture([
        { r2Key: 'gid://shopify/MediaImage/1', url: 'https://cdn.shopify.com/s/files/1/photo.png' },
      ]),
    );

    expect(input.mediaUrls).toEqual(['https://cdn.shopify.com/s/files/1/photo.png']);
  });

  it('keeps media in the order the rows were given', () => {
    const input = reviewMetaobjectInput(
      reviewFixture([
        { r2Key: 'gid://shopify/MediaImage/1', url: 'https://cdn.shopify.com/a.png' },
        { r2Key: 'gid://shopify/MediaImage/2', url: 'https://cdn.shopify.com/b.png' },
      ]),
    );

    expect(input.mediaUrls).toEqual(['https://cdn.shopify.com/a.png', 'https://cdn.shopify.com/b.png']);
  });

  /*
   * A video is registered the instant it is uploaded and has no URL until the
   * transcode finishes. Emitting something derived from the GID would put a
   * dead image on the merchant's storefront, so the row is skipped until the
   * media backfill resolves it and re-syndicates.
   */
  it('omits media that has no URL yet rather than inventing one', () => {
    const input = reviewMetaobjectInput(
      reviewFixture([
        { r2Key: 'gid://shopify/Video/9', url: null },
        { r2Key: 'gid://shopify/MediaImage/1', url: 'https://cdn.shopify.com/a.png' },
      ]),
    );

    expect(input.mediaUrls).toEqual(['https://cdn.shopify.com/a.png']);
  });

  it('is an empty list, not undefined, for a review with no media', () => {
    expect(reviewMetaobjectInput(reviewFixture()).mediaUrls).toEqual([]);
  });
});
