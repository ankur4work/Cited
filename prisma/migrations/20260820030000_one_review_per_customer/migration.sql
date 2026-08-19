-- One review per email per product, enforced by the database.
--
-- createReview already checked for a duplicate before inserting, but a check
-- followed by an insert is not a constraint: two submissions racing each other
-- both read "no existing review" and both write one. On a public storefront
-- form that is a double-click, not a rare interleaving.
--
-- Partial, for two reasons:
--   * authorEmailHash IS NOT NULL - anonymous reviews carry no identity to
--     deduplicate on, and NULLs would not collide in Postgres anyway.
--   * status <> 'DELETED' - a soft-deleted review must not block the customer
--     from ever reviewing that product again, and the compliance purge leaves
--     DELETED rows in place until retention expires.
--
-- Prisma cannot express a partial unique index in the schema, so this is raw
-- and the client learns about it through the P2002 it raises on conflict.

CREATE UNIQUE INDEX IF NOT EXISTS "reviews_one_per_email_per_product"
  ON "reviews" ("storeId", "productId", "authorEmailHash")
  WHERE "authorEmailHash" IS NOT NULL AND "status" <> 'DELETED';
