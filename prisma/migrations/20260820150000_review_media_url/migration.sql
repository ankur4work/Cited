-- Absolute URL for a stored review image.
--
-- ReviewMedia was written for Cloudflare R2, where the row holds an object key
-- and the public URL is derived from a bucket base. Photos now go to Shopify
-- Files instead, which hands back a CDN URL we do not construct and cannot
-- rebuild from a key — so the URL has to be stored.
--
-- Nullable, and r2Key stays: an R2-backed row derives its URL as before, and
-- moving to R2 later means filling this column rather than migrating storage
-- semantics under live data.

ALTER TABLE "review_media" ADD COLUMN IF NOT EXISTS "url" TEXT;
