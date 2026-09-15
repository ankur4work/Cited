-- Smart sorting: a relevance score per review, replacing "newest first" as the
-- storefront ordering.
--
-- Defaults to 0 for every existing row rather than being backfilled here. The
-- score is derived from data this migration has no business recomputing in a
-- transaction (vote counts, media, body length), and the summary job rescores a
-- product the next time it runs. Until then a store simply keeps its current
-- ordering, which is the correct degradation: no review disappears, none jumps.

ALTER TABLE "reviews" ADD COLUMN "relevanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX "reviews_storeId_productId_status_relevanceScore_idx"
  ON "reviews" ("storeId", "productId", "status", "relevanceScore" DESC);
