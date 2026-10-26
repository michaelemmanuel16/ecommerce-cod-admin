# M5 Settlement and Finance

Milestone M5 of the CodAdmin rebuild. Delivery fees are booked per outcome and kept by the partner from the cash. Partner settlements match paid lists to orders and post one net deposit. Rep commissions are booked when earned and paid through one payout record. Plan: `docs/plan/M5.md`. PRD: `docs/prd/areas/07-deliveries.md`, `docs/prd/areas/10-finance-pay.md`.

---

## COD-47 — Settlement schema, chart of accounts and payout reshape
**Date:** 2026-10-26 | **Type:** feat/refactor | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-47-schema`, merge 7b70ae3) | **Commits:** b1a1f14, fca6b46, ec9bb2e, a3fb51b, 4bd8e84, 7c1f4a0, 9bb7782, 0f87ec0

### Summary
Schema for settlements, commission entries and findings, the M5 chart of accounts, and one payout record for reps and agents. Plan tasks: M5-T02, T03, T04.

### Changes
- **Database (`20261026090000_m5_settlement_schema`):** new tables `partner_settlements`, `partner_settlement_lines`, `commission_entries`; enums `FeeBasis`, `DeliveryFeeSource`, `CommissionKind`, `CommissionStatus`, `SettlementStatus`; new Finding types (`fee_rule_missing`, `unmatched_line`, `charge_variance`, `over_pay`, `excess_deposit`, `negative_cash_held`) and status `written_off`; `orders.delivery_fee` and `delivery_fee_source`; aging buckets 0-3, 8-14, 15+; `agent_collections.settlement_line_id`; `agent_deposits.reject_reason` and `settlement_id`; Finding assignee, explanation and resolution; `fee_rules` basis, `valid_from` (old rows 2000-01-01) and `created_by_id`, unique on (tenant, partner, outcome, valid_from). All new models are tenant scoped.
- **Database (`20261026090100_m5_chart_of_accounts`):** adds 2040, 2050, 3010, 5070 and 5080 to every tenant; stops with a list if a manual account already uses one of these codes; relabels 1010 "Cash in Hand" to "Cash at bank and MoMo" (a name the owner changed is kept); retires 1020 and 5040 (inactive, kept for history); 2030 inactive.
- **Database (`20261026090200_m5_payout_expense_reshape`):** `payouts.rep_id` becomes `payee_id` (copied, then dropped), plus `kind` (rep or agent), `reference` and `recorded_by_id`, unique on (tenant, payee, method, reference); `expenses.journal_entry_id`, `paid_from`, `source`; `system_config.period_notes`; `commission_entries.payout_id`.
- **Database (`20261026090300_m5_index_tidy`):** commission entries index on (tenant, user, status, earned_at); findings index on (tenant, assignee, status).
- **Backend:** new GL constants (`DELIVERY_FEES` 5070, `META_AD_SPEND` 5080, `UNAPPLIED_PARTNER_RECEIPTS` 2040, `SUPPLIER_PAYABLES` 2050, `OWNER_EQUITY` 3010); `RETIRED_GL_CODES` is the one list of retired accounts and the seed creates them inactive; `repId` renamed to `payeeId` in payouts, user and export code; one `purgeTenantRows` shared by platform delete-tenant and the owner's delete-account (now also clears commission entries and settlements).
- **Script:** `backend/scripts/check-m5-payout-copy.ts` (`snapshot` before the payout migration, `verify` after).

### Verification
- Backend typecheck, lint and build clean. Unit 109 suites / 1528 tests pass. Integration 135 suites / 1616 tests pass (2 suites skipped). `migrate diff` of the migrations on an empty DB against `schema.prisma`: no difference.
- Production-dump copy (`ecommerce_cod_m3copy`): all four migrations applied, `migrate status` up to date. Payout check: 4 rows, sum 6870.0000 before and after, every `payee_id` equals the old `rep_id`, kind rep.
- Tests: `m5SettlementSchema`, `m5ChartOfAccounts` (config codes checked against the migration SQL; clash, rerun and custom 1010 name), `m5PayoutReshape` (copy on a scratch schema), `tenantDefaults`.
- No screen changes, so no browser check (same as COD-38). `GET /api/gl/accounts` keeps its shape (integration test).

### Open points
- 1020 and 5040 are inactive now; deposit and agent-commission postings move to 1015 and 5070 in COD-48 (M5-T06, T07). M5 ships as one milestone PR, so develop never has the gap.
- COD-179 (backlog, existing bug on develop): the tenant purge sets `journal_entries.created_by` to NULL, which is NOT NULL, so deleting a tenant with journal entries fails and rolls back.
- Plain `@@index([tenantId])` indexes stay (repo convention, M0 schema diff).

---

## COD-48 — Fee rules, delivery fee posting and the cash chain fix
**Date:** 2026-10-26 | **Type:** feat/fix | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-48-fees`, merge 6ee9df6) | **Commits:** 3ce81cf, 0662880, a81e5df, 3c825ca, c7bae39, 4ce130d, aaa7050, d825753

