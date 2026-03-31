-- Add tenantId to Transaction
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "transactions_tenant_id_idx" ON "transactions"("tenant_id");

-- Add tenantId to Expense
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "expenses_tenant_id_idx" ON "expenses"("tenant_id");

-- Add tenantId to AccountTransaction
ALTER TABLE "account_transactions" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "account_transactions_tenant_id_idx" ON "account_transactions"("tenant_id");

-- Add tenantId to AgentBalance
ALTER TABLE "agent_balances" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "agent_balances_tenant_id_idx" ON "agent_balances"("tenant_id");

-- Add tenantId to InventoryTransfer
ALTER TABLE "inventory_transfers" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;
CREATE INDEX IF NOT EXISTS "inventory_transfers_tenant_id_idx" ON "inventory_transfers"("tenant_id");
