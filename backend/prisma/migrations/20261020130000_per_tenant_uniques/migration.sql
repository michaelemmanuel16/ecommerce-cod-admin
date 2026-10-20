-- M0-T11 (COD-4): per-tenant uniques. Two tenants can now share an account code,
-- journal entry number, product SKU and SMS template name.
-- Kept global on purpose: checkout_forms.slug (public URL), message_logs.provider_message_id.

-- DropIndex
DROP INDEX "accounts_code_key";
DROP INDEX "journal_entries_entry_number_key";
DROP INDEX "products_sku_key";
DROP INDEX "sms_templates_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");
CREATE UNIQUE INDEX "journal_entries_tenant_id_entry_number_key" ON "journal_entries"("tenant_id", "entry_number");
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");
CREATE UNIQUE INDEX "sms_templates_tenant_id_name_key" ON "sms_templates"("tenant_id", "name");
