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
