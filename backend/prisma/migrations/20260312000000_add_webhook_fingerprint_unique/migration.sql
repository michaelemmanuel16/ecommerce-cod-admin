-- AlterTable
ALTER TABLE "orders" ADD COLUMN "webhook_fingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_webhook_fingerprint_key" ON "orders"("webhook_fingerprint");
