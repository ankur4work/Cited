-- Expiring offline access tokens.
--
-- Shopify stopped accepting non-expiring offline tokens on the Admin API in
-- Dec 2025: every request with one returns 403 "Non-expiring access tokens are
-- no longer accepted". Tokens are now issued with a 60-minute life plus a
-- 90-day refresh token, so the refresh credential has to be persisted next to
-- the access token.
--
-- The table is "stores", NOT "Store". Every model in schema.prisma carries an
-- @@map to a snake_case plural, so the Prisma model name never appears in SQL.
-- Getting this wrong took the site down: the migration failed with 42P01, and
-- `migrate deploy` then refused to start the app at all (P3009) on every
-- subsequent boot. Generate migrations with `prisma migrate dev` rather than
-- writing them by hand, and this cannot happen.
--
-- Nullable with no backfill on purpose. Existing rows hold a legacy token that
-- cannot be refreshed into a working one — no refresh token was ever issued
-- for it — so those stores must re-authorize. `accessTokenExpiresAt IS NULL`
-- with a token present is exactly that state, and the app now routes it to a
-- reconnect prompt rather than firing doomed API calls.

ALTER TABLE "stores" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "stores" ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);
