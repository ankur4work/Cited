-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopifyGid" TEXT NOT NULL,
    "orderNumber" TEXT,
    "customerEmailEnc" TEXT,
    "customerEmailHash" TEXT,
    "customerName" TEXT,
    "customerLocale" TEXT,
    "currency" TEXT,
    "totalCents" INTEGER,
    "processedAt" TIMESTAMP(3),
    "fulfilledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "requestScheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_items" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productShopifyGid" TEXT,
    "variantShopifyGid" TEXT,
    "productId" TEXT,
    "title" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_storeId_fulfilledAt_idx" ON "orders"("storeId", "fulfilledAt");

-- CreateIndex
CREATE INDEX "orders_storeId_requestScheduledAt_idx" ON "orders"("storeId", "requestScheduledAt");

-- CreateIndex
CREATE INDEX "orders_customerEmailHash_idx" ON "orders"("customerEmailHash");

-- CreateIndex
CREATE UNIQUE INDEX "orders_storeId_shopifyGid_key" ON "orders"("storeId", "shopifyGid");

-- CreateIndex
CREATE INDEX "order_line_items_orderId_idx" ON "order_line_items"("orderId");

-- CreateIndex
CREATE INDEX "order_line_items_storeId_productShopifyGid_idx" ON "order_line_items"("storeId", "productShopifyGid");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
