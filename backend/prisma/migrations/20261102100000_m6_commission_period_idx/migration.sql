-- M6-T25 (COD-62): the month close, the leaderboard and the rewards read reward entries by (tenant, kind, period). Index only; no data change.

-- CreateIndex
CREATE INDEX "commission_entries_tenant_id_kind_period_idx" ON "commission_entries"("tenant_id", "kind", "period");
