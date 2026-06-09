-- CreateTable
CREATE TABLE "pending_checkouts" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "form_id" INTEGER NOT NULL,
    "payment_method" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "shipping_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "cod_amount" DOUBLE PRECISION,
    "balance_due" INTEGER NOT NULL DEFAULT 0,
    "paystack_charge_minor" INTEGER NOT NULL,
    "order_items" JSONB NOT NULL,
    "form_data" JSONB NOT NULL,
    "selected_package" JSONB NOT NULL,
    "selected_upsells" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_checkouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_checkouts_reference_key" ON "pending_checkouts"("reference");

-- CreateIndex
CREATE INDEX "pending_checkouts_created_at_idx" ON "pending_checkouts"("created_at");
