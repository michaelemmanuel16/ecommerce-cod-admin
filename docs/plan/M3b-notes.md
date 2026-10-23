# M3b notes (results for the PR body)

Collected while building M3b-T02 to T05 (COD-31). Dates are 2026-10-23.

## T02: migration `20261023140000_payment_connections`

- Adds `payment_connections` (tenant scoped, unique `(tenant_id, provider)`), `checkout_forms.archived_at` and `payment_provider`, `orders.payment_provider`, provider and fee columns on `transactions`, and `status`, `provider`, `last_checked_at` on `pending_checkouts`.
- `pending_checkouts.provider` (default `paystack`) is not in the T02 text. Settlement needs it to pick the adapter without reading the form.
- The migration backfills `orders.payment_provider` (payment method `paystack`, `paystack_full`, `paystack_deposit`) and `transactions.provider` to `paystack`.
- `migrate deploy` applied on: dev (`ecommerce_cod`), test (`ecommerce_cod_test`), production-dump copy (`ecommerce_cod_m3copy`). Dev and the copy were also two older migrations behind (`customers_export_permission`, `analytics_export_permission`); `migrate deploy` applied those first.
- Empty database (`m3b_empty_check`, created and dropped): `migrate deploy` then `prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code` printed "No difference detected." (exit 0). Test DB: exit 0.
- Dev and the copy still show the old drift on `webhook_configs.tenant_id` (type only); it is not from this migration.
