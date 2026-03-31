-- Backfill currentPlanId from the plan string for tenants that don't have it set
UPDATE "tenants" t
SET "current_plan_id" = p."id"
FROM "plans" p
WHERE t."current_plan_id" IS NULL
  AND p."name" = t."plan";

-- Drop the redundant plan string column
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "plan";
