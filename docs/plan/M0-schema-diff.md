# M0-T05: Production schema parity

Date: 2026-10-20. Issue: COD-2.

## How it was checked

1. Production (read only): `pg_dump --schema-only --no-owner` on container `ecommerce-cod-postgres`, and `SELECT` on `_prisma_migrations`. No other command ran on production.
2. Repo: a new empty database `parity_scratch` (local container) built with `prisma migrate deploy` (Prisma 5.18.0) from the tracked migrations. The 3 untracked `20260218*` folders were left out.
3. Both dumps were normalized (comments, `SET` lines and blank lines removed) and compared with `diff`.
4. `prisma migrate diff --from-url parity_scratch --to-schema-datamodel schema.prisma` compared the repo migrations with `schema.prisma`.

Both servers run PostgreSQL 15.15.

## Result 1: migration history

- Production has 88 applied migrations. None failed. None rolled back.
- Every tracked repo migration is applied on production. Production has none that the repo lacks.
- The "11 pending migrations" (May 29 to June 9 batch) are now applied. A later deploy ran them. T33 has no pending batch to rehearse.
- The 3 placeholder folders `20260218174636_decimal_migration`, `20260218181000_add_manual_expense_gl_accounts` and `20260218193000_add_accounting_period_and_retained_earnings` are **not in git** and **not on production**. Each holds only the line `-- Migration applied directly to DB, SQL not available`. They are applied only in the local dev database `ecommerce_cod`.

## Result 2: production against repo migrations

The diff has 3 differences. All come from the hand fix on production in June 2026.

| Object | On production | From repo migrations | Action |
|---|---|---|---|
| `webhook_configs.tenant_id` type | `character varying(255)` | `text` | Accept. Both store the same ids. Do not change production. |
| Index `idx_webhook_configs_tenant_id` | exists (a copy of `webhook_configs_tenant_id_idx`) | absent | Accept. Removing it is a delete on production (owner rule: never). |
| `system_config` column order (`tenant_id`, `paystack_provider`) | swapped | normal | Ignore. Column order has no effect. |

The `period_close` enum value exists on both.

## Result 3: repo migrations against `schema.prisma`

`schema.prisma` does not match its own migrations. Production matches the migrations, so `schema.prisma` is the side that is wrong.

| Item | Database (prod and repo) | `schema.prisma` wants | Proposed action |
|---|---|---|---|
| 19 `*_tenant_id_fkey` foreign keys | `ON DELETE CASCADE`, no update action | `ON DELETE CASCADE ON UPDATE CASCADE` (Prisma default) | Change `schema.prisma`: `onUpdate: NoAction` on the 19 relations. No SQL on production. |
| Index `system_config_tenant_id_idx` | exists | absent | Add `@@index([tenantId])` to `SystemConfig`. |
| Index `webhook_events_tenant_id_idx` | exists | absent | Add `@@index([tenantId])` to `WebhookEvent`. |
| `plans.features` default | `'{}'::jsonb` | no default | Add `@default("{}")` to `Plan.features`. |
| Unique index name on `customers(phone_number, tenant_id)` | `customers_phone_number_tenant_key` | `customers_phone_number_tenant_id_key` | Add `map: "customers_phone_number_tenant_key"` to the `@@unique`. |
| `agent_collections(agent_id, status)` and `(status, collection_date)` | absent | indexes | One new migration with `CREATE INDEX IF NOT EXISTS`. Additive only. |

After these changes `prisma migrate diff` must be empty, and the only SQL that reaches production is the 2 new indexes.

## Evidence

Raw files (not in git): `schema.sql` (production schema dump), `migrations.txt`, `prod_vs_repo.diff`, `repo_vs_schema.sql`, kept in the session scratch folder. A full read-only production dump for local tests is at `backups/prod_readonly_20261020_0027.dump` (12 MB, git-ignored).

## Owner decisions (2026-10-20)

1. Placeholders: move the 3 folders to `backups/placeholder-migrations-20260218/` (nothing deleted). Rebuild the local dev database from a copy of the production dump.
2. Fix `schema.prisma` to match the real database (Result 3 table). Only the 2 new `agent_collections` indexes reach production.
3. Keep the 2 production-only leftovers (`webhook_configs.tenant_id` type, duplicate index) as known drift. Production stays unchanged.
