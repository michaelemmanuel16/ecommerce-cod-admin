-- Add foreign key constraints on tenant_id for all tenant-scoped tables
-- References tenants(id) with ON DELETE CASCADE for proper tenant lifecycle cleanup

ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "account_transactions" ADD CONSTRAINT "account_transactions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "webhook_configs" ADD CONSTRAINT "webhook_configs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "checkout_forms" ADD CONSTRAINT "checkout_forms_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "inventory_shipments" ADD CONSTRAINT "inventory_shipments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "agent_balances" ADD CONSTRAINT "agent_balances_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

ALTER TABLE "agent_stock" ADD CONSTRAINT "agent_stock_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
