-- Review translations: which locales each review has been registered in.
--
-- Additive, defaulting to an empty array. No backfill: nothing has been
-- translated yet, and an empty array is exactly "not translated", so every
-- existing row is already correct.

ALTER TABLE "reviews"
  ADD COLUMN "translatedLocales" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