### Summary
Fee rules per partner and outcome, one delivery fee posted per outcome, and one cash chain: collected cash sits in 1015 until the partner deposits, then moves to 1010 once. Plan tasks: M5-T05, T06, T07.

### Changes
- **Fee rules (`feeRuleService`, partner routes):** rules per partner for delivered, failed and returned, with basis and `valid_from`; the rule in force is the latest one on or before the store day (`currentFeeRules`, `storeToday`). Missing rule raises a `fee_rule_missing` Finding once.
- **Fee stamp:** the order state machine writes `delivery_fee` and `delivery_fee_source` in the same update as the status. A second failed attempt posts a second fee (F-935); `Order.deliveryFee` holds the latest fee.
- **GL:** `createDeliveryFeeEntry` posts DR 5070 / CR 1015 per outcome (replaces `createFailedAttemptEntry` and pay-per-delivery 5040). Moving out of delivered reverses the fee. Old 5040 entries reverse into 5070. Partner net cash after fee comes from one `partnerNetCash` helper.
- **Cash chain:** collections post to 1015; a verified deposit posts 1015 to 1010 once, any excess to 2040 with an `excess_deposit` Finding. Deposits match open collections first-in, first-out (`planCover`, then `claimCovers`), and the match is stored as `allocations` (`20261026110000_m5_deposit_allocations`) so a reject undoes exactly what was matched.
- **Security fixes (review of a81e5df and 3c825ca):** reject undoes only the stored allocations and is refused for old deposits with none (409); verify and reject claim the deposit row first; the old `markCODAsDeposited` route covers collections through the same `claimCovers` path, so a deposit cannot post twice.
- **Enum:** `JournalSourceType.commission_accrual` (`20261026120000`) for lane B commission accruals, so they cannot be voided by hand.
- **Helpers:** `utils/collectionCash.ts` (`OPEN_COLLECTION_STATUSES`, `outstandingOf`), `utcDateOfYmd` in `kpi/dates.ts`, exported `loadPartner`, `flippedLines` for reversals.

### Verification
- Backend prisma generate, typecheck, lint and build clean. Full backend suite: 259 suites / 3299 tests pass; `reportsOverviewSales` failed once in the full run and passes alone (20/20). Lane run: integration 138 suites / 1656 tests pass, including the deposit race tests.
- No screen changes, so no browser check (same as COD-47). The fee rule screen (T32) and collections page (T36) get browser checks when they land.

### Open points
- `User.deliveryRate` column and the pay-rate fields in the frontend stay; removal is a follow-up ticket.
- `getCashFlowReport` still reads 1020; T27 fixes it.
- `createReturnReversalEntry` still rebuilds amounts from current rates; not moved onto `flippedLines` because it would change rep commission reversals (lane B area).

---

