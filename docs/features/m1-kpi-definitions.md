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

---

## COD-11 — M1-I03 KPI base, revenue and rates
**Date:** 2026-10-20 | **Type:** feat | **Branch:** feature/m1-kpi-definitions | **Commit:** f5431ac

### Summary
The KPI layer starts here. Every KPI number now comes from `services/kpi`, with one date basis and one formula id. Delivered revenue, confirmation rate, delivery success rate and order-to-cash yield are built. A fixed test data set (the "numbers fixture") proves the numbers of the v2 mockups. Plan tasks: M1-T15, T16, T17, and T23 brought forward (D15). Decisions: D15–D19 in `docs/plan/M1-decisions.md`.

### Changes
- **Backend:** `services/kpi/types.ts` (`KpiResult`: name, value, unit, dateBasis, formulaId, from, to, asOf, currency). `dates.ts`: day and month ranges in the store time zone (Africa/Accra until a tenant setting exists), no new dependency.
- **Backend:** `deliveredRevenue` (F-250, F-900, F-901): physical `delivered` plus paid `digital_delivered` with a price, by `deliveryDate`. A returned order leaves revenue in its return month, not its delivery month (D16).
- **Backend:** `rates` (F-251, F-1008): confirmation rate, delivery success rate on a `cohort` or `delivery` basis, and yield on closed day cohorts (D17). Filters `partnerId` and `repId` (D18). A rate is null when its denominator is 0.
- **API:** `GET /api/kpi/revenue?from&to` and `GET /api/kpi/rates?from&to&basis&partnerId&repId`. Permission `analytics:view` (D19). Bad input is 400 `INVALID_RANGE`. No response key is named `deliveryRate`, `fulfilmentRate` or `conversionRate`.
- **Guard:** `kpiGrep.test.ts` fails when code outside the KPI layer computes revenue or a rate. Legacy files are on an allow-list until M1-T25/T26 repoint them.
- **Fixture:** `npm run seed:fixture` seeds the `fixture-numbers` tenant (1,445 orders, NUMBERS.md). It refuses production and non-local databases. On it the KPI services give GH₵92,000.00, 71% confirmation and 48% delivery success. Notes: `docs/plan/M1-fixture-notes.md`.

### Key Files
- `backend/src/services/kpi/` (new), `backend/src/controllers/kpiController.ts`, `backend/src/routes/kpiRoutes.ts` (new), `backend/src/server.ts`
- `backend/scripts/seed-fixture.ts`, `backend/src/__tests__/fixtures/numbersFixture.ts` (new)
- Tests: `kpiDates`, `kpiGrep`, `kpiRevenue`, `kpiRates`, `kpiRoutes`, `numbersFixture`

---

## COD-12 — M1-I04 Rep, leadership, product and partner KPIs, plus fixture
**Date:** 2026-10-20 | **Type:** feat | **Branch:** feature/m1-kpi-definitions | **Commit:** 2e98c40

### Summary
Rep, leadership, product and delivery partner KPIs now come from the KPI layer. The numbers fixture gets part 2 (January to September history, targets, expenses, partner cash), and every area has its own fixture checks. Plan tasks: M1-T18 to T22 and T24 (T23 shipped in COD-11). Decisions: D20–D34 in `docs/plan/M1-decisions.md`.

### Changes
- **Backend:** `kpi/reps.ts` (`repRates`): confirmation rate and delivered-from-confirmed rate per rep and for all reps. `repPerformanceService` and the MCP tool `reps_performance` use it; month-to-date uses the store time zone.
- **API:** `GET /api/reports/team?from&to` (tiles, rep table, decline reasons; super_admin, admin and manager only, D24). `GET /api/users/reps/performance` renames `successRate` to `confirmationRate` and `deliveredFromConfirmedRate` (KPI objects).
- **Backend:** `kpi/leadership.ts`: pace markers, month projection, revenue needed a day, orders needed a day, planned AOV, attainment and `lever()` (D29, D30). `GET /api/kpi/leadership?asOf`.
- **Backend:** `kpi/products.ts` delivered units (returns left out, D31); `kpi/partners.ts` partner rates on the cohort basis and median timings (D21); `kpi/timeToFirstCall.ts` with `kpi/workingTime.ts` (operating hours, D20, D22, D23). `GET /api/rep/stats/time-to-first-call`.
- **Settings:** `SystemConfig.operatingHours` JSON, checked in `PUT /api/admin/settings`; `npm run set:operating-hours` (dry by default).
- **Access:** one rule, `kpiScope` in `utils/kpiRequest.ts`, for every KPI route: a rep sees own orders, an agent own deliveries; admins may filter by rep or partner (D19, D32, D34).
- **Frontend:** reps page shows delivered-from-confirmed and confirmation rates with their counts.
- **Fixture:** part 2 plus `fixtureChecks/` for history, leadership, products, reps and partners (39 checks). Confirm agent's confirmation rate is 70.5% (shown 71%), not NUMBERS.md's 70% (D28).

