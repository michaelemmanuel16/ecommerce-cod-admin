-- AlterTable: the one-line count a 3PL-dashboard receive writes links its shipment, so stock reads can leave it out.
ALTER TABLE "stock_counts" ADD COLUMN     "shipment_id" INTEGER;

-- CreateIndex
CREATE INDEX "stock_counts_shipment_id_idx" ON "stock_counts"("shipment_id");

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "inventory_shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link the one-line counts that 3PL-dashboard receives already wrote. A count belongs to a received shipment when it has
-- one line with the shipment's product, shipped quantity as system quantity and counted quantity as counted, at the shipment's
-- destination, by the user who received it, on the received day (UTC), from the 3PL dashboard.
UPDATE "stock_counts" c
SET "shipment_id" = s."id"
FROM "inventory_shipments" s, "stock_count_lines" l
WHERE l."count_id" = c."id"
  AND s."tenant_id" = c."tenant_id"
  AND s."status" = 'received'
  AND s."product_id" = l."product_id"
  AND s."destination_location_id" = c."location_id"
  AND s."quantity" = l."system_quantity"
  AND s."quantity_counted" = l."counted_quantity"
  AND s."received_by_id" = c."counted_by_id"
  AND (s."received_at" AT TIME ZONE 'UTC')::date = c."count_date"
  AND c."source" = 'three_pl_dashboard'
  AND (SELECT COUNT(*) FROM "stock_count_lines" x WHERE x."count_id" = c."id") = 1;
