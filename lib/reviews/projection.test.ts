import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shopify/metaobject-payload', () => ({
  reviewMetaobjectHandle: (id: string) => `cited-${id}`,
}));

const { mediaPublicUrl } = await import('./projection');

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
