-- M3b-T02 (COD-31): PaymentConnection, form archive and provider columns, provider and fee fields on orders, transactions and pending checkouts.
-- AlterTable
ALTER TABLE "checkout_forms" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "payment_provider" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "payment_provider" TEXT;

-- AlterTable
ALTER TABLE "pending_checkouts" ADD COLUMN     "last_checked_at" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'paystack',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'initiated';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "fee_amount" DECIMAL(19,4),
ADD COLUMN     "fee_unknown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "provider_reference" TEXT;

-- CreateTable
CREATE TABLE "payment_connections" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "public_key" TEXT,
    "secret_key" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "supported_currencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_connections_tenant_id_idx" ON "payment_connections"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_connections_tenant_id_provider_key" ON "payment_connections"("tenant_id", "provider");

-- AddForeignKey
ALTER TABLE "payment_connections" ADD CONSTRAINT "payment_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Backfill: every online payment taken so far went through Paystack.
UPDATE "orders" SET "payment_provider" = 'paystack' WHERE "payment_method" IN ('paystack', 'paystack_full', 'paystack_deposit');
UPDATE "transactions" SET "provider" = 'paystack' WHERE "payment_method" = 'paystack';
