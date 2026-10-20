-- M0-T09 (COD-4): tenant_id on 12 more tables, and notifications.tenant_id becomes required.
-- Order per table: add column -> fill from parent -> report orphans and give them to the
-- owner tenant -> NOT NULL -> index -> FK (ON DELETE CASCADE, no ON UPDATE action).
-- Nothing is deleted. Orphans are listed in m0_tenant_backfill_orphans.

CREATE TABLE "m0_tenant_backfill_orphans" (
    "id" SERIAL NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "assigned_tenant_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "m0_tenant_backfill_orphans_pkey" PRIMARY KEY ("id")
);

DO $$
DECLARE
  owner_id TEXT;
  spec RECORD;
  orphan_count BIGINT;
BEGIN
  -- Owner tenant = the earliest created tenant. It takes rows that have no parent tenant.
  SELECT "id" INTO owner_id FROM "tenants" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1;

  FOR spec IN
    SELECT * FROM (VALUES
      ('agent_collections',
       'COALESCE((SELECT o.tenant_id FROM orders o WHERE o.id = t.order_id), (SELECT u.tenant_id FROM users u WHERE u.id = t.agent_id))',
       'order and agent user have no tenant'),
      ('agent_deposits',
       '(SELECT u.tenant_id FROM users u WHERE u.id = t.agent_id)',
       'agent user has no tenant'),
      ('agent_aging_buckets',
       '(SELECT u.tenant_id FROM users u WHERE u.id = t.agent_id)',
       'agent user has no tenant'),
      ('payouts',
       '(SELECT u.tenant_id FROM users u WHERE u.id = t.rep_id)',
       'rep user has no tenant'),
      ('calls',
       'COALESCE((SELECT o.tenant_id FROM orders o WHERE o.id = t.order_id), (SELECT c.tenant_id FROM customers c WHERE c.id = t.customer_id))',
       'order and customer have no tenant'),
      ('order_history',
       '(SELECT o.tenant_id FROM orders o WHERE o.id = t.order_id)',
       'order has no tenant'),
      ('audit_logs',
       '(SELECT u.tenant_id FROM users u WHERE u.id = t.user_id)',
       'user is missing or has no tenant'),
      ('webhook_logs',
       '(SELECT w.tenant_id FROM webhook_configs w WHERE w.id = t.webhook_config_id)',
       'webhook config is missing or has no tenant'),
      ('sms_templates',
       'NULL',
       'table has no parent row'),
      ('download_tokens',
       '(SELECT o.tenant_id FROM orders o WHERE o.id = t.order_id)',
       'order has no tenant'),
      ('form_submissions',
       'COALESCE((SELECT f.tenant_id FROM checkout_forms f WHERE f.id = t.form_id), (SELECT o.tenant_id FROM orders o WHERE o.id = t.order_id))',
       'form and order have no tenant'),
      ('product_cost_entries',
       '(SELECT p.tenant_id FROM products p WHERE p.id = t.product_id)',
       'product has no tenant'),
      ('notifications',
       '(SELECT u.tenant_id FROM users u WHERE u.id = t.user_id)',
       'user has no tenant')
    ) AS v(tbl, parent_expr, reason)
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id TEXT', spec.tbl);

    EXECUTE format('UPDATE %I t SET tenant_id = %s WHERE t.tenant_id IS NULL', spec.tbl, spec.parent_expr);

    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', spec.tbl) INTO orphan_count;
    IF orphan_count > 0 THEN
      IF owner_id IS NULL THEN
        RAISE EXCEPTION 'M0-T09: % rows in % have no parent tenant and there is no tenant to own them. Create a tenant first.',
          orphan_count, spec.tbl;
      END IF;
      EXECUTE format(
        'INSERT INTO m0_tenant_backfill_orphans (table_name, row_id, assigned_tenant_id, reason) SELECT %L, id::text, %L, %L FROM %I WHERE tenant_id IS NULL',
        spec.tbl, owner_id, spec.reason, spec.tbl);
      EXECUTE format('UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL', spec.tbl, owner_id);
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', spec.tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)', spec.tbl || '_tenant_id_idx', spec.tbl);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = spec.tbl || '_tenant_id_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE',
        spec.tbl, spec.tbl || '_tenant_id_fkey');
    END IF;
  END LOOP;
END $$;
