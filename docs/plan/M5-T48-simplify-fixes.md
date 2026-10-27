# M5-T48: whole-milestone /simplify fixes

Source: /simplify over `git diff origin/develop...HEAD` at 9aa70027, 2026-10-27. Four reviews (reuse, simplification, efficiency, altitude), deduplicated here. No behaviour change unless an item says so. No schema change. Grep for callers (backend/src, frontend/src, mcp, tools, e2e, scripts) before every delete and put the evidence in the report.

Two lanes, no shared files:
- **Lane A (backend app code + the full-stack items):** items 1–22.
- **Lane B (backend test helpers + frontend-only items):** items 23–29. Do not touch the test files lane A edits (`unit/agentReconciliationService.test.ts`, `integration/bulkAgentCollection.test.ts`, `dateBounds`, tests of deleted routes).

## Lane A

### Reuse
1. `collectionsBackfillService.ts` (tally, owed): use `outstandingOf(c)` from `utils/collectionCash.ts`.
2. One "net a collection by a fee" function (in `feeRuleService`, beside `stampDeliveryFee` / `partnerNetCash`): reduce the open collection to `max(amount - fee, 0)` and decrement `agentBalance.totalCollected` and `currentBalance` by the cut. Call it from `applyFeeStamps` and the state-machine path.
3. `payoutService.listOwed`: month default and window via `getStoreTimeZone`, `localDate`, `monthRange` (`kpi/dates.ts`); validate with `MONTH_RE`.
4. `agingService`: `overdueFilter` reuses `daysToPayOf()` (return the map; use its keys). One profile query.
5. Raw `toISOString().split('T')[0]` / `.slice(0,10)` in new M5 service code (`cashFlowService:213`, `partnerSettlementService:83,478`, `overviewService:144,279`, `statementsService:364`): `ymdOfUtc(d)` (same output). `utils/partnerCsv.ts:98`: `addDays` + `ymdOfUtc`.

### Altitude
6. One default role-permission matrix, exported once and imported by `middleware/auth.ts` and `adminService.getDefaultPermissions`, so settings shows and edits `payouts`, `journal`, `expenses`. Test: the settings default contains them.
7. `ratePercent` (`kpi/rates.ts`) delegates to `Money.percentOrNull` (same half-up rule; check existing tests stay green).
8. Aging buckets: the server sends `late: boolean` per bucket (and in `bucketTotals`). The frontend drops `LATE_KEYS` and builds "late" and the CashExposureCard sentence from the server's buckets.
9. Payout zod schemas move from `payoutController.ts` to `validators/`. Keep each entry point's current cap; name the caps as constants beside `MAX_PAYOUT_LINES`.

### Efficiency
10. Finance Overview: one open-collection scan per page view. `UnpaidByAgeCard` and the overview tile read the same aging answer (pick one source; no second `/agent-aging` scan on Overview).
11. `overviewService` profitPerOrder tile: top product from one `orderItem.groupBy` on the same delivered filter, not `profitByProduct`. Same tile numbers (test).
12. Reps tab count: a count-only server query (one `commissionEntry.groupBy` with sum > 0). `tabCounts.ts` uses it; the full `listOwed` loads only on the Reps tab.
13. `orderController.getOrderCounts`: run counts and the permission-gated `countOverdue` with `Promise.all`.
14. `cashFlowService.forecastScenario` and `getCashForecast`: independent awaits in one `Promise.all`.
15. `profitService:410`: one `feeRule.findMany(distinct partnerUserId)` instead of `resolveFee` per partner.
16. `collectionsBackfillService.planFeeStamps`: load fee rules once per batch of partners; add a pure `pickFee(rules, outcome, on, total)` beside `resolveFee` and make `resolveFee` use it (single rule source).
17. `agentReconciliationService.createDraftCollection` (and reject at ~399): use the tenant id the caller already has, not an extra `order.findUnique`, if this code is in the M5 diff.
18. `partnerSettlementService.loadMatchIndex`: push onto the existing array, no copy per insert.

