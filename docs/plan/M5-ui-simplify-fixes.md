# M5 UI lanes: /simplify fixes (one pass after merging UI A, B, C)

Source: /simplify on the three mockup-match lanes (983a4f38, 35272c17, d7b070c3), 2026-10-26. Four reviews (reuse, simplification, efficiency, altitude), deduplicated here. No behaviour change except item 1 (a bug). No schema change.

## Bug
1. After saving an expense or a payout, `Financial.tsx` bumps `saved` and remounts the tab, but the `useBlock` 60 s cache returns the old data. Clear the affected blocks (`clearBlockCache()` or `retry()`), and drop the remount key if it is no longer needed. Add a test: save, then the figures reload.

## Shared data (one request per dataset)
2. Tab counts reuse the tab keys. `useTabCounts` reads `collections:deposits` and `reps:owed` (same loaders and arguments as the tabs). Export small hooks (`useDeposits()`, `useRepsOwed()`) in `pages/financial/profit/blocks.ts` so each key string lives once. No `Promise.resolve(0)` fake call: skip the reps count when the user cannot see reps. No raw `apiClient` in `tabCounts.ts`.
3. `collectionsService.deposits()` is bounded: pending rows plus the most recent N decided rows (server query params if the route has them; else add `status` and `limit` to the existing route, read-only). The count is the pending rows.
4. Forecast loads only the active scenario. The server returns `currentRate` on the `pace` answer too, so the label keeps its "48% delivery success" text.
5. `profitTrendByProduct`: one order `findMany` over the whole span, bucket by delivered month in memory, one Paystack query, no `incomeStatementOver`. Extract the per-order allocation core from `profitByProduct` and reuse it. Export `monthWindows(count, asOf)` from `statementsService` and use it in both places. Keep `m5ProfitReports.test.ts` green (same numbers).
6. Record payout "Paid by" choices come from the cached `collections:aging` partners (or a light names call), not the ranged partner-performance list.
7. Ledger: reset the page in the account-pick handler (or key `AccountLedger` by account) so one pick makes one fetch. Accounts list and trial balance use `useBlock`, so returning to General ledger does not refetch.

## Shared CSS and components (put in `styles/components.css` or `ui-v2`)
8. One modal footer note: `.v2 .dlg .mf .mfnote { margin-right:auto; font-size:12.5px; color:var(--ink-3) }`. Use it in AddExpenseModal, PayoutForm, JournalEntryModal, PartnerPayoutModal. Drop the inline style, `.fnote` (name taken by checkoutForms.css) and the `.r2` wrapper.
9. Modal size prop: `size?: 'md' | 'lg' | 'xl' | 'wide'` in `ui-v2/Modal.tsx` (lg 640px, xl 820px, wide keeps 1120px). Remove every `.dlg:has(...)` width rule.
10. One `.v2 .tablewrap .dt th, td { white-space:nowrap }` with a `td.desc` opt-out. Remove the per-wrapper nowrap rules.
11. `.pgtabs` margin set once in components.css (mockup value). Remove the Finance override. Fold count-pill rules into the base `.tab span` rules.
12. Bar list: one `BarList` component (label, value, colour, optional onClick), used by UnpaidByAgeCard and the Expenses "By category" bars. Grid columns in CSS, not inline. One `.bar-row` link/button rule shared with deliveries.css.
13. One `ChartTip` ({title, rows}) exported next to `AXIS` in `pages/reports/charts.tsx`; use it in cash charts, ProfitTrendCard and CashExposureCard.
14. One `.v2 .dlg .err`. Delete `.payform .err` and `.jeerr`. Reject button uses `Button variant="danger"`, no `.mfreject`.
15. Receipt box (`.revreceipt`, `.rcpt`) moves to components.css; AddExpenseModal's picker uses it. Use `.btn.file` (or Button as label) instead of the inline cursor style.
16. Journal entry modal uses ui-v2 `Select` and `Input` (add a compact mode to Input if needed). Drop `.jsel`, `.jin`, double form class. Mount the body only when open, so state resets without the effect. Keep the read-only Reference field (owner to decide).
17. Use ui-v2 `Pagination` in Expenses and Account ledger. Drop `.expfoot`, `.ledfoot`.
18. `ListSkeleton` inside a card gets its padding from CSS, not four inline styles. Replace other one-off inline styles named in the review (checkbox column widths, `marginTop:0` on kpis, hint colour, mini-button margin) with classes.
19. Shared helpers: `currencySymbol()` in `utils/format.ts` via `Intl.NumberFormat.formatToParts`; used by PayoutForm and CashFlowPanel. `LATE_KEYS` / `isLateBucket` / `lateOf(partner)` and the bucket labels from `collections/model.ts`; CashExposureCard builds its legend from `summary.bucketTotals`.
20. `.two > * {min-width:0}` and a `.stack > * + * {margin-top:16px}` utility in components.css; drop the per-page copies (`.fov .two`, `.collections > * + *`, `.repcom`, `.findings`).
21. Finance-wide rules from lane C (`.cardexport`, `.note .ink`, `.ctact`) go in `financeReports.css`; `financeAccounting.css` keeps only accounting grids.

