-- M0 (COD-4): workflow_executions.tenant_id becomes required.
-- Fill from the parent workflow -> report orphans and give them to the owner tenant -> NOT NULL.
-- Nothing is deleted. Orphans are listed in m0_tenant_backfill_orphans.

UPDATE "workflow_executions" e
SET "tenant_id" = w."tenant_id"
FROM "workflows" w
WHERE e."workflow_id" = w."id" AND e."tenant_id" IS NULL AND w."tenant_id" IS NOT NULL;

DO $$
DECLARE
  owner_id TEXT;
  orphan_count BIGINT;
BEGIN
  SELECT count(*) INTO orphan_count FROM "workflow_executions" WHERE "tenant_id" IS NULL;
  IF orphan_count > 0 THEN
    SELECT "id" INTO owner_id FROM "tenants" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1;
    IF owner_id IS NULL THEN
      RAISE EXCEPTION 'M0: % rows in workflow_executions have no parent tenant and there is no tenant to own them. Create a tenant first.', orphan_count;
    END IF;
    INSERT INTO "m0_tenant_backfill_orphans" ("table_name", "row_id", "assigned_tenant_id", "reason")
      SELECT 'workflow_executions', "id"::text, owner_id, 'workflow has no tenant'
      FROM "workflow_executions" WHERE "tenant_id" IS NULL;
    UPDATE "workflow_executions" SET "tenant_id" = owner_id WHERE "tenant_id" IS NULL;
  END IF;
END $$;

ALTER TABLE "workflow_executions" ALTER COLUMN "tenant_id" SET NOT NULL;
