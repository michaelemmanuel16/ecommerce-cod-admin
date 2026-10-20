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

---

## COD-10 — M1-I02 Order state machine and every status writer
**Date:** 2026-10-20 | **Type:** feat/refactor | **Branch:** feature/m1-kpi-definitions | **Commit:** 2a0ff36

### Summary
One state machine now owns every order status change. It checks the F-301 table, the role and the owner, locks on `statusVersion`, and writes one history row per move. All side effects run in one place. Plan tasks: M1-T08 to T14. Decisions made during the unattended run are in `docs/plan/M1-decisions.md` (D1–D14).

### Changes
- **Backend:** `services/orderStateMachine.ts` — `transitionOrder`, `allowedTransitions`, `actorOf`, `OrderTransitionError` (`INVALID_TRANSITION`, `STALE_ORDER`, `FORBIDDEN`, `REASON_REQUIRED`, `COLLECTION_VERIFIED`).
- **Backend:** force needs `orders:force_status` (default super_admin), a reason of 5 or more characters, and ownership for reps and agents. It writes an audit row. Integration actors (MCP, the Logiswift sync, CSV re-import) may make any move except into `digital_delivered`. Each such move is flagged `metadata.jump`. A data check on the local copy of prod found about 1,400 such Logiswift moves in 60 days.
- **Backend:** `services/orderSideEffects.ts` — lifecycle dates, the revenue entry with a linked reversal (`reversingEntryId`), so a re-delivered order posts again; a failed-delivery fee from `FeeRule` once per attempt (no rule means no entry); a queued financial sync with retry; `legacyStockHook` (stock unchanged until M4); socket and workflow events after commit. `GL_DEFAULTS.FAILED_DELIVERY_FEE` is removed.
- **Backend:** every status writer goes through the machine: PATCH and PUT order, CSV re-import, deliveries, Paystack settlement and the MCP tool. A grep test (`statusWriters.test.ts`) guards this. Workflow `update_order` stays until M2-T15.
- **API:** `PATCH /api/orders/:id/status` accepts all 12 statuses plus `note`, `force`, `reason`, `declineReason`, `failureReason`, `nextAttemptDate`. A 409 body gives `code`, `from`, `to` and `allowed`. New `GET /api/orders/:id/transitions`. New permission `orders:update_status` (inventory_manager default).
- **Backend:** `createCall` sets `startedAt`, `source` and `firstContactAt` (only when empty).
- **Removed:** dead customer methods, `PATCH /customers/:id/tags`, `GET /customers/:id/analytics`, `notifyOrderStatusChanged`, `notifyDeliveryScheduled`.
- **Frontend:** the agent "reschedule" now sends `failed_delivery` with reason `rescheduled`. A failure-reason select was added. Bulk status change reports each failure. The role matrix shows `UPDATE_STATUS` and `FORCE_STATUS`.
- **Database:** migration `20261021120000_order_failed_delivery_source_type` (new `JournalSourceType` value).

### Key Files
- `backend/src/services/orderStateMachine.ts` (new), `backend/src/services/orderSideEffects.ts` (new)
- `backend/src/services/orderService.ts`, `deliveryService.ts`, `glAutomationService.ts`, `paystackSettlementService.ts`, `callService.ts`, `customerService.ts`
- `backend/src/middleware/auth.ts`, `middleware/errorHandler.ts`, `queues/financialReconciliationQueue.ts`, `mcp/tools/ordersWrite.ts`
- `frontend/src/pages/Orders.tsx`, `frontend/src/pages/mobile/MobileDeliveryDetail.tsx`, `frontend/src/components/admin/RolePermissionsMatrix.tsx`
