-- Third pricing tier: SCALE ($299) above PRO ($49).
--
-- Additive only. Unlike the two-tier migration, this does NOT rebuild the enum
-- type: every existing value keeps its meaning, so there is nothing to remap
-- and no window in which a store's plan is ambiguous.
--
-- `ADD VALUE` is deliberately the whole migration. Postgres permits it inside a
-- transaction (which is how Prisma runs migrations) only as long as the new
-- value is not also *used* in that same transaction — so backfilling any store
-- onto SCALE here would fail. There is nothing to backfill in any case: no
-- merchant can hold a subscription to a plan that did not exist until now, and
-- the plan is re-resolved from Shopify on the next app_subscriptions/update.

ALTER TYPE "Plan" ADD VALUE IF NOT EXISTS 'SCALE';
