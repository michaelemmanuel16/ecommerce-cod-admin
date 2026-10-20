# M1 KPI Definitions

Milestone M1 of the CodAdmin rebuild. It gives every KPI one definition and one source of data. Plan: `docs/plan/M1.md`.

---

## COD-9 — M1-I01 Order timestamps, shared data and phone normalisation
**Date:** 2026-10-20 | **Type:** feat/fix | **Branch:** feature/m1-kpi-definitions | **Commit:** 445f857

### Summary
New order lifecycle fields and four new tenant-scoped models for the KPI work. Phones are saved in one format (E.164), and lookups still find the old formats. One list for regions, currencies and order status labels. Three data scripts fill the new fields. They run dry by default. Plan tasks: M1-T01 to T07.

### Changes
- **Database:** migration `20261021100000_order_lifecycle_columns`. Order gets `confirmedAt`, `confirmedById`, `dispatchedAt`, `firstContactAt`, `returnedAt`, `statusVersion`, `declineReason`, `failureReason`, `nextAttemptDate`. A trigger adds 1 to `status_version` on each status change. OrderHistory gets `fromStatus`, `actorKind`, `forced`. Call gets `startedAt`, `source`, `declineReason`, `callbackAt`. CallOutcome gets `not_reachable` and `declined`. New indexes on (tenant, confirmedAt), (tenant, dispatchedAt), (tenant, deliveryDate), (tenant, status, deliveryDate).
- **Database:** migration `20261021110000_kpi_support_models`. New models Target, Finding, FeeRule and FxRate. All have a required tenant and are in `TENANT_SCOPED_MODELS`. Money is `Decimal(19,4)`. FX rate is `Decimal(19,8)`.
- **Backend:** `utils/phone.ts` (`normalizePhone`, `formatPhoneLocal`, `phoneLookupVariants`, `customerPhoneSearch`). It is used in public checkout, manual orders, import, webhooks, the customer form, the duplicate check, search and the MCP tools. Input that does not parse is kept as typed, so no order fails.
- **Backend:** `GET /api/reference/regions?country=GH` (`utils/regions.ts`, from `country-state-city`).
- **Backend:** Paystack settlement sets `deliveryDate` on digital orders.
- **Backend:** the customers list with `sortBy` no longer returns 500. The query used a column that does not exist and an ambiguous ORDER BY. This bug is live on production. The fix ships with v2.
- **Frontend:** `utils/orderStatus.ts` holds one label for each of the 12 statuses. 8 screens read it. `utils/countries.ts` holds one list of 15 currencies for Settings and onboarding.
- **Scripts:** `backfill:order-timestamps`, `normalize:customer-phones` and `backfill:digital-delivery-date`. They share `scripts/lib/scriptArgs.ts`. Each one writes only with `--apply`, and refuses production unless `--allow-production`. A field with no source row stays empty.

### Reports
- `docs/plan/M1-backfill-counts.md` — order timestamp counts on the local copy of prod data
- `docs/plan/M1-phone-normalize-counts.md` — phone counts and collision groups

### Key Files
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261021100000_order_lifecycle_columns/`, `backend/prisma/migrations/20261021110000_kpi_support_models/`
- `backend/src/utils/phone.ts` (new), `backend/src/utils/regions.ts` (new), `backend/src/routes/referenceRoutes.ts` (new), `backend/src/controllers/referenceController.ts` (new)
- `backend/src/services/customerService.ts`, `orderService.ts`, `deliveryService.ts`, `webhookService.ts`, `paystackSettlementService.ts`, `backend/src/utils/customerLookup.ts`
- `backend/scripts/backfill-order-timestamps.ts`, `normalize-customer-phones.ts`, `backfill-digital-delivery-date.ts`, `lib/scriptArgs.ts` (all new)
- `frontend/src/utils/orderStatus.ts` (new), `frontend/src/utils/countries.ts`
