-- CreateEnum
CREATE TYPE "ComplianceRequestType" AS ENUM ('DATA_REQUEST', 'CUSTOMER_REDACT', 'SHOP_REDACT');

-- CreateEnum
CREATE TYPE "ComplianceRequestStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditActor" AS ENUM ('MERCHANT', 'STAFF', 'SYSTEM', 'SHOPIFY');

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "redactedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "askerEmailHash" TEXT;

-- CreateIndex
CREATE INDEX "questions_askerEmailHash_idx" ON "questions"("askerEmailHash");

-- CreateTable
CREATE TABLE "compliance_requests" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "type" "ComplianceRequestType" NOT NULL,
    "status" "ComplianceRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "customerShopifyId" TEXT,
    "customerEmailHash" TEXT,
    "orderGids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shopifyWebhookId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "resultJson" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "actor" "AuditActor" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "personalData" BOOLEAN NOT NULL DEFAULT true,
    "recordCount" INTEGER NOT NULL DEFAULT 1,
    "requestId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_requests_shopDomain_type_shopifyWebhookId_key" ON "compliance_requests"("shopDomain", "type", "shopifyWebhookId");

-- CreateIndex
CREATE INDEX "compliance_requests_status_dueAt_idx" ON "compliance_requests"("status", "dueAt");

-- CreateIndex
CREATE INDEX "compliance_requests_storeId_type_idx" ON "compliance_requests"("storeId", "type");

-- CreateIndex
CREATE INDEX "audit_logs_storeId_createdAt_idx" ON "audit_logs"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_personalData_createdAt_idx" ON "audit_logs"("personalData", "createdAt" DESC);

-- AddForeignKey
-- SetNull, not Cascade: a shop/redact completes by deleting the Store, and the
-- ledger row proving the erasure happened must survive that deletion.
ALTER TABLE "compliance_requests" ADD CONSTRAINT "compliance_requests_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
