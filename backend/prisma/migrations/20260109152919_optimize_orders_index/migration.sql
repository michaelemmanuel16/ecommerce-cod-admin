-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_delivery_state_delivery_area_idx" ON "orders"("delivery_state", "delivery_area");
