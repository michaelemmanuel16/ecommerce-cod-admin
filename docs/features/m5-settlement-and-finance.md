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
