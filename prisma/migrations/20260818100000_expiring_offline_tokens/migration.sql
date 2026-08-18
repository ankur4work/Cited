-- Expiring offline access tokens.
--
-- Shopify stopped accepting non-expiring offline tokens on the Admin API in
-- Dec 2025: every request with one returns 403 "Non-expiring access tokens are
-- no longer accepted". Tokens are now issued with a 60-minute life plus a
-- 90-day refresh token, so the refresh credential has to be persisted next to
-- the access token.
--
-- Nullable with no backfill on purpose. Existing rows hold a legacy token that
-- cannot be refreshed into a working one — no refresh token was ever issued
-- for it — so those stores must re-authorize. `accessTokenExpiresAt IS NULL`
-- with a token present is exactly that state, and the app now routes it to a
-- reconnect prompt rather than firing doomed API calls.

ALTER TABLE "Store" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Store" ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);
