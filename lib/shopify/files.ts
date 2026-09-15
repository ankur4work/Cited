import { ShopifyClient } from './client';
import { logger } from '../logger';

/**
 * Review photo storage, using Shopify Files.
 *
 * The merchant's own Shopify storage rather than a bucket of ours. That is a
 * deliberate trade: it costs a scope (`write_files`) and puts review images in
 * the merchant's Files admin, but it needs no third-party account, no
 * credentials to leak, and no egress bill — and a merchant who uninstalls
 * keeps their shoppers' photos instead of losing them with us.
 *
 * Uploading is three steps and one wait:
 *   1. stagedUploadsCreate  — Shopify hands back a signed target
 *   2. POST the bytes to that target (multipart, its own parameters)
 *   3. fileCreate           — registers the uploaded resource as a File
 * then the File sits in UPLOADED until Shopify finishes processing and can
 * report a CDN URL.
 */

const STAGED_UPLOADS = /* GraphQL */ `
  mutation CitedStagedUpload($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = /* GraphQL */ `
  mutation CitedFileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        ... on MediaImage { image { url width height } }
      }
      userErrors { field message code }
    }
  }
`;

// One query covers both media types. `node` returns the File interface, so the
// two inline fragments are how we read whichever it turned out to be — and
// asking for both means the backfill job does not need to know the type up
// front to resolve a pending URL.
const FILE_STATUS = /* GraphQL */ `
  query CitedFileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        image { url width height }
      }
      ... on Video {
        fileStatus
        duration
        preview { image { url } }
        sources { url mimeType width height format }
      }
    }
  }
