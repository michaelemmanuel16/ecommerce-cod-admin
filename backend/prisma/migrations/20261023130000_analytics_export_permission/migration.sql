-- M3-T21: analytics:export (F-1057) for the owner, admins, managers and the finance clerk. The defaults changed in code; a tenant that
-- saved its own matrix keeps the old list, because a saved resource list wins over the default. Add 'export' once.
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{super_admin,analytics}', ("role_permissions" -> 'super_admin' -> 'analytics') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'super_admin' -> 'analytics') = 'array'
  AND NOT ("role_permissions" -> 'super_admin' -> 'analytics') @> '["export"]'::jsonb;
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{admin,analytics}', ("role_permissions" -> 'admin' -> 'analytics') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'admin' -> 'analytics') = 'array'
  AND NOT ("role_permissions" -> 'admin' -> 'analytics') @> '["export"]'::jsonb;
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{manager,analytics}', ("role_permissions" -> 'manager' -> 'analytics') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'manager' -> 'analytics') = 'array'
  AND NOT ("role_permissions" -> 'manager' -> 'analytics') @> '["export"]'::jsonb;
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{accountant,analytics}', ("role_permissions" -> 'accountant' -> 'analytics') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'accountant' -> 'analytics') = 'array'
  AND NOT ("role_permissions" -> 'accountant' -> 'analytics') @> '["export"]'::jsonb;
