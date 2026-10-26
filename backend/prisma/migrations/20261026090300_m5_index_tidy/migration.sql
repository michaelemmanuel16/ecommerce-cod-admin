-- M5 (COD-47) index tidy: add the column each M5 query sorts or filters by next.
-- Plain tenant_id indexes stay: every scoped model has one (repo convention, M0 schema diff).

-- DropIndex
DROP INDEX "commission_entries_tenant_id_user_id_status_idx";

-- DropIndex
DROP INDEX "findings_tenant_id_assignee_id_idx";

-- CreateIndex
CREATE INDEX "commission_entries_tenant_id_user_id_status_earned_at_idx" ON "commission_entries"("tenant_id", "user_id", "status", "earned_at");

-- CreateIndex
CREATE INDEX "findings_tenant_id_assignee_id_status_idx" ON "findings"("tenant_id", "assignee_id", "status");
