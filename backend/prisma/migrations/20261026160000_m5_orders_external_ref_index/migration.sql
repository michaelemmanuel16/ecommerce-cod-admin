-- M5: partner payout lines and partner CSV rows find a partner's order by its external order id.
CREATE INDEX IF NOT EXISTS "orders_tenant_id_delivery_agent_id_external_order_id_idx" ON "orders"("tenant_id", "delivery_agent_id", "external_order_id");