### Key Files
- `backend/src/services/kpi/{reps,leadership,products,partners,timeToFirstCall,workingTime,median}.ts` (new)
- `backend/src/utils/kpiRequest.ts`, `controllers/{reportController,repStatsController}.ts`, `routes/{reportRoutes,repRoutes}.ts` (new); `services/teamReportService.ts` (new)
- `backend/src/services/repPerformanceService.ts`, `mcp/tools/customerReps.ts`, `services/adminService.ts`, `scripts/set-operating-hours.ts`
- `frontend/src/pages/CustomerReps.tsx`, `components/reps/RepTable.tsx`, `services/customer-reps.service.ts`

---

## COD-13 — M1-I05 Repoint endpoints and MCP tools, retire dead analytics
**Date:** 2026-10-20 | **Type:** feat | **Branch:** feature/m1-kpi-definitions | **Commit:** 1320f27

### Summary
Every HTTP endpoint and MCP tool that shows revenue or a rate now reads it from the KPI layer. The numbers fixture proves GH₵92,000.00 and 376 delivered on each of them. Dead analytics routes and `profit-margins` are deleted. Date ranges from the browser are now store days. Plan tasks: M1-T25 to T27. Decisions: D35–D43 in `docs/plan/M1-decisions.md`.

### Changes
- **Backend:** analytics dashboard, sales trends, status distribution, funnel, rep and agent performance, product performance, financial summary and order stats use `deliveredRevenue` (delivery date) and the three rate names: `confirmationRate`, `deliverySuccessRate`, `orderToCashYield`. No revenue window on `updatedAt`.
- **Backend:** financial summary adds `digitalRevenue` (GL 4020) and `paystackFees` (GL 5060, now in expenses) (D38, D39).
- **MCP:** `orders_summary`, `analytics_daily/weekly/monthly`, `financial_summary`, `reps_*`, `agents_*` and `products_inventory` on the KPI layer. New `kpi/pending.ts`.
- **Removed:** `GET /api/financial/profit-margins` (D40) and unused `/api/analytics/*` routes; list in `docs/plan/M1-analytics-routes.md`.
- **Dates (D43):** the frontend sends `yyyy-MM-dd` days. The backend reads them in the store zone (`parseBound`, new `parseInclusiveBound` and `readDateBound`), so a date-only end includes the whole day. This fixes the dashboard range that started on 30 Sep for a browser in Lagos.
- **Cleanup (/simplify):** shared `kpiWindow`, `roleScope`, `revenueScope`, `shiftYmd`; `deliveredRevenueByRep` removes the per-rep query loop; shared status sets; parallel queries.
- **Frontend:** consumers updated for renamed fields; dashboard, picker and analytics tabs send store days.

### Key Files
- `backend/src/services/{analyticsService,financialService,orderService,glService,deliveryService,repPerformanceService}.ts`
- `backend/src/services/kpi/{dates,revenue,rates}.ts`, `kpi/pending.ts` (new), `utils/kpiRequest.ts`
- `backend/src/mcp/tools/*`, `mcp/utils.ts`
- `backend/src/__tests__/integration/{dateBounds.test.ts,fixtureChecks/endpoints.ts,fixtureChecks/mcp.ts}` (new)
- `frontend/src/components/ui/DateRangePicker.tsx`, `pages/DynamicDashboard.tsx`, `hooks/useDashboardData.ts`, `stores/financialStore.ts`

---

## COD-14 — M1-I06 Ledger check, health endpoint, FX and store currency
**Date:** 2026-10-20 | **Type:** feat | **Branch:** feature/m1-kpi-definitions | **Commit:** 7acc01e

