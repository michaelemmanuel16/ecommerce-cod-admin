# M8 wave 3, lane B: COD-72 task T07 (Meta spend to ledger, with FX)

Worktree `.claude/worktrees/m8-b`, branch `m8/lane-b` (reset to `feature/m8-marketing` after T09 merge). Test DB `ecommerce_cod_test_b`. **No schema changes** (T03 already added `Expense.originalCurrency/originalAmount/fxRate/metaAdAccountId`, `@@unique([metaAdAccountId, expenseDate])`, `FindingType.fx_missing`). Backend only. Lane A is building `/api/meta-ads`, `metaOAuthService`, `metaAdsConnectionService`, `metaTokenHealthService`: do not touch those files.

Read first: repo `CLAUDE.md`, `docs/plan/M8.md` (row T07). Existing code to reuse: `src/services/fxService.ts` (`rateOn`, `makeConverter`, store currency), `src/config/glAccounts.ts` (`META_AD_SPEND` 5080, `CASH_IN_HAND` 1010), how M5 expenses post journal entries (`glAutomationService.ts` / the expense service: find the existing helper that creates an Expense with its `journalEntryId`, and reuse it), the `Finding` model and how M5-M7 code opens and resolves a finding (search for `prisma.finding.`), `src/utils/money.ts`.

## Build `src/services/marketing/metaLedgerService.ts`
`postMetaSpend(adAccountId: number, dates: string[] /* YYYY-MM-DD */)` inside the tenant context. T06 calls it after each pull. Export only; no scheduling here.

For each date:
1. `original` = sum of `MetaSpendDay.spend` for (account, date), in the account currency. Zero rows means 0.
2. Store currency = the tenant's store currency (as `fxService` reads it). Same currency means rate 1.
3. Else `rateOn(tenant, accountCurrency, storeCurrency, date)`. **No rate**: post nothing for that day, open one `fx_missing` Finding (plain words: "No NGN to GHS rate for 2026-11-10. Meta spend for that day is not in the ledger yet. Add the rate in Settings, FX."), no duplicate while one is open for the same (account, date). Next run with a rate posts it and resolves that finding.
4. `amount` = `original x rate`, rounded to 2 dp with the project's money helper.
5. Expense for (account, date) (`expenseDate` = that date at 00:00 UTC, `source=meta`, category per `expenseCategories.ts` notes for Meta spend, description "Meta ads: <account name>", `originalCurrency`, `originalAmount`, `fxRate`, `metaAdAccountId`):
   - None and amount > 0: create it with its journal entry DR 5080 / CR 1010.
   - Exists and amount equal: do nothing (idempotent).
   - Exists and amount differs: post only the **difference** as a new journal entry (increase: DR 5080 / CR 1010; decrease: DR 1010 / CR 5080), then update the expense's amount, originalAmount, fxRate. Keep the first entry; do not edit or delete posted entries.
   - Do it in one transaction per (account, date).
6. Return `{ posted, adjusted, unchanged, waitingForRate }` counts.

## Lock Meta expenses
The existing expense update and delete paths (API and service) refuse an expense with `source=meta`: 409 "Meta ad spend is posted by CodAdmin. Change it in Meta." Nothing else in those paths changes.

## Tests
- Unit (money math): NGN 100,000 at 0.0089 gives GHS 890.00; rounding.
- Integration (`ecommerce_cod_test_b`, seed tenant store currency GHS, an NGN `MetaAdAccount`, `MetaSpendDay` rows, an `FxRate`):
  - first post creates one expense + one entry DR 5080 / CR 1010;
  - re-run changes nothing (same entry count, same balances);
  - spend raised by X posts exactly X (converted); lowered posts the reverse;
  - missing rate posts nothing and opens one `fx_missing`; a second run opens no second one; adding the rate then posts and resolves it;
  - same-currency account uses rate 1;
  - **ledger total of 5080 equals the converted sum of `MetaSpendDay`** after a mix of changes;
  - two-tenant: tenant B run never touches tenant A expenses;
  - updating or deleting a `source=meta` expense through the API gives 409.

## Checks
`npx prisma generate && npx tsc --noEmit && npm run lint`, `npx jest --config jest.unit.config.js --forceExit`, your new test files by name with `--runInBand --forceExit`, plus the existing expense test files you touched. Never the full suite. Time-box jest runs.

## Report
One commit `feat(M8): Meta spend to ledger with FX (COD-72)`. Do not push. Reply: sha, files, check output, changes from spec and why.
