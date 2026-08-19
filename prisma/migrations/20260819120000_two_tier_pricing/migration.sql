-- Two-tier pricing: Free and Pro. Replaces the three-layer CONVERT/INTEL split.
--
-- Postgres cannot drop a value from an enum in place, so the type is rebuilt
-- and swapped. `stores.plan` is the only column of this type (verified against
-- the schema), which is what keeps the swap to a single ALTER.
--
-- Any store already on a paid tier maps to PRO rather than FREE: mapping the
-- other way would silently strip paid entitlement from a store that is being
-- billed, which is the one direction of this migration that a merchant would
-- notice and we would not.

ALTER TYPE "Plan" RENAME TO "Plan_old";

CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

-- The default references the old type, so it has to go before the column can
-- change type and be restored afterwards.
ALTER TABLE "stores" ALTER COLUMN "plan" DROP DEFAULT;

ALTER TABLE "stores"
  ALTER COLUMN "plan" TYPE "Plan"
  USING (CASE "plan"::text WHEN 'FREE' THEN 'FREE' ELSE 'PRO' END)::"Plan";

ALTER TABLE "stores" ALTER COLUMN "plan" SET DEFAULT 'FREE';

DROP TYPE "Plan_old";