## COD-51 — Commission posting and one payout service
**Date:** 2026-10-26 | **Type:** feat/refactor | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-51-commission`, merge 5fef9db) | **Commits:** 61352d0, 5dcf6c4, aa3198d, 3961d61 (merge of COD-48), 2ea1209

### Summary
Rep commissions are booked when earned and taken back on a return. One payout record and one API pay reps and delivery agents. Plan tasks: M5-T18, T19.

### Changes
- **Posting (`commissionService`, `glAutomationService`):** an earned `CommissionEntry` posts DR 5050 / CR 2020 once (external ref `commission-entry:<id>`, row lock). A return voids the entry and posts the reversal (`commission-entry-void:<id>`). Both use source type `commission_accrual`, so a clerk cannot void them by hand. A paid entry is left alone.
- **Return check:** `createReturnReversalEntry` takes back the rep line of the delivery entry, and the commission void takes back only its own entry. Each amount is reversed once (integration test).
- **Backfill (`commissionBackfillService`, `npm run backfill:commission-entries`):** turns open delivered orders with unpaid commission into earned entries. It prints a count and a total before it writes, and a second run writes nothing. Dry run on the production copy: 1,061 entries, GH₵5,305.00 (418 adopted, 643 posted).
- **Payouts (`payoutService`, `payoutRoutes`):** one service for reps (commission, upsell, target reward) and delivery agents (target reward only). It pays open entries oldest first and splits the last entry on a part payment. It posts DR 2020 / CR 1010 and stores the method, reference and recorder. It rejects an amount above owed ("Owed is GH₵N") and a second payout on the same entries ("Already paid"). The reference is unique per payee and method. There is no delivery fee line. New `payouts` permission [view, create]. The old rep payout routes are removed.

### Verification
- Backend prisma generate, typecheck, lint and build pass. Full backend suite on the lane head (merged tree is the same): 259 suites, 3317 tests pass.
- Tests: `m5CommissionPosting` (idempotent, concurrent, return, backfill), `m5Payouts` (owed preview Adwoa 2,034 and Nana 134, above-owed, already paid, concurrent payouts, reference unique, permissions, two tenants).
- No screen changes, so no browser check. The payout form and Rep commissions tab come in T38.

### Open points
- On a return, `createReturnReversalEntry` still uses the rep's current rate, not the amount booked at delivery. If the rate changed in between, that reversal can be off. This existed before M5. Follow-up ticket.
- Production order: run `npm run backfill:payout-gl` before the commission backfill.

---

## COD-52 (part 1) — Expenses, journal, ledger and their screens
**Date:** 2026-10-26 | **Type:** feat/fix | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-52-expenses-journal`, merge 5600630) | **Commits:** 9bc01d9, a6f02c0, f227b89, 28654c1, b0ef530, 3d03545, 291733c, afe14d9, 153c021, a8f91bb, 6cca46f

### Summary
Expenses post to the ledger. Manual journal entries, ledger browse and exports have their own permissions. The Expenses, Chart of accounts, Ledger and Journal screens are rebuilt on these APIs. Plan tasks: M5-T28, T29 (backend), T39, T42 (screens). T24 to T27 and T30 are part 2.

### Changes
- **Database (`20261026130000_m5_expense_categories`):** expense categories follow the PRD F-918 map (Packaging, Software, Office and internet, Transport, Photography, Bank charges, Salaries, Marketing, Other). Old names are mapped, not kept.
- **Expenses (T28):** an expense posts DR 5100 (or 5080 for Meta ad spend) / CR 1010 on its expense date. Edit and delete reverse or replace the entry. Paid from MoMo, Bank or Cash. Receipts: images and PDF, checked by file signature; only our upload paths and storage host are saved. A closed month refuses changes. Rows made by the system are locked.
- **Journal and ledger (T29):** `journal` permission [post, void] and `expenses` [view_all, edit, delete]. One void rule map (`withVoidRule`): only hand-made entries can be voided; `commission_accrual` and `delivery_fee` cannot. Ledger lines sort by entry date then id, and each line's balance is the sum of the earlier lines in that order (also on later pages, under a date filter, and in both CSV exports). Four exports, the large ones as a background job with keyset paging. Finance health rules run once as a job.
- **Screens (T39, T42):** Expenses list and breakdown with server search, the form gets its rules from the server (categories, closed month, receipt limits), in-page receipt viewer. Chart of accounts with search and Inactive tag, trial balance, ledger with Void on manual lines only, journal entry with a live balance check that blocks Post when out of balance. `GuardedButton` and `FINANCE_PERMS` show why a button is disabled (hover, keyboard focus and screen reader). `ui/Modal` has an opt-in `closeOnEscape`; `ui/Tooltip` opens on focus.

