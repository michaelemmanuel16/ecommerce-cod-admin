# M3b notes (results for the PR body)

Collected while building M3b-T02 to T05 (COD-31). Dates are 2026-10-23.

## T02: migration `20261023140000_payment_connections`

- Adds `payment_connections` (tenant scoped, unique `(tenant_id, provider)`), `checkout_forms.archived_at` and `payment_provider`, `orders.payment_provider`, provider and fee columns on `transactions`, and `status`, `provider`, `last_checked_at` on `pending_checkouts`.
- `pending_checkouts.provider` (default `paystack`) is not in the T02 text. Settlement needs it to pick the adapter without reading the form.
- The migration backfills `orders.payment_provider` (payment method `paystack`, `paystack_full`, `paystack_deposit`) and `transactions.provider` to `paystack`.
- `migrate deploy` applied on: dev (`ecommerce_cod`), test (`ecommerce_cod_test`), production-dump copy (`ecommerce_cod_m3copy`). Dev and the copy were also two older migrations behind (`customers_export_permission`, `analytics_export_permission`); `migrate deploy` applied those first.
- Empty database (`m3b_empty_check`, created and dropped): `migrate deploy` then `prisma migrate diff --from-url ... --to-schema-datamodel prisma/schema.prisma --exit-code` printed "No difference detected." (exit 0). Test DB: exit 0.
- Dev and the copy still show the old drift on `webhook_configs.tenant_id` (type only); it is not from this migration.

## T03/T04: payments

- `backend/src/services/payments/`: interface (`types.ts`), registry, Paystack adapter, fake provider (tests only, not registered by default), key and currency rules (`connectionConfig.ts`).
- Minor units: the provider owns the conversion. The Paystack adapter uses x100 (as the checkout always did) and exposes `toMinor`; `toMinor(249.00, 'GHS')` is 24900. There is no ISO-digit lookup. Settlement requires `verification.currency === pending.currency`, then compares the provider's raw minor amount with `PendingCheckout.paystackChargeMinor` (minor against minor). `PendingCheckout.paystackChargeMinor` is a legacy column; T06 replaces it with a Decimal.
- `platformPaystackService` (CodAdmin's own subscription billing) is untouched. `adminService` only invalidates the provider cache after a seller settings save, now through the registry.
- Connection test: `GET https://api.paystack.co/balance` with the tenant secret. A 2xx means the keys work; the currencies in `data[].currency` are stored as `supportedCurrencies`. ASSUMPTION, not checked against live Paystack (no keys here): the balance list is the account's currency list. Check once with a real test key before T13.
- A tenant whose `supportedCurrencies` is empty (never tested, or only the old JSON) is not blocked by the F-401 currency check, so old tenants keep working.
- Missing webhook signature header now answers 401 (it was 400 "Missing signature").
- Copy script `backend/scripts/copy-paystack-to-payment-connections.ts [--dry-run]`. Run on dev only (`ecommerce_cod`) against three temporary tenants (one with keys, one JSON without a secret, one with no JSON); the temporary rows were deleted afterwards:
  - `--dry-run`: Would create 1; scanned 2, already connected 0, no secret 1, no tenant 0.
  - first real run: Created 1; scanned 2, already connected 0, no secret 1.
  - second real run: Created 0; scanned 2, already connected 1, no secret 1 (idempotent).
  - Dev has no real Paystack JSON (0 rows in `system_config` and in the production-dump copy `ecommerce_cod_m3copy`). Not run against production.

## T05: form payment rules

- Migration `20261023150000_form_payment_rules`: adds `system_config.features` (JSONB, default `{}`; holds `prepaidPhysical`) and drops `tenants.default_delivery_fee`. Applied on dev, test and the production-dump copy. Empty database: `migrate deploy` then `migrate diff --exit-code` printed "No difference detected." (exit 0); test DB exit 0.
- `Tenant.defaultDeliveryFee` query (`select count(*) as tenants, count(default_delivery_fee) as non_null, count(*) filter (where default_delivery_fee <> 0) as non_zero from tenants`), run through `docker exec ecommerce-postgres-dev psql` before the drop:
  - dev `ecommerce_cod`: tenants 4, non_null 0, non_zero 0.
  - production-dump copy `ecommerce_cod_m3copy`: tenants 4, non_null 0, non_zero 0.
  - test `ecommerce_cod_test`: tenants 18, non_null 0, non_zero 0.
  - Readers in code: none (`grep -rn defaultDeliveryFee backend/src frontend/src e2e` found only `moneySchema.test.ts` and `scripts/verify-money-migration.ts`, both lists of money columns). Decision: dropped. Not checked against live production: run the same query there before deploy (read-only).
- Removed: the `Tenant.defaultDeliveryFee` column and its entries in the money-column lists, and the stale comment "Can be calculated based on region" next to the fixed `shippingCost = 0` in `publicOrderController`. Kept on purpose (F-423): `Order.shippingCost` and `PendingCheckout.shippingCost`, always 0 for checkout orders. `scripts/rollback-money-decimal.sql` still names the column; it is a historical rollback and was not touched.
- Behaviour change to flag for deploy: with `features.prepaidPhysical` off (the default), existing physical forms that have Paystack deposit or full on are refused at the public order route (400), as the plan says. The public form payload still lists those buttons until the Payment tab and public page work (T13, T16).
- The setting is saved with `PUT /api/admin/settings` (`features`, merged over the stored object); that route is owner (super_admin) only today.