## Simplify
22. `Financial.tsx` subtitle: no `.replace(/^in /, 'for ')`; give `rangePhrase` a `for` form. Move the owed sentence into an `<OwedLine/>` child.
23. `PartnerPayoutModal` stays a fixed-partner modal. `HeaderPayout` owns the "Paid by" Select and mounts the modal with the chosen partner.
24. `useFinanceExport`: drop `excel` (derive from `format`); find the P&L CSV item by id, not `ITEMS[0]`.
25. `FailedCostCard`: note text in small functions in `copy.ts`; flat JSX.
26. `RepCommissions` tile maths in a `repTiles(reps)` model function (or server `totals`); remove the local `money()` and misnamed `cents()`.

## Dead code (grep for callers before each delete)
27. `.fov-note` rule if no user; `syncCashFindings`; `DepositActionModal.tsx`; `AgentSettlementChart.tsx`; `.agecard`; `financeReports.service` `trend`, `Trend`, `TrendRow`; `.trendctl`, `.trendhead`; `kpis.three` if unused. Keep `UnpaidByAgeCard` and `unpaidByAgeOf` (Overview uses them).

## Skipped on purpose
- Both age charts stay (Overview "By age" and Collections "Cash exposure by partner" are both in the mockup); they share the bucket model (item 19).
- `useUrlTab` hook: two uses only.
- Statements Export opens print (PDF), as T40 needs; owner to decide.

## Checks
Frontend tsc, lint, build, vitest (re-run timeouts alone). Backend tsc, lint, `m5ProfitReports.test.ts`, `m5CashFlow*` tests, and any test of a touched service, run alone. Commit; report the sha.

## Visual gaps (headless compare, 2026-10-27; screenshots in the session scratchpad mockup-compare/)
Bugs first:
V1. General ledger does not load: `GET /api/gl/accounts?limit=200` returns 400 (validator cap). Fix at the right level: either the frontend asks within the cap, or the accounts endpoint allows the full chart (accounts are few). Journal modal account selects then fill. Add a test.
V2. Expenses card title "1–NaN Oct 2026": date formatting bug. Add a test.
V3. Console: `<button>` inside `<button>` (validateDOMNesting) on the Finance page. Remove the nesting.
Layout:
V4. Header buttons sit right of the title as in the mockup (`.head` with `.hd-actions`); the date picker goes in that action row after Export and must not push the buttons below the title at 1440.
V5. Date-range picker uses v2 tokens in dark mode (no white box). Also check the active tab pill, the sidebar user card and "Ask agent" in dark mode against the mockup's dark theme (`docs/mockups/v2/app.css` dark tokens); fix only what is on the Finance page or in its shared components.
V6. Overview KPI tiles: 3 per row over 2 rows as in the mockup; even tile heights (short "n/a" helper).
V7. Subtitle: "for October" when the range is a whole calendar month (or month to date); keep the range phrase otherwise.
V8. Tab count pill hidden when the count is 0.
V9. Aging "All partners" row: fill Oldest (oldest across partners); Status and Actions stay empty on purpose only if the mockup does so (check).
V10. Review collection modal title "Review collection from <partner>"; receipt shows filename and opens on tap.
V11. Statements: cost lines shown as negative, as in the mockup; subtitle money with the currency sign.
V12. Rep payout modal fits its panel (no inputs touching the edge); keep Owed entries and history (T38 needs them) but lay them out inside the modal width. At 760 the commissions table scrolls inside its `.tablewrap` (that is fine) — tiles 2 per row, not 1.
V13. Forecast: "Expected out" helper text as the mockup ("Ads, fees, stock, commissions") if those are the real inputs, else say what is real; week table "Money out" shown negative and Net red when negative.
V14. Record payout: Amount label "Amount (GH₵)" via currencySymbol(), placeholder "0.00", footer note (item 8).
V15. Export menu: right-aligned under the button, mockup width, "More in Reports" with its note on a second line.
V16. Modal close X: no focus ring on open (focus the first field, or use :focus-visible).
Leave as is (allowed or no data): 3PL/Agent tag (no field), AI-agent row in Rep commissions (no data), "% of target", Payout history description column, "Agent found" cards, extra Expenses search (T39), Days to pay column.
Demo data: add an additive script for the local demo DB `ecommerce_cod_browse_b` only (never the copy of production) that creates one pending partner pay-in with a receipt, one Short payout, two more partners with aged unpaid orders, a few expenses and a few posted journal entries, so the next browser pass can check these screens. Keep it in the scratchpad, not in the repo.
