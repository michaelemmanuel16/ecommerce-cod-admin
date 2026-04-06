-- AlterEnum: Add digital_sale to JournalSourceType (includes period_close from DB)
CREATE TYPE "JournalSourceType_new" AS ENUM ('order_delivery', 'failed_delivery', 'agent_deposit', 'expense', 'payout', 'manual', 'reversal', 'order_return', 'agent_collection', 'inventory_purchase', 'period_close', 'digital_sale');
ALTER TABLE "journal_entries" ALTER COLUMN "source_type" TYPE "JournalSourceType_new" USING ("source_type"::text::"JournalSourceType_new");
ALTER TYPE "JournalSourceType" RENAME TO "JournalSourceType_old";
ALTER TYPE "JournalSourceType_new" RENAME TO "JournalSourceType";
DROP TYPE "JournalSourceType_old";

-- AlterEnum: Add new OrderStatus values
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'payment_pending';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'digital_delivered';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'payment_failed';

-- AlterEnum: Add paid to PaymentStatus
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'paid';

-- AlterTable: Add digital product fields to products
ALTER TABLE "products" ADD COLUMN "product_type" TEXT NOT NULL DEFAULT 'physical',
ADD COLUMN "digital_file_url" TEXT,
ADD COLUMN "digital_file_type" TEXT,
ADD COLUMN "download_link_expiry_hours" INTEGER DEFAULT 72;

-- AlterTable: Add digital order fields to orders
ALTER TABLE "orders" ADD COLUMN "order_type" TEXT NOT NULL DEFAULT 'physical',
ADD COLUMN "payment_method" TEXT NOT NULL DEFAULT 'cod',
ADD COLUMN "payment_reference" TEXT,
ALTER COLUMN "delivery_address" DROP NOT NULL,
ALTER COLUMN "delivery_state" DROP NOT NULL,
ALTER COLUMN "delivery_area" DROP NOT NULL;

-- AlterTable: Add form_type to checkout_forms
ALTER TABLE "checkout_forms" ADD COLUMN "form_type" TEXT NOT NULL DEFAULT 'physical';

-- CreateTable: download_tokens
CREATE TABLE "download_tokens" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "max_downloads" INTEGER NOT NULL DEFAULT 5,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "download_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "download_tokens_token_key" ON "download_tokens"("token");
CREATE INDEX "download_tokens_token_idx" ON "download_tokens"("token");
CREATE INDEX "download_tokens_order_id_idx" ON "download_tokens"("order_id");
CREATE INDEX "download_tokens_expires_at_idx" ON "download_tokens"("expires_at");

-- CreateIndex: new indexes on orders and products
CREATE INDEX "orders_order_type_idx" ON "orders"("order_type");
CREATE INDEX "products_product_type_idx" ON "products"("product_type");

-- AddForeignKey
ALTER TABLE "download_tokens" ADD CONSTRAINT "download_tokens_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
