/*
  Warnings:

  - You are about to drop the column `scopes` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `subscriptionGid` on the `stores` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "stores" DROP COLUMN "scopes",
DROP COLUMN "subscriptionGid",
ADD COLUMN     "accessTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "graceEndsAt" TIMESTAMP(3),
ADD COLUMN     "scheduledRedactAt" TIMESTAMP(3),
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "shopifyChargeId" TEXT;

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "shopifyChargeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_events_storeId_createdAt_idx" ON "billing_events"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "stores_scheduledRedactAt_idx" ON "stores"("scheduledRedactAt");

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
