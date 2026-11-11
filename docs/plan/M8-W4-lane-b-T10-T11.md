# M8 wave 4, lane B: COD-73 tasks T10 (max CPA and KPI tiles) + T11 (funnel, campaigns, status)

Worktree `.claude/worktrees/m8-b`, branch `m8/lane-b` (reset to `feature/m8-marketing` after the T07 merge). Test DB `ecommerce_cod_test_b`. **No schema changes.** Backend only (the page UI is T14). Lane A is building `metaInsightsService.ts`, `metaPullQueue.ts` and the refresh route in `metaAdsRoutes.ts`: do not touch those files. Do not change `profitService.ts`.

Read first: repo `CLAUDE.md`; `docs/plan/M8.md` rows T10, T11 and "Decide at task time"; `docs/prd/PRD.md` section 5.5 (lines ~263-282) and the max CPA rows near line 568; `docs/prd/decisions.md` R5. Reuse, do not copy:
- `src/services/finance/profitService.ts` `cohortProfit` (how it gets yield, average revenue, landed cost incl. unstamped orders, and the stamped `deliveryFee` per delivered order) and `NOT_ENOUGH_CLOSED`. Extract a small shared helper only if you need the same math per product; keep `cohortProfit`'s output unchanged (its tests must still pass).
- `src/services/kpi/rates.ts` `rates()` (`orderToCashYield` on closed cohorts) and the `CLOSED` / `CONFIRMED` / `DIGITAL` status lists.
- `src/services/marketing/campaignMappingService.ts` `resolveProducts`, `listCampaigns`.
- `src/services/fxService.ts` `rateOn`, `src/utils/money.ts`, store currency via `getCurrency()`.
- Routes go in the existing `src/routes/marketingRoutes.ts` (`requireResourcePermission('marketing', 'view')`), controller next to `marketingMappingController.ts`.

## Definitions (from the PRD, keep exactly)
- **Profit per delivered order before ads** = average delivered order revenue − average landed cost − average delivery fee (the fee stamped on the order from the partner fee rules = the weighted fee, R5). No rep commission, no ads.
- **Max CPA** = profit per delivered order before ads × order-to-cash yield. It is a cost per **placed** order. 0 or less → max CPA 0 and the message "No room for ads at this price".
- **Cohort window** for yield and the averages: orders placed in the 90 days that end 30 days before the range end (closed cohorts, decision "orders older than 30 days"). No closed cohort or no delivered order → `available: false`, message `NOT_ENOUGH_CLOSED`.
- Money is in the store currency. Each money value also has the ad account currency figure and the rate used (`{ store, account, rate, rateDate }`) when the account currency differs. Show ₦ figures rounded to the nearest 10 (PRD: GH₵185 × 112 = ₦20,720; × 34% = ₦7,040; × 42% = ₦8,700).

## T10: `src/services/marketing/marketingKpiService.ts` (one commit)
1. `maxCpa({ to, productId? })`: account level (all orders) and per product (orders that hold the product; revenue = that product's item totals on those orders, landed cost = that product's items, fee = the order fee split by item value like `profitService` splits). Returns `{ available, yieldPct, profitBeforeAds, maxCpa, message? }`.
2. `tiles({ from, to })`: spend (sum `MetaSpendDay` converted at each day's rate, equal to the 5080 ledger total for the range), orders placed (non-digital), confirmed, delivered, **projected cost per delivered** = spend / (placed × cohort yield), **actual cost per delivered** = spend / delivered in range (label "Actual, delivered in range"), max CPA (account). Each tile also for the previous period of the same length (`previous`).
3. Route `GET /api/marketing/summary?from&to` (view) returns tiles + account max CPA.
4. Tests:
   - Unit on the pure math: GH₵249 price, GH₵30 landed cost, GH₵34 weighted fee, rate 112 → ₦20,720, max CPA ₦7,040 at 34%, ₦8,700 at 42%. Price below cost → 0 and "No room for ads at this price". No closed cohort → "Not enough closed orders".
   - Integration on `_b`: seeded orders give the same numbers; grep test that the string `6400` / `6,400` appears nowhere in `src/services/marketing`.

## T11: `src/services/marketing/marketingFunnelService.ts` (second commit)
1. `funnel({ from, to, productId? })`: impressions, link clicks, landing page views, checkouts started (from `MetaSpendDay`; per product = campaigns mapped to it), then orders placed, confirmed, delivered (real CodAdmin orders that hold the product, by `createdAt` in range). Overall = all campaigns and all non-digital orders. Unmapped spend counts in overall totals.
2. `campaigns({ from, to })`: one row per campaign (from `listCampaigns`): name, product, spend, impressions, link clicks, LPV, checkouts, Meta purchases, **CPA = spend / Meta purchases** (null when 0 purchases), **projected delivered = Meta purchases × product yield** (label "Meta purchases"), product max CPA, status, `lowData` (product cohort under 30 closed orders). Totals row.
3. Status (in this order): latest `campaignStatus` not `ACTIVE` → **Paused**; no product → **Not mapped**; max CPA not available → status `null` plus the max CPA message (never guess a status); CPA ≤ 85% of max CPA → **Winning**; CPA ≤ max CPA → **On track**; else **Over max CPA**. Spend but 0 purchases → **Over max CPA**. Put 85 in one named constant.
4. Routes `GET /api/marketing/funnel?from&to&productId` and `GET /api/marketing/campaigns/performance?from&to` (view). Keep the existing `/campaigns` route as it is.
5. Tests: each status rule at its edge (exactly 85%, exactly max CPA, just over); paused beats everything; unmapped spend in totals; low-data flag at 29 vs 30 closed; two-tenant (tenant B rows never in tenant A output); call rep 403.

## Checks
`npx prisma generate && npx tsc --noEmit && npm run lint`, `npx jest --config jest.unit.config.js --forceExit`, new test files plus the existing `profitService` / cohort test files by name with `--runInBand --forceExit`. Never the full suite. Time-box jest runs.

## Report
Two commits: `feat(M8): max CPA and marketing tiles (COD-73)` and `feat(M8): marketing funnel and campaign status (COD-73)`. Do not push. Reply: shas, files, check output, changes from spec and why.
