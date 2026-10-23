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

## T06/T07: webhook, settlement, fees and payouts

- Migration `20261023160000_payment_hooks` (applied by hand to dev `ecommerce_cod`, the production-dump copy `ecommerce_cod_m3copy` and the test DB `ecommerce_cod_test`, and recorded in `_prisma_migrations` on all three): `FindingType` += `payment_unmatched`, `ledger_post_failed`, `paystack_unsettled`; `JournalSourceType` += `paystack_payout`. `Transaction.feeUnknown` already existed (T02), so no column was added. The migration ships in the T06 commit because T06 needs `payment_unmatched`.
- F-934 check: the production-dump copy has 0 ledger rows on 1030, so no manual entry clears 1030 today. (Same on dev and test.) Run the same count on production before deploy (read-only).
- Money units (F-405): `depositPaid`, `balanceDue`, `codAmount` and `totalAmount` are major-unit Decimal in the code today. Settlement writes `depositPaid = verification.amount` (the adapter already divided the provider's minor figure), and `PendingCheckout.balanceDue/codAmount/totalAmount` are major units from `publicOrderController`. Only `PendingCheckout.paystackChargeMinor` and the 201 response field `amount` are minor. No online order with a deposit exists in dev or the production-dump copy (`select ... from orders where deposit_paid > 0 or balance_due > 0` returned 0 rows), so there is no old data to convert. No fix was needed. New test: a 249.00 deposit order stores depositPaid 74.7, balanceDue 174.3, codAmount 174.3, totalAmount 249.
- Settlement function is `settlePayment` (file name `paystackSettlementService.ts` unchanged). It returns `wrong_tenant` when a webhook's tenant does not own the reference; the webhook answers 404 and removes its replay row.
- Settlement no longer posts to the ledger. The ledger poster (`services/payments/ledgerPoster.ts`) subscribes to `onPaymentSettled`, registered in `server.ts` at listen time (not in tests). It tries 3 times in total (waits 0.5 s and 2 s), then opens a `ledger_post_failed` Finding.
- CAPI Purchase stays where it is (not moved into a subscriber). Digital delivery stays in settlement.
- `paystack_unsettled` is checked inside `checkLedgerForTenant` (nightly 02:00 job). It updates the amount of an open Finding and never closes it.
- Payout reference: stored in `JournalEntry.externalRef` (migration `20261023170000_payment_refs`, unique per tenant and source type). A repeat is a unique-key error mapped to 409. The same migration adds a `PendingCheckout (tenantId, status, createdAt)` index for the sweep.