### Dead code after T45 (grep first)
19. Delete `financialService.getAgentCashHoldings` and `AgentHolding`.
20. Delete the inline backfill HTTP handlers in `financialController.ts` (~238–505) and their routes (`financialRoutes.ts:64-66`) if no caller outside tests: the scripts plus `commissionBackfillService` / `collectionsBackfillService` are the one path (the old commission handler can double-post next to the new service). Keep anything the negative-cash sync still needs, as a one-line call into the service.
21. Delete socket emitters with zero callers (`emitAgentBalanceUpdated`, `emitDepositVerified`, `emitDeliveryUpdated`) and the two `agentReconciliationController` emits with no listener, plus the `getAgentBalance` read made only for them.
22. `agentReconciliationService.verifyCollection` / `bulkVerifyCollections` (no production caller after T45): delete them if their tests can move to the live path (`partnerSettlementService` / deposit verify) with the same F-912 concurrency coverage. If that coverage cannot move, keep them and say why.
22b. Aging CSV: `AgentCollections.tsx` uses the `agent-aging` export (`useFinanceExport`); delete `downloadAgentAgingCSV`, the controller export and `/agent-aging/export/csv`.

## Lane B

23. Tests: use `bearer(token)` from `helpers/superAdminToken.ts` instead of local `auth` in the M5 tests; `m5Payouts` uses `mkUser`'s token.
24. Add `accountBalance(tenantId, code)` to `helpers/ledgerPost.ts`; use it in the tests with a local `balance(code)` (number form; keep string form only where asserted as a string).
25. `helpers/settlementFixtures.mkPartner` gets `daysToPay` and `phone` options; delete the local partner fixtures in `cashChain`, `collectionsAging`, `collectionsReminder`.
26. `m5CollectionsBackfill` uses `settlementFixtures.mkOrder` / `mkCollection` where the shapes fit; `today` helpers use `ymdOfUtc(new Date())`. Leave a fixture local if the shared one would need a behaviour change.
27. Frontend `RepCommissions.tsx`: use `monthName` from `pages/dashboard/format.ts` (check it gives long names).
28. Frontend: one `pct` helper for the finance pages (overview/model `wholePct`, profit/format `pct`, products/model `pct`) if they round the same way; else leave and say so.
29. `financialStore.ts`: drop unused filter fields and `error`; flatten `pagination.expenses` / `loadingStates.expenses`.

## Skipped (with reason)
- Manual `tenantId: resolveTenantId()` filters on scoped models: kept as defence in depth; harmless.
- `GET /financial/reports`, `/collections/deposit`, `/transactions/:id/reconcile`: PRD says the paths stay (T45 decision).
- `addFeeRule` array-or-object body: changing it changes the API contract.
- `monthlyPl` one groupBy per column: default is 3 columns; low value.
- Backfill per-order GL writes: one-shot script; item 2 and 16 cover the shared parts.
- `claimCovers` part-cover loop, `syncNegativeCashFindings` loop, `runwayData` chart reload: small.
- Moving the mobile collection calls to `collections.service.ts`: layering only.
- Dead helpers in `utils/format.ts`: they predate M5.
- Backfill logic in `src/services`: tests import it; the months are the T30 scope.

## Backlog (Phase 7 tickets)
- Finance action permissions as matrix pairs (`collections:verify`, `collections:block`, `findings:write_off`); remove `roles` from `financePerms` (joins "per-route finance permissions").
- Finance job queue: always Bull, mock in tests; use `runJobInTenant`.
- Ledger export files on worker tmp disk: move to R2 with signed URLs (touches the production deploy).
- `DEFAULT_PERIOD_NOTES` hard-coded for 2026-08/09: move into the tenant's `SystemConfig.periodNotes` with a data script (touches the production DB).
- Frontend `MONEY_KEY` regex money parsing: typed money fields.

## Checks (each lane)
Backend `prisma generate`, `tsc --noEmit`, lint, build, and every test file of a touched service run alone with `--runInBand --forceExit`. Frontend tsc (no new errors), lint, build, vitest. Commit; report the sha and the grep evidence for each delete. Do not push.