### Verification
- Merged tree (5600630): backend prisma generate, typecheck, lint and build clean; full backend suite 262 suites / 3391 tests pass. Frontend lint and build clean; vitest 1215 of 1216 pass; the one failure (`Inventory` "?action=allocate", not M5 code) passes alone, 11 of 11, and fails only under machine load.
- Tests: `m5Expenses`, `m5JournalExports` (back-dated entries out of order: order, balances, page 2, date filter, CSV, job file), `fileSignature`, `financeScreens`, `expenseRules`, `journalBalance`, `ledgerExportJob`, `modalEscape`.
- Browser check (admin, clerk, viewer; light; 1440 and 760): chart search and Inactive tag, trial balance in balance, 1010 named "Cash at bank and MoMo", Void only on manual lines, expense list and breakdown, locked Meta row, receipt viewer, category list as F-918, closed-month notice, journal Empty and Out of balance states with Post disabled, viewer tooltips, ledger fits at 1440 and scrolls inside its card at 760, Escape closes Add Expense.

### Open points
- In dark mode the Finance panel stays light; the page restyle is T34.
- Console warnings on the Finance page come from the older DateRangePicker and FinancialDashboard.
- COD-52 stays In Progress until part 2 (T24 to T27, T30).

---

## COD-53 (T32) and COD-54 (T38) — Fee rules screen, payout form and Rep commissions tab
**Date:** 2026-10-26 | **Type:** feat/fix | **Branch:** feature/m5-settlement-and-finance (lane `m5/b-fee-payout-ui`, merge 278cb5d) | **Commits:** 7778851, cd34147, 8fcf3a2, 8d58819, 996c3d0

### Summary
The partner drawer has a Fees tab for delivery fee rules. One payout form pays reps and delivery agents. Finance has a Rep commissions tab. Plan tasks: M5-T32 (COD-53), M5-T38 (COD-54).

### Changes
- **Fees tab (T32):** delivered, failed and returned fee rules per partner with a start date. A second rule on the same date for the same partner and kind is refused on its row. Amounts from the API are numbers; the form turns them into strings before editing.
- **Payout form (T38):** one modal for reps and delivery agents. It shows the owed amount, refuses an amount above owed ("Owed is GH₵N"), and records method and reference. A part payment splits the oldest open entry. Record payout is disabled with a reason (hover, focus and screen reader) for users without `payouts:create`. The close button has an accessible name; Escape closes the modal.
- **Rep commissions tab (T38):** owed, paid and entries per rep. The table fits at 1440 and scrolls inside its card at 760.
- **Permissions:** frontend `Resource` and `Action` types include `payouts`, `journal`, `expenses`, `post`, `void`, `edit` and `view_all`.

### Verification
- Merged tree (278cb5d): backend prisma generate, typecheck, lint and build clean; full backend suite 262 suites / 3398 tests pass. Frontend lint and build clean; vitest 152 files / 1246 tests pass.
- Browser check (owner and viewer; light and dark; 1440 and 760): Fees save, same-date rule refused, weighted fee GH₵25, owed and paid totals, above-owed refused, GH₵20 part payment split the oldest entry, disabled Record payout reason, modal close name and Escape.

### Open points
- T37 (manual partner payout modal) waits for T12 in COD-49 (lane A).
- COD-53 stays In Progress until T34 to T37. COD-54 stays In Progress until T40, T41, T44 and T45.

---

