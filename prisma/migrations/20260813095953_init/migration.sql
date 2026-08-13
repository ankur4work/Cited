-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'CONVERT', 'INTEL');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'HIDDEN', 'SPAM', 'DELETED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED_BUYER', 'VERIFIED_REVIEWER', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "ReviewSource" AS ENUM ('NATIVE', 'IMPORT', 'SYNDICATED', 'MANUAL');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('JUDGE_ME', 'LOOX', 'YOTPO', 'OKENDO', 'STAMPED', 'FERA', 'AMAZON', 'ETSY', 'ALIEXPRESS', 'SHOPIFY_METAOBJECT', 'CSV');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignTrigger" AS ENUM ('ORDER_FULFILLED', 'ORDER_DELIVERED', 'ORDER_PAID', 'MANUAL');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('SCHEDULED', 'SENT', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('DEFECT', 'SIZING', 'DEMAND', 'PRAISE', 'SHIPPING', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AeoEngine" AS ENUM ('CHATGPT', 'GEMINI', 'PERPLEXITY', 'CLAUDE', 'GOOGLE_AI_OVERVIEW');

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyGid" TEXT,
    "name" TEXT,
    "email" TEXT,
    "countryCode" TEXT,
    "currency" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "primaryLocale" TEXT NOT NULL DEFAULT 'en',
    "accessToken" TEXT,
    "scopes" TEXT,
    "reviewScopeGranted" BOOLEAN NOT NULL DEFAULT false,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "subscriptionGid" TEXT,
    "planUpdatedAt" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "onboardingStep" TEXT NOT NULL DEFAULT 'connect',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "analyticsPixelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gdprMode" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "mediaBytesUsed" BIGINT NOT NULL DEFAULT 0,
    "aiCentsUsedMtd" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" TEXT,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "ratingBreakdown" JSONB NOT NULL DEFAULT '{}',
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_groups" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "authorName" TEXT,
    "authorEmailEnc" TEXT,
    "authorEmailHash" TEXT,
    "orderShopifyGid" TEXT,
    "variantShopifyGid" TEXT,
    "merchantReply" TEXT,
    "merchantRepliedAt" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'en',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "verification" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "source" "ReviewSource" NOT NULL DEFAULT 'NATIVE',
    "sourceLabel" TEXT NOT NULL DEFAULT 'cited',
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "metaobjectGid" TEXT,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "syncAttempts" INTEGER NOT NULL DEFAULT 0,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "fraudScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fraudReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "notHelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(384),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_media" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "r2Key" TEXT NOT NULL,
    "posterKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" INTEGER,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "mimeType" TEXT,
    "moderation" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_attributes" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "review_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_votes" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "voterHash" TEXT NOT NULL,
    "helpful" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "askerName" TEXT,
    "askerEmailEnc" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "answers" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorType" TEXT NOT NULL DEFAULT 'merchant',
    "citations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_campaigns" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "CampaignTrigger" NOT NULL DEFAULT 'ORDER_FULFILLED',
    "delayHours" INTEGER NOT NULL DEFAULT 168,
    "subject" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL DEFAULT 'default',
    "templateJson" JSONB NOT NULL DEFAULT '{}',
    "reminderCount" INTEGER NOT NULL DEFAULT 1,
    "reminderDelayHours" INTEGER NOT NULL DEFAULT 168,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_sends" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "orderShopifyGid" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "emailEnc" TEXT,
    "status" "SendStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "reminderIndex" INTEGER NOT NULL DEFAULT 0,
    "providerId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppressions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "resumeCursor" TEXT,
    "mappingJson" JSONB NOT NULL DEFAULT '{}',
    "reportJson" JSONB NOT NULL DEFAULT '{}',
    "previewOnly" BOOLEAN NOT NULL DEFAULT true,
    "committedAt" TIMESTAMP(3),
    "sourceFileKey" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "summaries" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "contentJson" JSONB NOT NULL,
    "reviewCountAtGen" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 0,
    "reviewIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clusterJson" JSONB NOT NULL DEFAULT '{}',
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aeo_probes" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "engine" "AeoEngine" NOT NULL,
    "prompt" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER,
    "sentiment" DOUBLE PRECISION,
    "competitors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "citedUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawResponse" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aeo_probes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "topic" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_shopDomain_key" ON "stores"("shopDomain");

-- CreateIndex
CREATE INDEX "stores_plan_idx" ON "stores"("plan");

