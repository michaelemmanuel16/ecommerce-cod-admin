-- M2-T05: audit list and retention filter by tenant and date.
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
