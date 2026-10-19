-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_collections_agent_id_status_idx" ON "agent_collections"("agent_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agent_collections_status_collection_date_idx" ON "agent_collections"("status", "collection_date");
