-- M3-T15: customers:export (F-361) for the owner, admins and managers. The defaults changed in code; a tenant that
-- saved its own matrix keeps the old list, because a saved resource list wins over the default. Add 'export' once.
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{super_admin,customers}', ("role_permissions" -> 'super_admin' -> 'customers') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'super_admin' -> 'customers') = 'array'
  AND NOT ("role_permissions" -> 'super_admin' -> 'customers') @> '["export"]'::jsonb;
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{admin,customers}', ("role_permissions" -> 'admin' -> 'customers') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'admin' -> 'customers') = 'array'
  AND NOT ("role_permissions" -> 'admin' -> 'customers') @> '["export"]'::jsonb;
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{manager,customers}', ("role_permissions" -> 'manager' -> 'customers') || '["export"]'::jsonb)
WHERE jsonb_typeof("role_permissions" -> 'manager' -> 'customers') = 'array'
  AND NOT ("role_permissions" -> 'manager' -> 'customers') @> '["export"]'::jsonb;
