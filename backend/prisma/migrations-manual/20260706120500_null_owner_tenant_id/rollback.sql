-- MAN-86-B rollback — repopulate each owner's User.tenantId from the default
-- store_membership recorded by Migration A. Pair with disabling MULTI_STORE_ENABLED.
--
-- Safe to run repeatedly: only touches owners whose tenantId is currently NULL.

BEGIN;

UPDATE "users" AS u
SET "tenant_id" = sm."tenant_id"
FROM "store_memberships" AS sm
WHERE sm."user_id" = u."id"
  AND sm."is_default" = true
  AND u."tenant_id" IS NULL;

COMMIT;
