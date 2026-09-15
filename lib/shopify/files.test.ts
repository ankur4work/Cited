import { describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ env: {} }));
vi.mock('./client', () => ({ ShopifyClient: class {} }));
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveMediaUrl, uploadReviewVideo, ALLOWED_VIDEO_TYPES, MAX_VIDEO_BYTES } = await import(
  './files'
);

/** Minimal stand-in: resolveMediaUrl only ever calls `graphql`. */
function clientReturning(node: unknown) {
  return { graphql: vi.fn().mockResolvedValue({ data: { node } }) } as never;
}

describe('resolveMediaUrl — images', () => {
  it('returns the image URL and dimensions once processed', async () => {
    const result = await resolveMediaUrl(
      clientReturning({ fileStatus: 'READY', image: { url: 'https://cdn/x.jpg', width: 800, height: 600 } }),
      'gid://shopify/MediaImage/1',
    );
    expect(result).toEqual({
      url: 'https://cdn/x.jpg',
      posterUrl: null,
      width: 800,
      height: 600,
      durationSec: null,
    });
  });
});

describe('resolveMediaUrl — videos', () => {
  const sources = [
    { url: 'https://cdn/small.mp4', mimeType: 'video/mp4', width: 480, height: 270, format: 'mp4' },
    { url: 'https://cdn/large.mp4', mimeType: 'video/mp4', width: 1920, height: 1080, format: 'mp4' },
    { url: 'https://cdn/stream.m3u8', mimeType: 'application/x-mpegURL', width: 1920, height: 1080, format: 'm3u8' },
  ];

  it('picks the largest mp4 rendition', async () => {
    // Shopify returns several renditions. The smallest is thumbnail-grade and
    // looks broken at any size a review list would display it.
    const result = await resolveMediaUrl(
      clientReturning({ fileStatus: 'READY', duration: 34801, preview: null, sources }),
      'gid://shopify/Video/1',
    );
    expect(result.url).toBe('https://cdn/large.mp4');
    expect(result.width).toBe(1920);
  });

  it('never picks an HLS rendition', async () => {
    // The block is zero-JavaScript by design; a bare <video> plays .m3u8 in
    // Safari and nowhere else, so choosing it would break most browsers.
    const hlsOnly = [sources[2]];
    const result = await resolveMediaUrl(
      clientReturning({ fileStatus: 'READY', duration: 1000, sources: hlsOnly }),
      'gid://shopify/Video/2',
    );
    expect(result.url).toBeNull();
  });

  it('converts duration from milliseconds to seconds', async () => {
    // Shopify reports duration in ms and the column is seconds. Storing the
    // raw value would render a 35-second clip as "34801 seconds".
    const result = await resolveMediaUrl(
      clientReturning({ fileStatus: 'READY', duration: 34801, sources }),
      'gid://shopify/Video/3',
    );
    expect(result.durationSec).toBe(35);
  });

  it('carries the preview image through as the poster', async () => {
    const result = await resolveMediaUrl(
      clientReturning({
        fileStatus: 'READY',
        duration: 5000,
        preview: { image: { url: 'https://cdn/poster.jpg' } },
        sources,
      }),
      'gid://shopify/Video/4',
    );
    expect(result.posterUrl).toBe('https://cdn/poster.jpg');
  });

  it('reports "not ready" rather than failing while a video is still transcoding', async () => {
    // The normal state for the first minute or two after upload. A null URL is
    // a cue for the backfill job to try again, not an error — the file GID is
    // durable and the shopper is never asked to re-upload.
    const result = await resolveMediaUrl(
      clientReturning({ fileStatus: 'PROCESSING', duration: null, sources: [] }),
      'gid://shopify/Video/5',
    );
    expect(result.url).toBeNull();
    expect(result.durationSec).toBeNull();
  });

  it('handles a file that no longer exists', async () => {
    const result = await resolveMediaUrl(clientReturning(null), 'gid://shopify/Video/6');
    expect(result.url).toBeNull();
  });
});

describe('uploadReviewVideo — input validation', () => {
  it('accepts what a phone camera actually produces', () => {
    // iOS sends video/quicktime for a .mov. Omitting it would reject most
    // phone uploads, which is most uploads.
    expect(ALLOWED_VIDEO_TYPES).toContain('video/quicktime');
    expect(ALLOWED_VIDEO_TYPES).toContain('video/mp4');
  });

  it('refuses an unsupported type before uploading anything', async () => {
    const client = clientReturning(null);
    await expect(
      uploadReviewVideo(client, {
        filename: 'clip.avi',
        mimeType: 'video/x-msvideo',
        bytes: Buffer.from('x'),
      }),
    ).rejects.toThrow(/Unsupported video type/);
  });

  it('refuses an oversized file before uploading anything', async () => {
    const client = clientReturning(null);
    await expect(
      uploadReviewVideo(client, {
        filename: 'big.mp4',
        mimeType: 'video/mp4',
        bytes: Buffer.alloc(MAX_VIDEO_BYTES + 1),
      }),
    ).rejects.toThrow(/larger than 50 MB/);
  });
});