-- CreateIndex
CREATE INDEX "stores_uninstalledAt_idx" ON "stores"("uninstalledAt");

-- CreateIndex
CREATE INDEX "products_storeId_handle_idx" ON "products"("storeId", "handle");

-- CreateIndex
CREATE INDEX "products_storeId_groupId_idx" ON "products"("storeId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "products_storeId_shopifyGid_key" ON "products"("storeId", "shopifyGid");

-- CreateIndex
CREATE INDEX "review_groups_storeId_idx" ON "review_groups"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_metaobjectGid_key" ON "reviews"("metaobjectGid");

-- CreateIndex
CREATE INDEX "reviews_storeId_productId_status_publishedAt_idx" ON "reviews"("storeId", "productId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "reviews_storeId_status_submittedAt_idx" ON "reviews"("storeId", "status", "submittedAt" DESC);

-- CreateIndex
CREATE INDEX "reviews_storeId_syncStatus_idx" ON "reviews"("storeId", "syncStatus");

-- CreateIndex
CREATE INDEX "reviews_storeId_rating_idx" ON "reviews"("storeId", "rating");

-- CreateIndex
CREATE INDEX "reviews_authorEmailHash_idx" ON "reviews"("authorEmailHash");

-- CreateIndex
CREATE INDEX "reviews_orderShopifyGid_idx" ON "reviews"("orderShopifyGid");

-- CreateIndex
CREATE INDEX "review_media_storeId_idx" ON "review_media"("storeId");

-- CreateIndex
CREATE INDEX "review_media_reviewId_position_idx" ON "review_media"("reviewId", "position");

-- CreateIndex
CREATE INDEX "review_attributes_storeId_key_value_idx" ON "review_attributes"("storeId", "key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "review_attributes_reviewId_key_key" ON "review_attributes"("reviewId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "review_votes_reviewId_voterHash_key" ON "review_votes"("reviewId", "voterHash");

-- CreateIndex
CREATE INDEX "questions_storeId_productId_status_idx" ON "questions"("storeId", "productId", "status");

-- CreateIndex
CREATE INDEX "answers_questionId_idx" ON "answers"("questionId");

-- CreateIndex
CREATE INDEX "request_campaigns_storeId_enabled_idx" ON "request_campaigns"("storeId", "enabled");

-- CreateIndex
CREATE INDEX "request_sends_storeId_status_scheduledAt_idx" ON "request_sends"("storeId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "request_sends_emailHash_idx" ON "request_sends"("emailHash");

-- CreateIndex
CREATE UNIQUE INDEX "request_sends_campaignId_orderShopifyGid_reminderIndex_key" ON "request_sends"("campaignId", "orderShopifyGid", "reminderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "suppressions_storeId_emailHash_key" ON "suppressions"("storeId", "emailHash");

-- CreateIndex
CREATE INDEX "import_jobs_storeId_status_idx" ON "import_jobs"("storeId", "status");

-- CreateIndex
CREATE INDEX "summaries_storeId_idx" ON "summaries"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "summaries_productId_key" ON "summaries"("productId");

-- CreateIndex
CREATE INDEX "insights_storeId_type_detectedAt_idx" ON "insights"("storeId", "type", "detectedAt" DESC);

-- CreateIndex
CREATE INDEX "insights_storeId_acknowledged_idx" ON "insights"("storeId", "acknowledged");

-- CreateIndex
CREATE INDEX "aeo_probes_storeId_engine_ranAt_idx" ON "aeo_probes"("storeId", "engine", "ranAt" DESC);

-- CreateIndex
CREATE INDEX "webhook_events_storeId_topic_idx" ON "webhook_events"("storeId", "topic");

-- CreateIndex
CREATE INDEX "webhook_events_processedAt_idx" ON "webhook_events"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_topic_shopifyId_key" ON "webhook_events"("topic", "shopifyId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "review_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_groups" ADD CONSTRAINT "review_groups_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_media" ADD CONSTRAINT "review_media_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_attributes" ADD CONSTRAINT "review_attributes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_votes" ADD CONSTRAINT "review_votes_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "answers" ADD CONSTRAINT "answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_campaigns" ADD CONSTRAINT "request_campaigns_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sends" ADD CONSTRAINT "request_sends_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_sends" ADD CONSTRAINT "request_sends_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "request_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aeo_probes" ADD CONSTRAINT "aeo_probes_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
