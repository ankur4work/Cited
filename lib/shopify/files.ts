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

const FILE_STATUS = /* GraphQL */ `
  query CitedFileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        image { url width height }
      }
    }
  }
`;

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

/** Resolve the URL for an image that was still processing when it was stored. */
export async function backfillImageUrl(
  client: ShopifyClient,
  fileGid: string,
): Promise<string | null> {
  const res = await client.graphql<{ node: { image: { url: string } | null } | null }>(FILE_STATUS, {
    id: fileGid,
  });
  return res.data?.node?.image?.url ?? null;
}

/**
 * A shopper-supplied filename reaches Shopify's storage backend, so it is
 * reduced to something inert rather than trusted: no paths, no control
 * characters, bounded length.
 */
function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'photo';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
  return cleaned.length > 0 ? cleaned : 'photo.jpg';
}
