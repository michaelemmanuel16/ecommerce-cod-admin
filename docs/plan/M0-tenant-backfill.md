# M0-T09: Tenant backfill rehearsal

Date: 2026-10-20. Issue: COD-4.

## What the migration does

Migration `20261020120000_add_tenant_id_to_remaining_tables`.

For 12 tables it adds `tenant_id`, fills it from the parent row, then sets NOT NULL. It adds an index and a foreign key to `tenants` (`ON DELETE CASCADE`, no update action). `notifications.tenant_id` already exists. It is filled from the user and set NOT NULL.

| Table | Tenant comes from |
|---|---|
| agent_collections | order, else agent user |
| agent_deposits, agent_aging_buckets | agent user |
| payouts | rep user |
| calls | order, else customer |
| order_history, download_tokens | order |
| audit_logs, notifications | user |
| webhook_logs | webhook config |
| form_submissions | form, else order |
| product_cost_entries | product |
| sms_templates | no parent |

A row with no parent tenant is an orphan. Before the migration gives it a tenant, it writes the row to `m0_tenant_backfill_orphans` (table, row id, assigned tenant, reason, time). The owner is the tenant with the earliest `createdAt`. Nothing is deleted. If there are orphans and no tenant at all, the migration stops with an error.

## How it was rehearsed

1. New throwaway database `m0_rehearsal`, restored with `pg_restore` from `backups/prod_readonly_20261020_0027.dump` (the dump holds 88 applied migrations).
2. `prisma migrate deploy` (Prisma 5.18.0).
3. Counts of `tenant_id IS NULL`, orphan report, and `prisma migrate diff`.

## Result

Migration time: **1.03 seconds** (all 13 tables, 51k rows). The earlier index migration took 0.01 seconds.

Rows with `tenant_id IS NULL` after the migration: **0 in all 13 tables.**

| Table | Rows | NULL tenant_id |
|---|---|---|
| agent_collections | 5,276 | 0 |
| agent_deposits | 0 | 0 |
| agent_aging_buckets | 1 | 0 |
| payouts | 4 | 0 |
| calls | 1,246 | 0 |
| order_history | 28,225 | 0 |
| audit_logs | 148 | 0 |
| webhook_logs | 11,611 | 0 |
| sms_templates | 0 | 0 |
| download_tokens | 0 | 0 |
| form_submissions | 3,852 | 0 |
| product_cost_entries | 0 | 0 |
| notifications | 678 | 0 |

Orphans (all given to `86330bd5-7d44-40c5-98ad-e480a9882530`, company-1):

| Table | Orphans | Reason |
|---|---|---|
| notifications | 165 | user is the platform super admin, who has no tenant |
| webhook_logs | 6 | no webhook config |

The plan page says 166 notifications. That count is from the local dev copy, which is a few days newer than the dump (684 notifications, 166 orphans). The dump has 678 and 165.

## Parity check

`prisma migrate diff --from-url <m0_rehearsal> --to-schema-datamodel prisma/schema.prisma --exit-code`

- On the prod copy: only the known `webhook_configs.tenant_id` drift shows (type `varchar(255)`). This is accepted in `M0-schema-diff.md`. Nothing from the new migration shows.
- On a fresh empty database built from the migrations: **no difference**.

## Code changes that go with it

Every place that creates a row in these 13 tables now sets `tenantId`. The tenant comes from the parent row, else from the tenant context. The helper is `resolveTenantId(parentTenantId?)` in `src/utils/tenantContext.ts`. It throws if there is no tenant.

Webhook logs: the log row is now written after the webhook config is found, because it needs the config's tenant. A request with an unknown API key or URL has no tenant. It is written to the app log and not to `webhook_logs`. It still gets the same 401 or 404.

## Not done

Old seed scripts `seed-comprehensive-data.ts`, `seed-sample-data.ts` and `seed-additional-data.ts` do not set a tenant. They were already broken for other reasons and are not in the build. They are left as they are.

# M0-T11: Per-tenant uniques check

Migration `20261020130000_per_tenant_uniques`. It drops the 4 global unique indexes and adds `(tenant_id, code)` on `accounts`, `(tenant_id, entry_number)` on `journal_entries`, `(tenant_id, sku)` on `products` and `(tenant_id, name)` on `sms_templates`. `checkout_forms.slug` and `message_logs.provider_message_id` stay global.

Checked on `m0_rehearsal` (prod dump) before the migration:

| Check | Result |
|---|---|
| Duplicate `(tenant_id, code)` in accounts | 0 |
| Duplicate `(tenant_id, entry_number)` in journal_entries | 0 |
| Duplicate `(tenant_id, sku)` in products | 0 |
| Duplicate `(tenant_id, name)` in sms_templates | 0 |
| Accounts with NULL `tenant_id` | 0 (also 0 in the local dev and test databases) |

Migration time: 0.10 seconds. Parity check: same result as T09 (only the `webhook_configs` drift on the prod copy, no difference on a fresh database).

A unique index treats NULL tenants as different. Account rows with NULL `tenant_id` are not blocked by it. There are none today. T13 moves any that appear.

Journal entry numbers have 5 digits: `JE-YYYYMMDD-00001`. The next number was already counted per tenant. The old global unique made the second tenant collide. Now both tenants get `-00001` on the same day (integration test `perTenantUniques`).

## Orphan rows: evidence

On the prod copy, the 6 orphan `webhook_logs` are `/import` calls from 2026-04-08 and 2026-04-09. That is before any other tenant existed (the next tenant was created 2026-05-15). They are for the owner's own products. The orphan `notifications` are "Overdue Agent Collections" alerts to the platform super admin, who is the owner. So giving all of them to company-1 is correct.

# M0: workflow_executions tenant backfill

Migration `20261020140000_workflow_executions_tenant_not_null`. It fills `workflow_executions.tenant_id` from `workflows.tenant_id`. A row that still has no tenant goes to the owner tenant (oldest `createdAt`) and is written to `m0_tenant_backfill_orphans`. Then the column is set to NOT NULL. `schema.prisma` now has `tenantId` required on `WorkflowExecution`.

Code: both places that create a `WorkflowExecution` in `workflowService.ts` set `tenantId: resolveTenantId(workflow.tenantId)`.

Rehearsal on `m0_rehearsal2` (restored from `prod_readonly_20261020_0027.dump`): 35,562 rows, 7,915 with NULL `tenant_id` before. `prisma migrate deploy` took 2.4 seconds wall clock for the three pending migrations, including Prisma start-up. After: **0 NULL rows**. Orphans from this migration: none (every row had a parent workflow with a tenant). Parity: only the accepted `webhook_configs.tenant_id` drift shows on the prod copy; "No difference detected" on a fresh database.

Applied to `ecommerce_cod` and `ecommerce_cod_test`.

## Other scoped models that still have a nullable `tenantId`

NULL counts on `ecommerce_cod` (not changed): `users` 1 of 20 (the platform super admin), `system_config` 1 of 4 (the platform row). All other nullable ones have 0 NULL rows: customers, products, orders, deliveries, transactions, expenses, accounts, journal_entries, workflows, webhook_configs, checkout_forms, inventory_shipments, inventory_transfers, agent_balances, agent_stock, message_logs, email_templates, email_campaigns.