`;

interface FileStatusNode {
  fileStatus?: string;
  image?: { url: string; width: number; height: number } | null;
  duration?: number | null;
  preview?: { image: { url: string } | null } | null;
  sources?: Array<{
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    format: string;
  }> | null;
}

/**
 * Pick the source a storefront should actually play.
 *
 * Shopify transcodes one upload into several renditions. Preferring mp4 is not
 * about quality — it is the only format that plays in a bare <video> element
 * without a JavaScript player, and a zero-JS storefront block is the entire
 * premise of this extension. HLS (.m3u8) renditions are skipped for the same
 * reason: Safari would play them and nothing else would.
 */
function playableSource(
  node: FileStatusNode,
): { url: string; width: number | null; height: number | null } | null {
  const sources = node.sources ?? [];
  const mp4 = sources.filter((s) => s.mimeType === 'video/mp4' || s.format === 'mp4');
  // Largest mp4 rendition by width. Shopify returns several; the smallest is a
  // thumbnail-grade file that looks broken at any reasonable display size.
  const best = mp4.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (!best) return null;
  return { url: best.url, width: best.width, height: best.height };
}

export interface UploadedImage {
  fileGid: string;
  url: string | null;
  width: number | null;
  height: number | null;
}

export class FileUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileUploadError';
  }
}

/** What we accept from a storefront form. Anything else is refused outright. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_REVIEW = 4;

/**
 * Video is deliberately narrower than image.
 *
 * One per review: a review is an opinion, not a vlog, and the second video is
 * almost always the same thing filmed again. 50 MB and these three types cover
 * what a phone camera produces — `video/quicktime` is what iOS sends for a .mov
 * and omitting it would reject most iPhone uploads, which is most uploads.
 */
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEOS_PER_REVIEW = 1;

export async function uploadReviewImage(
  client: ShopifyClient,
  input: { filename: string; mimeType: string; bytes: Buffer },
): Promise<UploadedImage> {
  if (!ALLOWED_IMAGE_TYPES.includes(input.mimeType)) {
    throw new FileUploadError(`Unsupported image type: ${input.mimeType}`);
  }
  if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new FileUploadError('Image is larger than 5 MB');
  }

  // ── 1. Ask Shopify where to put it ───────────────────────────────────
  const staged = await client.graphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(STAGED_UPLOADS, {
    input: [
      {
        filename: safeFilename(input.filename),
        mimeType: input.mimeType,
        resource: 'IMAGE',
        httpMethod: 'POST',
        fileSize: String(input.bytes.byteLength),
      },
    ],
  });

  const errors = staged.data?.stagedUploadsCreate.userErrors ?? [];
  if (errors.length > 0) throw new FileUploadError(errors.map((e) => e.message).join('; '));

  const target = staged.data?.stagedUploadsCreate.stagedTargets?.[0];
  if (!target) throw new FileUploadError('Shopify returned no upload target');

  // ── 2. Send the bytes ────────────────────────────────────────────────
  // The signed parameters MUST be appended before the file field; the storage
  // backend reads them in order and rejects the upload otherwise.
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), safeFilename(input.filename));

  const put = await client.fetchImpl(target.url, { method: 'POST', body: form });
  if (!put.ok) {
    throw new FileUploadError(`Upload to storage failed (${put.status})`);
  }

  // ── 3. Register it as a File ─────────────────────────────────────────
  const created = await client.graphql<{
    fileCreate: {
      files: Array<{ id: string; fileStatus: string; image?: { url: string; width: number; height: number } | null }>;
      userErrors: Array<{ message: string }>;
    };
  }>(FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: 'Customer review photo' }],
  });

  const createErrors = created.data?.fileCreate.userErrors ?? [];
  if (createErrors.length > 0) throw new FileUploadError(createErrors.map((e) => e.message).join('; '));

  const file = created.data?.fileCreate.files?.[0];
  if (!file) throw new FileUploadError('Shopify accepted the upload but returned no file');

  if (file.image?.url) {
    return { fileGid: file.id, url: file.image.url, width: file.image.width, height: file.image.height };
  }

  return { fileGid: file.id, ...(await waitForUrl(client, file.id)) };
}

/**
 * Poll until Shopify has processed the image and can give us a URL.
 *
 * Bounded deliberately. A shopper is waiting on this request, and a photo that
 * is not ready yet is not a failure — the file GID is stored either way, and
 * `backfillImageUrl` can resolve the URL later without asking them to upload
 * anything again.
 */
async function waitForUrl(
  client: ShopifyClient,
  fileGid: string,
  attempts = 5,
): Promise<{ url: string | null; width: number | null; height: number | null }> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    const res = await client.graphql<{
      node: { fileStatus: string; image: { url: string; width: number; height: number } | null } | null;
    }>(FILE_STATUS, { id: fileGid });
    const image = res.data?.node?.image;
    if (image?.url) return { url: image.url, width: image.width, height: image.height };
  }

  logger.info({ fileGid }, 'Review image uploaded but still processing — URL deferred');
  return { url: null, width: null, height: null };
}

export interface UploadedVideo {
  fileGid: string;
  url: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

/**
 * Store a review video in the merchant's Shopify Files.
 *
 * Same three steps as an image, with one behavioural difference that shapes
 * everything downstream: Shopify transcodes video, and transcoding takes far
 * longer than a shopper will wait. So this does NOT poll. It registers the file
 * and returns immediately with a null URL, and `resolveMediaUrl` — driven by
 * the media backfill job — fills it in once Shopify reports READY.
 *
 * Polling here would be the obvious move and the wrong one: it would hold the
 * submission open for however long transcoding takes, and still usually time
 * out with nothing to show for it.
 */
export async function uploadReviewVideo(
  client: ShopifyClient,
  input: { filename: string; mimeType: string; bytes: Buffer },
): Promise<UploadedVideo> {
  if (!ALLOWED_VIDEO_TYPES.includes(input.mimeType)) {
    throw new FileUploadError(`Unsupported video type: ${input.mimeType}`);
  }
  if (input.bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new FileUploadError('Video is larger than 50 MB');
  }

  const staged = await client.graphql<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(STAGED_UPLOADS, {
    input: [
      {
        filename: safeFilename(input.filename, 'video.mp4'),
        mimeType: input.mimeType,
        resource: 'VIDEO',
        httpMethod: 'POST',
        fileSize: String(input.bytes.byteLength),
      },
    ],
  });

  const errors = staged.data?.stagedUploadsCreate.userErrors ?? [];
  if (errors.length > 0) throw new FileUploadError(errors.map((e) => e.message).join('; '));

  const target = staged.data?.stagedUploadsCreate.stagedTargets?.[0];
  if (!target) throw new FileUploadError('Shopify returned no upload target');

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append(
    'file',
    new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }),
    safeFilename(input.filename, 'video.mp4'),
  );

  const put = await client.fetchImpl(target.url, { method: 'POST', body: form });
  if (!put.ok) throw new FileUploadError(`Upload to storage failed (${put.status})`);

  const created = await client.graphql<{
    fileCreate: {
      files: Array<{ id: string; fileStatus: string }>;
      userErrors: Array<{ message: string }>;
    };
  }>(FILE_CREATE, {
    files: [
      { originalSource: target.resourceUrl, contentType: 'VIDEO', alt: 'Customer review video' },
    ],
  });

  const createErrors = created.data?.fileCreate.userErrors ?? [];
  if (createErrors.length > 0) throw new FileUploadError(createErrors.map((e) => e.message).join('; '));

  const file = created.data?.fileCreate.files?.[0];
  if (!file) throw new FileUploadError('Shopify accepted the upload but returned no file');

  logger.info({ fileGid: file.id }, 'Review video uploaded — awaiting transcode');
  return { fileGid: file.id, url: null, posterUrl: null, width: null, height: null, durationSec: null };
}

export interface ResolvedMedia {
  url: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

/**
 * Resolve a stored file's public URL, whichever type it is.
 *
 * Replaces the old image-only `backfillImageUrl`, which was written, never
 * called, and would not have been enough anyway: for images a null URL is a
 * rare race, but for video it is the normal state for the first minute or two,
 * so a review's video simply never appeared without something to come back for
 * it. `null` here means "not ready yet" and is a cue to try again later, not a
 * failure — the file GID is durable and the shopper is never asked to re-upload.
 */
export async function resolveMediaUrl(
  client: ShopifyClient,
  fileGid: string,
): Promise<ResolvedMedia> {
  const res = await client.graphql<{ node: FileStatusNode | null }>(FILE_STATUS, { id: fileGid });
  const node = res.data?.node;
  if (!node) return { url: null, posterUrl: null, width: null, height: null, durationSec: null };

  if (node.image?.url) {
    return {
      url: node.image.url,
      posterUrl: null,
      width: node.image.width,
      height: node.image.height,
      durationSec: null,
    };
  }

  const source = playableSource(node);
  if (source) {
    return {
      url: source.url,
      posterUrl: node.preview?.image?.url ?? null,
      width: source.width,
      height: source.height,
      // Shopify reports duration in MILLISECONDS; the column is seconds.
      // Storing the raw value would put a 35-second clip on the page as
      // "34801 seconds".
      durationSec: node.duration != null ? Math.round(node.duration / 1000) : null,
    };
  }

  return { url: null, posterUrl: null, width: null, height: null, durationSec: null };
}

/**
 * A shopper-supplied filename reaches Shopify's storage backend, so it is
 * reduced to something inert rather than trusted: no paths, no control
 * characters, bounded length.
 */
function safeFilename(raw: string, fallback = 'photo.jpg'): string {
  const base = raw.split(/[\\/]/).pop() ?? fallback;
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
  return cleaned.length > 0 ? cleaned : fallback;
}
