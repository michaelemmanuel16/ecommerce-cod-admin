-- AlterTable: the one-line count a 3PL-dashboard receive writes links its shipment, so stock reads can leave it out.
ALTER TABLE "stock_counts" ADD COLUMN     "shipment_id" INTEGER;

-- CreateIndex
CREATE INDEX "stock_counts_shipment_id_idx" ON "stock_counts"("shipment_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "inventory_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
