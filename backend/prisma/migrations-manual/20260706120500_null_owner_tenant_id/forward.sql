-- MAN-86-B (go-live only) — null each owner's User.tenantId so owners become
-- store-agnostic and are reached via Tenant.ownerUserId + store_memberships.
--
-- DO NOT place this in prisma/migrations/ — it must NOT auto-run on migrate
-- deploy. Apply by runbook (see README.md) only after:
--   1. a verified prod DB backup exists,
--   2. Migration A is deployed and owner_user_id is backfilled (0 NULL owners
--      for tenants that have an active super_admin),
--   3. the owner read-switch is live (platformService reads Tenant.ownerUser),
--   4. MULTI_STORE_ENABLED is being flipped to true in the same deploy.
--
-- Reversible: rollback.sql repopulates tenant_id from each owner's default
-- store_membership (recorded by Migration A).

BEGIN;

UPDATE "users" AS u
SET "tenant_id" = NULL
FROM "tenants" AS t
WHERE t."owner_user_id" = u."id"
  AND u."tenant_id" = t."id";

COMMIT;
