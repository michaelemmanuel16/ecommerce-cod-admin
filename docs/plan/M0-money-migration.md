# M0-T21 / T26: Money Decimal migration result

Date: 2026-10-20. Issue: COD-5. Migration: `backend/prisma/migrations/20261020150000_money_columns_to_decimal`.

## What changed

- 31 columns in 14 tables changed to `Decimal(19,4)`. The list is the table in `M0-money-units.md`.
- Each column uses `USING round(col::numeric, 4)`. Nothing is divided by 100.
- Not converted: `users.delivery_rate`, `products.weight`, `pending_checkouts.paystack_charge_minor`.
- `orders.deposit_paid`, `orders.balance_due` and `pending_checkouts.balance_due` were `integer`. They are now `Decimal(19,4)` in major units. All values were 0.
- `form_packages.discount_value` and `form_upsells.discount_value` hold money or a percent. They convert as they are. **Code must read `discount_type` before it treats the value as money.**

## Rehearsal

Throwaway database `m0_money_rehearsal`, restored from `backups/prod_readonly_20261020_0027.dump` (15,787 orders). Steps:

1. `verify-money-migration.ts snapshot` (before any migration).
2. `prisma migrate deploy`: the 4 earlier M0 migrations first, then this one.
3. `verify-money-migration.ts compare`.

| Check | Result |
|---|---|
| Migration time (this migration only) | about 1.3 s, including Prisma start-up. Far below the 5 minute limit. No maintenance window needed. |
| Compare | `zero difference` for all 14 tables (rows, non-null count, sum, min, max). |
| Compare with a changed snapshot | prints the columns that differ and exits 1. |
| `prisma validate` | passes. |
| Parity on the prod-dump copy (`migrate diff --exit-code`) | Only the accepted `webhook_configs.tenant_id` drift. |
| Parity on a fresh database | `No difference detected`, exit 0. |

## Rollback rehearsal (M0-T26)

Second throwaway copy `m0_money_rollback`: migrate, run `scripts/rollback-money-decimal.sql`, compare with the original snapshot. Result: `zero difference` for all 14 tables. `orders.total_amount` is `double precision` again. `orders.deposit_paid` is `integer` again.

After a rollback in a real database, run `prisma migrate resolve --rolled-back 20261020150000_money_columns_to_decimal` and revert the schema change.

## Local databases

Throwaway databases are dropped. `ecommerce_cod` (dev) and `ecommerce_cod_test` are migrated. `ecommerce_cod` compare: zero difference.

## Run it yourself

```
cd backend
npx ts-node scripts/verify-money-migration.ts snapshot /tmp/before.json
npx prisma migrate deploy
npx ts-node scripts/verify-money-migration.ts compare /tmp/before.json
```

## Code note

The backend does not build after this migration. Files outside M0-T22 still use `number` on money. M0-T23 and M0-T24 fix them.
