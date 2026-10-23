-- M3-T07: call reps (sales_rep) lose customers:delete. The defaults changed in code; a tenant that saved its
-- own matrix keeps the old value, because a saved resource list wins over the default. Remove only 'delete'.
UPDATE "system_config"
SET "role_permissions" = jsonb_set("role_permissions", '{sales_rep,customers}', ("role_permissions" -> 'sales_rep' -> 'customers') - 'delete')
WHERE jsonb_typeof("role_permissions" -> 'sales_rep' -> 'customers') = 'array';
