-- CreateEnum
CREATE TYPE "TransferType" AS ENUM ('allocation', 'order_fulfillment', 'agent_transfer', 'return_to_warehouse', 'adjustment');

-- CreateTable
CREATE TABLE "inventory_transfers" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "transfer_type" "TransferType" NOT NULL,
    "from_agent_id" INTEGER,
    "to_agent_id" INTEGER,
    "order_id" INTEGER,
    "notes" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_stock" (
    "id" SERIAL NOT NULL,
    "agent_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "total_allocated" INTEGER NOT NULL DEFAULT 0,
    "total_fulfilled" INTEGER NOT NULL DEFAULT 0,
    "total_returned" INTEGER NOT NULL DEFAULT 0,
    "total_transfer_in" INTEGER NOT NULL DEFAULT 0,
    "total_transfer_out" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_transfers_product_id_idx" ON "inventory_transfers"("product_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_from_agent_id_idx" ON "inventory_transfers"("from_agent_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_to_agent_id_idx" ON "inventory_transfers"("to_agent_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_transfer_type_idx" ON "inventory_transfers"("transfer_type");

-- CreateIndex
CREATE INDEX "inventory_transfers_created_at_idx" ON "inventory_transfers"("created_at");

-- CreateIndex
CREATE INDEX "inventory_transfers_order_id_idx" ON "inventory_transfers"("order_id");

-- CreateIndex
CREATE INDEX "agent_stock_agent_id_idx" ON "agent_stock"("agent_id");

-- CreateIndex
CREATE INDEX "agent_stock_product_id_idx" ON "agent_stock"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_stock_agent_id_product_id_key" ON "agent_stock"("agent_id", "product_id");

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_agent_id_fkey" FOREIGN KEY ("from_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_agent_id_fkey" FOREIGN KEY ("to_agent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_stock" ADD CONSTRAINT "agent_stock_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_stock" ADD CONSTRAINT "agent_stock_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
