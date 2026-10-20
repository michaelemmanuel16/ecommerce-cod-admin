# M0-T07: Money units on production (decision R15)

Date: 2026-10-20. Issue: COD-2. Owner must read this before the Decimal migration (M0-T21).

## How it was checked

Read-only `SELECT` queries on production inside `BEGIN TRANSACTION READ ONLY ... ROLLBACK`. For each column: rows, non-null, non-zero, min, max, average, rows with more than 2 decimals, rows with any decimals.

## Result

**Every money column holds major units (GH₵, for example 249 = GH₵249).** No column holds minor units (pesewas). The migration divides nothing by 100.

**No value has more than 2 decimals.** The change from `Float` to `Decimal(19,4)` keeps every value exactly.

`orders.deposit_paid` and `orders.balance_due` are `0` on all 15,787 orders. The first test from F-405 (`deposit_paid > total_amount`) matches 0 rows. There is no data to classify. The unit rule for these 2 columns is set by the code that will write them (M3b), not by old data.

| Column | Type now | Rows | Non-zero | Min | Max | Units |
|---|---|---|---|---|---|---|
| tenants.default_delivery_fee | float | 3 | 0 (all null) | - | - | n/a |
| users.commission_amount | float | 19 | 3 | 0 | 70 | major |
| users.total_earnings | float | 19 | 0 | 0 | 0 | n/a |
| users.delivery_rate | float | 19 | 3 | 0 | 70 | not converted (removed, F1) |
| customers.total_spent | float | 13,829 | 3,797 | **−1,350** | 1,450 | major (see note 1) |
| products.price | float | 7 | 7 | 50 | 300 | major |
| orders.subtotal | float | 15,787 | 15,743 | 0 | 2,500 | major |
| orders.shipping_cost | float | 15,787 | 0 | 0 | 0 | n/a |
| orders.discount | float | 15,787 | 0 | 0 | 0 | n/a |
| orders.total_amount | float | 15,787 | 15,743 | 0 | 2,500 | major |
| orders.cod_amount | float | 15,787 | 15,743 | 0 | 2,500 | major (see note 2) |
| orders.deposit_paid | integer | 15,787 | 0 | 0 | 0 | none stored |
| orders.balance_due | integer | 15,787 | 0 | 0 | 0 | none stored |
| order_items.unit_price | float | 16,207 | 16,163 | 0 | 300 | major |
| order_items.total_price | float | 16,207 | 16,163 | 0 | 2,500 | major |
| transactions.amount | float | 5,281 | 5,281 | 200 | 1,000 | major |
| expenses.amount | float | 2 | 2 | 2,105.62 | 51,000 | major |
| form_packages.price | float | 32 | 32 | 200 | 1,100 | major |
| form_packages.original_price | float | 32 | 32 | 200 | 2,400 | major |
| form_packages.discount_value | float | 32 | 29 | 0 | 1,300 | mixed: money or percent (note 3) |
| form_upsells.price | float | 2 | 2 | 50 | 120 | major |
| form_upsells.original_price | float | 2 | 0 (null) | - | - | n/a |
| form_upsells.discount_value | float | 2 | 0 | 0 | 0 | n/a |
| form_submissions.total_amount | float | 3,852 | 3,852 | 200 | 1,000 | major |
| pending_checkouts.* (6 columns) | float / integer | 0 | 0 | - | - | empty table |
| payouts.amount | float | 4 | 4 | 910 | 2,245 | major |
| product_cost_entries.amount | float | 0 | 0 | - | - | empty table |

## Notes for the owner

1. **499 customers have a negative `total_spent`** (lowest −1,350). A customer cannot spend less than zero. A return or a status change probably subtracts twice. This is not part of M0. It needs its own ticket.
2. **9 orders have `cod_amount` different from `total_amount`.** This may be correct (a part payment) or a bug. Not part of M0.
3. **`form_packages.discount_value` holds 2 kinds of value.** 27 rows with `discount_type = fixed` hold money (always `original_price − price`). 2 rows with `discount_type = percentage` hold a percent. 3 rows have `none`. `Decimal(19,4)` stores both kinds exactly, so the migration converts the column as it is. Code must read `discount_type` before it treats the value as money.

## Rule for the Decimal migration (M0-T21)

- Convert every column in the list above with `USING round(col::numeric, 4)`. No column is divided by 100.
- Do not convert `users.delivery_rate` (removed, F1) or `products.weight` (not money).
- `orders.deposit_paid`, `orders.balance_due` and `pending_checkouts.balance_due` are `integer` today. Convert them to `Decimal(19,4)` as major units. All stored values are 0, so no value changes.