## COD-49 — Findings, partner payouts and settlement matching
**Date:** 2026-10-26 | **Type:** feat/fix | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-49-findings`, merge b296cd9) | **Commits:** a007814, 06c39f5, 98ff474, 4393953, 573d79b, 88606fa, 815b2cb, 4029929, d3d16ef, 23c42e8, e6082bc, 89c3239, 0099812, 9c5edb7, 7475469, 9a4ad27, c2a68d1, b05dff0

### Summary
A delivery partner's payout is recorded once, matched to its orders, and posted to the ledger. Anything that does not match opens a Finding. Plan tasks: M5-T08, T10, T11, T12, T17.

### Changes
- **Findings (T08):** list, assign (the new assignee gets an in-app notice), explain, write-off (owner only, once) and auto-close of a cleared short_pay. Write-off entries use source type `finding_writeoff`, which cannot be voided by hand.
- **Write-off accounts:** short_pay, cash_gap, unpaid_term and negative_cash_held post DR 5100 / CR 1015. excess_deposit and over_pay post DR 2040 / CR 5100. **This corrects PRD F-909**, which says CR 1015 or 2040 for all types; the 2040 types hold money we owe back, so they are a debit to 2040.
- **Record partner payout (T10):** one service behind the API route and the MCP tool `partner_payout_record`. The API audit row now has the same shape as the MCP one. Migration `20261026150000` adds the tool to every Owner role and is safe to run twice.
- **Settlement matching (T11):** matches payout lines to orders, reconciles collections, posts one deposit, trues up fees and opens Findings. Fee, true-up and write-off entries share one post-once helper.
- **Manual payout (T12):** pays the oldest unpaid orders first; excess goes to 2040. The preview uses the same planner, so the preview and the result are the same.
- **CSV connector (T17):** preview (writes nothing) and apply of a partner's status list through the order status service. Parsed with `csv-parse`. Dates must be zero-padded ISO. Migration `20261026160000` adds an orders index on tenant, delivery agent and external order id.
- **Database:** `20261026140000` adds `finding_writeoff` to the GL source types.

### Verification
- Merged tree (b296cd9): backend prisma generate, typecheck, lint and build clean; full backend suite 270 suites / 3489 tests pass. Frontend lint and build clean; vitest 152 files / 1246 tests pass.
- Lane tests: unit 111 suites / 1573 tests; integration on test_a 37 suites / 389 tests.
- No screen changes, so no browser check. The Findings page and manual payout modal come in COD-53 (T35, T37).

### Open points
- PRD F-909 text needs the write-off correction above. Follow-up ticket.
- Findings list page size is at most 100.

---

## COD-53 (part) — Record partner payout modal (T37) and Edit person fix
**Date:** 2026-10-26 | **Type:** feat/fix | **Branch:** feature/m5-settlement-and-finance (lane `m5/b-t37-manual-payout`, merge 1af4b7c; `m5/b-edit-person-fix`, merge 0e5897a) | **Commits:** 25f1b49, 88fdf58, ec4a897

### Summary
The partner drawer has a Record payout button. It records a manual payout from a delivery partner and shows, before saving, which orders it clears. Plan task: M5-T37. Also fixes an owner-reported bug: Edit person opened behind the drawer.

### Changes
- **Record payout modal (T37):** amount, date and reference. A debounced preview uses the T12 planner and lists the oldest unpaid orders it clears. Money above what is owed shows "GH₵N will be held as unapplied" (2040). A used reference shows "This reference was used on <date>" in the modal. "Paid by" is the partner, so there is no method field.
- **`GuardedButtonV2`** (`components/financial`): a ui-v2 button that is `aria-disabled` with a tooltip reason when the user lacks the permission. The drawer uses it for Record payout.
- **Money:** the `applied` key is read as money by the shared money parser.
- **Edit person fix:** `AgentEditModal` now uses the ui-v2 Modal. Before, it used the old modal (z-index 50), which opened under the drawer scrim (54) and outside the layer stack, so it could not be clicked or reached by Tab. Now it opens above the drawer, keeps Tab inside, and Escape closes only the form. A failed save shows its error in the form.

### Verification
- Merged tree (1af4b7c): backend generate, typecheck, lint, build clean; full backend suite 270 suites pass after the lane B test DB was brought up to date (findingsApi failed only because `ecommerce_cod_test_b` missed migrations 20261026140000 to 160000). Frontend lint, build clean; vitest 153 files / 1256 tests pass.
- Edit person fix: tsc, lint, build clean; PartnerDrawer and PartnerPayoutModal tests 21 / 21.
- Browser check T37 (owner and a user without `payouts:create`; light and dark; 1440 and 760): part pay, unapplied warning, save, duplicate reference, Escape closes the modal only, disabled button with tooltip.
- Browser check Edit person (dark, owner): form opens above the drawer, save updates the user, Tab stays in the form, Escape closes only the form and focus returns to Edit person.

### Open points
- Not in T37: receipt upload and a command palette action.
- Edit person still edits the old user fields (Location, Delivery rate) and does not show the saved Location, because the partner detail API does not return it. Follow-up: edit the person through the partner API (base town, days to pay, vehicle types of M4) and drop Location and Delivery rate.

---

## COD-52 (part 2) — Finance reports: cash flow, P&L, statements, profit (T25, T26, T27)
**Date:** 2026-10-26 | **Type:** feat | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-52-p2-reports`, merge 7c2e4c0) | **Commits:** e472798, af26269, 2f6ec73, f266daa, c432f96

