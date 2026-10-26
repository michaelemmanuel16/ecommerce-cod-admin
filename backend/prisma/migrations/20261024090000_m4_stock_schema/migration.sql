-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('none', 'open', 'settled', 'written_off');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('in_transit', 'received', 'disputed', 'cancelled');

-- CreateEnum
CREATE TYPE "TransferReason" AS ENUM ('short_in_package', 'damaged', 'not_received', 'failed_deliveries', 'customer_refused', 'agent_stopped_delivering', 'physical_count_correction', 'lost_or_stolen', 'found_extra_stock', 'short_on_arrival', 'other');

-- CreateEnum
CREATE TYPE "StockLocationType" AS ENUM ('own_store', 'partner_3pl', 'agent', 'in_transit');

-- CreateEnum
CREATE TYPE "StockCountSource" AS ENUM ('own_count', 'three_pl_dashboard', 'agent_count');

-- AlterEnum
ALTER TYPE "ShipmentStatus" ADD VALUE 'received';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransferType" ADD VALUE 'receipt';
ALTER TYPE "TransferType" ADD VALUE 'opening';
ALTER TYPE "TransferType" ADD VALUE 'order_reversal';
ALTER TYPE "TransferType" ADD VALUE 'count_adjustment';

-- AlterTable
ALTER TABLE "inventory_shipments" ADD COLUMN     "claim_amount" DECIMAL(19,4) NOT NULL DEFAULT 0,
ADD COLUMN     "claim_journal_entry_id" INTEGER,
ADD COLUMN     "claim_note" TEXT,
ADD COLUMN     "claim_recovered" DECIMAL(19,4),
ADD COLUMN     "claim_status" "ClaimStatus" NOT NULL DEFAULT 'none',
ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "destination_location_id" INTEGER,
ADD COLUMN     "fx_rate" DECIMAL(19,8),
ADD COLUMN     "fx_rate_source" "FxSource",
ADD COLUMN     "landed_cost_per_unit" DECIMAL(19,4),
ADD COLUMN     "quantity_counted" INTEGER,
ADD COLUMN     "received_at" TIMESTAMP(3),
ADD COLUMN     "received_by_id" INTEGER,
ADD COLUMN     "short_quantity" INTEGER,
ADD COLUMN     "total_cost_store" DECIMAL(19,4),
ALTER COLUMN "unit_cost" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "shipping_cost" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "customs_duties" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "other_costs" SET DATA TYPE DECIMAL(19,4),
ALTER COLUMN "total_cost" SET DATA TYPE DECIMAL(19,4);

-- AlterTable
ALTER TABLE "inventory_transfers" ADD COLUMN     "from_location_id" INTEGER,
ADD COLUMN     "item_key" TEXT,
ADD COLUMN     "reason" "TransferReason",
ADD COLUMN     "received_at" TIMESTAMP(3),
ADD COLUMN     "received_by_id" INTEGER,
ADD COLUMN     "received_quantity" INTEGER,
ADD COLUMN     "reversed_at" TIMESTAMP(3),
ADD COLUMN     "shipment_id" INTEGER,
ADD COLUMN     "status" "TransferStatus" NOT NULL DEFAULT 'received',
ADD COLUMN     "to_location_id" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "landed_cost_total" DECIMAL(19,4);

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "low_stock_days" INTEGER;

-- CreateTable
CREATE TABLE "stock_locations" (
    "id" SERIAL NOT NULL,
    "type" "StockLocationType" NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" INTEGER,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "stock_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "id" SERIAL NOT NULL,
    "location_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" SERIAL NOT NULL,
    "location_id" INTEGER NOT NULL,
    "count_date" DATE NOT NULL,
    "source" "StockCountSource" NOT NULL,
    "counted_by_id" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" SERIAL NOT NULL,
    "count_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "system_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "finding_id" INTEGER,
    "applied_movement_id" INTEGER,
    "tenant_id" TEXT NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_locations_tenant_id_idx" ON "stock_locations"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_locations_user_id_idx" ON "stock_locations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenant_id_name_key" ON "stock_locations"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stock_locations_tenant_id_user_id_key" ON "stock_locations"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "stock_levels_tenant_id_idx" ON "stock_levels"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_levels_product_id_idx" ON "stock_levels"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_levels_location_id_product_id_key" ON "stock_levels"("location_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_counts_tenant_id_idx" ON "stock_counts"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_counts_location_id_count_date_idx" ON "stock_counts"("location_id", "count_date");

-- CreateIndex
CREATE INDEX "stock_counts_counted_by_id_idx" ON "stock_counts"("counted_by_id");

-- CreateIndex
CREATE INDEX "stock_count_lines_tenant_id_idx" ON "stock_count_lines"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_count_lines_product_id_idx" ON "stock_count_lines"("product_id");

-- CreateIndex
CREATE INDEX "stock_count_lines_finding_id_idx" ON "stock_count_lines"("finding_id");

-- CreateIndex
CREATE INDEX "stock_count_lines_applied_movement_id_idx" ON "stock_count_lines"("applied_movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_product_id_key" ON "stock_count_lines"("count_id", "product_id");

-- CreateIndex
CREATE INDEX "inventory_shipments_received_by_id_idx" ON "inventory_shipments"("received_by_id");

-- CreateIndex
CREATE INDEX "inventory_shipments_destination_location_id_idx" ON "inventory_shipments"("destination_location_id");

-- CreateIndex
CREATE INDEX "inventory_shipments_claim_journal_entry_id_idx" ON "inventory_shipments"("claim_journal_entry_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_from_location_id_idx" ON "inventory_transfers"("from_location_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_to_location_id_idx" ON "inventory_transfers"("to_location_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_shipment_id_idx" ON "inventory_transfers"("shipment_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_received_by_id_idx" ON "inventory_transfers"("received_by_id");

-- CreateIndex
CREATE INDEX "inventory_transfers_tenant_id_status_idx" ON "inventory_transfers"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_claim_journal_entry_id_fkey" FOREIGN KEY ("claim_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "stock_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "inventory_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_locations" ADD CONSTRAINT "stock_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_counted_by_id_fkey" FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_applied_movement_id_fkey" FOREIGN KEY ("applied_movement_id") REFERENCES "inventory_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Old `arrived` shipments (M4 decision, F-606): the full quantity counted, nothing short, received on the arrival date.
-- status stays `arrived` so code that reads it keeps working until M4-T12; destination_location_id stays NULL (the T03 script sets it to Logiswift).
UPDATE "inventory_shipments"
SET "quantity_counted" = "quantity",
    "short_quantity" = 0,
    "received_at" = "arrived_at"
WHERE "status" = 'arrived';

-- One active order_fulfillment row per order line. Partial, so reversed rows (reversed_at set) do not block a re-delivery,
-- and other movement types are free. Prisma cannot express a partial unique index, so it lives here only.
CREATE UNIQUE INDEX "inventory_transfers_active_fulfilment_key"
ON "inventory_transfers" ("order_id", "product_id", "item_key")
WHERE "transfer_type" = 'order_fulfillment' AND "reversed_at" IS NULL;
