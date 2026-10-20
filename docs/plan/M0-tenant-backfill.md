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