### Summary
The finance reports now read the ledger. Plan tasks: M5-T25 (monthly P&L, income statement, balance sheet), M5-T26 (profit by product, order cohort, cost of failed deliveries), M5-T27 (cash flow). No screens yet; the pages come in wave 4.

### Changes
- **One ledger reader:** `statementsService.ledgerAccounts()` gives account balances for a period. The P&L, income statement, balance sheet and cash flow all use it.
- **Statements (T25):** monthly P&L with the August and September note; income statement; balance sheet with 3010 and the result to date.
- **Cash flow (T27):** no double count of 1020; pay-day averages come from settlements; trend by delivery date; expected cash from orders out for delivery, shown as expected, not cash. No forecast cache.
- **Profit (T26):** profit by product (totals from the ledger; orders that do not match a product row go in `notMatchedToProductRow`); order cohort card; cost of failed deliveries and of one refused delivery (`resolveFee` from the fee rules, `lostUnits()`).
- **Delivery fees line:** 5070 plus the retired 5040, so old entries still count.
- **Money:** `Money.percentOrNull`.
- **API:** `GET /api/financial/profit-by-product`, `/cohort-profit`, `/failed-delivery-cost`.
- **KPI guard:** two order-total sums are on the allow-list with a reason: expected cash out for delivery, and the cohort profit. One revenue definition per order is a follow-up (item 11).

### Verification
- Lane: 10 report suites, 120 / 120 tests on test_c.
- Merged tree (7c2e4c0): backend generate, typecheck, lint, build clean; full backend suite 272 suites pass after the KPI guard allow-list fix; frontend lint, build clean; vitest 153 files pass after the wording allow-list fix (the Edit person label is now "Delivery rate").
- No screen changes, so no browser check.

### Open points
- T24 and T30 are still to do; COD-52 stays In Progress.
- Follow-ups: one revenue definition per order; align `DEFAULT_DAYS_TO_PAY` in `cashFlowService` with the lane A resolver after the lane A merge.

---