### Summary
A nightly job checks that delivered revenue matches the ledger for each day. A health endpoint shows the result. The app now keeps daily FX rates and the store currency lives on the tenant. Plan tasks: M1-T28 to T32. Decisions: D44–D48 in `docs/plan/M1-decisions.md`.

### Changes
- **Ledger check:** `ledgerCheckService` runs at 02:00 Accra for each tenant. It compares `deliveredRevenueByDay` with net GL 4010+4020 credits. Each day with a gap gets one open `ledger_gap` Finding (opened or updated). No posting rule changes in M1 (D44).
- **Health:** `GET /api/financial/health` (financial:view, D45) returns balance integrity, journal activity and `ledgerCheck { lastRunAt, openGaps }`.
- **FX:** ExchangeRate-API provider behind an adapter (D47), daily rate job at 06:00 Accra, `/api/fx` (rates and history: settings:view; manual rate and use-today: settings:update). Revenue converts at read time.
- **Store currency:** migration `20261021130000_store_currency_on_tenant` moves the currency to `tenants.currency`, adds `orders.currency` (filled by a trigger, D46) and drops `system_config.currency`. Onboarding returns 400 for a bad currency code.
- **GL:** the return entry date uses `returnedAt` (was `updatedAt`).
- **Frontend:** new **Currencies & FX** settings tab (month revenue, rates, manual rate, use today, history).
- **Tests:** backend test scripts use a 4 GB heap (D48).

### Key Files
- `backend/src/services/{ledgerCheckService,fxService}.ts`, `services/fx/` (new)
- `backend/src/queues/{ledgerCheckQueue,fxRateQueue}.ts`, `controllers/{ledgerHealthController,fxController}.ts`, `routes/fxRoutes.ts` (new)
- `backend/src/utils/currency.ts`, `services/kpi/{revenue,dates}.ts`, `services/glAutomationService.ts`, `controllers/onboardingController.ts`
- `backend/prisma/migrations/20261021130000_store_currency_on_tenant/` (new)
- `frontend/src/components/settings/CurrenciesFxPanel.tsx`, `services/fx.service.ts`, `utils/fx.ts` (new), `pages/Settings.tsx`

---

## COD-15 — M1-I07 Wording guard, KPI contract test and M1 cleanup
**Date:** 2026-10-20 | **Type:** feat | **Branch:** feature/m1-kpi-definitions | **Commit:** c0e738b

### Summary
Two guard tests stop old wording and wrong numbers from coming back. A /simplify pass over the whole M1 diff removed repeated code and fixed one date bug. Plan tasks: M1-T33 to T37. Decision: D49 in `docs/plan/M1-decisions.md`.

### Changes
- **Wording guard (T33):** backend and frontend tests fail on "airtime", "delivery rate" or "6,400" in source. `wording-allowlist.json` holds the banned list and 12 allowed lines, each with a reason. A stale entry fails the test (D49). No UI text changed.
- **KPI contract (T34):** `kpiContract.test.ts` seeds the fixture once. It checks GH₵92,000.00 and 376 delivered on every endpoint and MCP tool, the 71/48/34 rates and leadership numbers, rep rates (a payout does not change them), product units, and zero `ledger_gap` findings. `numbersFixture.test.ts` keeps its SQL, history and partner checks.
- **End-day fix (T35):** a `yyyy-MM-dd` end date now includes the whole store day on calls, agent inventory, agent reconciliation, checkout form submissions, GL journal entries, WhatsApp messages and financial reports. Before, the last day was dropped.
- **Cleanup (T35):** one revenue query for `reps_performance`; FX history read once per currency pair; shared `revenueScope`, `ownsOrder`, `kpiMeta`, `confirmationRateResult`, `dateRangeOut`, `currencyOfTenant`; one frontend currency table; `kpiGrep` also checks `_avg`, with a per-line allow-list.

### Key Files
- `wording-allowlist.json`, `backend/src/__tests__/unit/wordingGuard.test.ts`, `frontend/src/__tests__/wordingGuard.test.ts`, `backend/src/__tests__/integration/kpiContract.test.ts` (new)
- `backend/src/controllers/{callController,agentInventoryController,agentReconciliationController,checkoutFormController,financialController}.ts`
- `backend/src/services/{glService,whatsappService,fxService,orderService,orderStateMachine}.ts`, `services/kpi/*`, `mcp/tools/*`, `mcp/utils.ts`
- `frontend/src/utils/countries.ts`
