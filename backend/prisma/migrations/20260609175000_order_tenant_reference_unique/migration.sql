-- CreateIndex
-- Scope Paystack-reference uniqueness to the tenant. NULL payment_reference rows
-- (COD orders) are exempt: Postgres treats NULLs as distinct in a unique index, so
-- multiple COD orders per tenant remain allowed.
CREATE UNIQUE INDEX "orders_tenant_id_payment_reference_key" ON "orders"("tenant_id", "payment_reference");