## COD-50 — Collections and aging (T13, T14, T15)
**Date:** 2026-10-26 | **Type:** feat | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-50-collections-aging`, merge 7dd949f) | **Commits:** 42a72b1, 2197c20, 1ce3198, 887e313, 7f96886, 3f7e0a6, plus the tile label fix

### Summary
Agent collections are verified in one step, aging is computed live per tenant, and the overdue rule uses each partner's days to pay. Plan tasks: M5-T13 (verify and reject), M5-T14 (aging), M5-T15 (Unpaid by agent filter).

### Changes
- **Verify (T13):** verify reconciles the collection in one step. Reject needs a reason. There is no approve route. A balance guard stops verifying more than the cash the partner holds; a refused verify opens a Finding of type `verify_exceeds_cash_held`. Bulk verify is one claim and takes at most 50.
- **Aging (T14):** live per tenant, with buckets 0–3, 4–7, 8–14 and 15+ days, net of the delivery fee. Per partner: cash held, oldest unpaid, days to pay. No cache table.
- **Days to pay:** one resolver, `resolveDaysToPay` in `orderPaymentTag.ts`: the partner profile, then the store setting, then 7. Cash flow uses the same default.
- **Overdue (T15):** `agingService.overdueFilter()` and `countOverdue()` feed the Unpaid by agent filter, the dashboard count and the card, so they agree. The Orders tab screen comes in T35.
- **Screens:** tiles read "Overdue" and "Not yet due"; the overdue settlements tile says "Past days to pay".
- **API:** `POST /api/financial/sync-cash-findings` (was `/refresh-aging`).
- **Database:** migration `20261026170000_m5_collections_aging` drops the unread `agent_aging_buckets` table and adds the Finding type `verify_exceeds_cash_held`.

### Verification
- Lane: unit 1562 pass; integration 15 suites / 276 tests on test_a.
- Merged tree (7dd949f): backend generate, typecheck, lint, build clean; full backend suite passes after one test fix (the fixture now gives each partner a profile, so the partner list test updates Kasapa's profile instead of creating it); frontend lint, build clean; vitest 153 files / 1257 tests pass.
- Browser check (owner, light, 1440): Agent Collections tiles and table agree with the data (Kofi, days to pay 2: GH₵224 overdue + GH₵448 not yet due = GH₵672; all three orders 1–3 days old in 0–3). Dark mode and 760 px: see the progress log.

### Open points
- The aging table still shows three columns (8+ joins 8–14 and 15+); the four-bucket view comes with the T36 screen.
- PRD F-309 says 8 days; align to 7. Follow-up ticket.

## COD-54 (part 2) — Finance report screens: statements, profit cards, cash flow tab, Reports profit tab (T40, T41, T44)
**Date:** 2026-10-26 | **Type:** feat | **Branch:** feature/m5-settlement-and-finance (lane `m5/cod-54-t40-t41-t44-reports-ui`, merge 22a2c10) | **Commits:** 3c5fd8a, 47f0bdc, e6aea36, 017ee33, 6aab900, ed64b0f, 4fab082

### Summary
The finance report screens. Plan tasks: M5-T40 (statements, monthly P&L and profit cards), M5-T41 (cash flow tab with scenario switch, trend chart and Export menu), M5-T44 (Reports "Products and profit" tab that reuses the Finance cards).

### Changes
- **Statements and profit (T40):** income statement and balance sheet cards; monthly P&L with the August and September note and "Not split out" commission for those months; profit by product with the store's net margin target from the API; order cohort card; cost of failed deliveries.
- **Cash flow (T41):** forecast with a pace or target scenario (the target uses the store's own delivery success target); `tightDays` comes from the server; trend chart; Export menu for the reports, using `downloadBlob`.
- **Reports (T44):** "Products and profit" tab with the same cards.
- **One loader:** `useBlock` (60 s module cache by key, one request in flight per key, one status value). Lanes A and B use it too. The cache is cleared on sign-in, sign-up and sign-out, so one person never sees another person's answers (6aab900).
- **Backend:** `parseScenario`, `getCashForecast` (shared by the report and the CSV export), `targetNetMargin` in profit by product.
- **Browser-check fixes:** the P&L end date reads "Up to 26 Oct", not a raw ISO date (ed64b0f); "Not split out" shows once in a cell (4fab082).

### Verification
- Merged tree (22a2c10 + 6aab900): generate, typecheck, lint, build clean on backend and frontend. Full run under 3-lane load had 13 Vitest and 3 Jest (`cashChain`) timeouts; each failed file passes alone (192 / 192 and 15 / 15). Finance Vitest 89 / 89 after the browser-check fixes.
- Browser (demo store, /finance): cards render at 1440 px and 760 px (no sideways scroll), light and dark. Console: two older nesting warnings in `DateRangePicker` and `FinancialDashboard`, not from this lane.

### Open points
- Demo data: the P&L shows GH₵0 delivery fees but the cohort shows GH₵165. The demo orders got fees written to the database after delivery, so no 5070 lines exist. The app posts fees at delivery, so this is not a code fault.
- Follow-ups: `DateRangePicker` nested button warning (backlog); "% of revenue" sub-lines; cash-forecast outflows leave out daily Meta spend.

---
