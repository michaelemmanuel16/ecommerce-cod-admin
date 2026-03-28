-- AlterEnum
ALTER TYPE "JournalSourceType" ADD VALUE 'inventory_purchase';

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('pending', 'arrived');

-- CreateTable
CREATE TABLE "inventory_shipments" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "supplier" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "shipping_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customs_duties" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "other_costs" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'pending',
    "expected_arrival_date" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "gl_journal_entry_id" INTEGER,
    "notes" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_shipments_product_id_idx" ON "inventory_shipments"("product_id");

-- CreateIndex
CREATE INDEX "inventory_shipments_status_idx" ON "inventory_shipments"("status");

-- CreateIndex
CREATE INDEX "inventory_shipments_expected_arrival_date_idx" ON "inventory_shipments"("expected_arrival_date");

-- AddForeignKey
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_gl_journal_entry_id_fkey" FOREIGN KEY ("gl_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
