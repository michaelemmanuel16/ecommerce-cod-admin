# M8 wave 5, lane B: COD-76 T19 (milestone tests)

Worktree `.claude/worktrees/m8-b`, branch `m8/lane-b` (reset to `feature/m8-marketing` at the T10/T11 merge). Test DB `ecommerce_cod_test_b`. **Tests only.** No change to `src/services`, `src/controllers`, `src/routes` unless a test finds a real bug: then stop and report it, do not fix it yourself. Lane A is building the Marketing page and adds `products()` to `marketingFunnelService.ts`: do not touch it.

Read first: repo `CLAUDE.md`; `docs/plan/M8.md` row T19; the existing M8 tests (`src/__tests__/unit/meta*`, `marketing*`, `campaignStatus*`, `src/__tests__/integration/meta*`, `marketing*`, `campaignMapping*`) and `src/__tests__/fixtures/metaInsights.json`.

Most T19 criteria already have tests. Add only what is missing:

## 1. Coverage note
In `docs/plan/M8-T19-coverage.md`: a table, one row per T19 criterion (fixture numbers, job idempotency, FX and ledger, mapping, max CPA, two-tenant, token secrecy), with the test file and test name that covers it. Gaps get a new test below.

## 2. `src/__tests__/integration/m8EndToEnd.test.ts`
Meta HTTP mocked with the fixture (same mock style as the existing insights tests). Two tenants, A (GHS store, NGN account, FxRate 112 inverse as the store uses) and B (own account and spend).
- Tenant A: run the daily job body (the function the queue calls for one tenant) → `MetaSpendDay` rows, one expense per (account, day), 5080 total = converted spend; `GET /api/marketing/summary` spend equals the 5080 total; `/campaigns/performance` lists the fixture campaigns with spend.
- Run the job again: row counts, values, expense count, journal entry count and 5080 balance unchanged.
- Change one day's spend in the mock and run again: exactly one new journal entry with the difference.
- Tenant B data never appears in any tenant A response (`/summary`, `/funnel`, `/campaigns/performance`, `/campaigns/unmapped`, `/api/meta-ads/accounts`).

## 3. `src/__tests__/integration/m8TokenSecrecy.test.ts`
Seed an account whose decrypted token is a unique string (e.g. `EAAtestSECRET123`).
- Call every GET/POST under `/api/meta-ads` and `/api/marketing` as an owner: the JSON body never contains the plain token, `enc:v1:`, or `access_token`.
- Spy on the app logger (all levels) and `console`: run `pullAccount` through each failure path (error 190, rate limit to exhaustion with sleep injected, a network error whose message contains a URL with `access_token=<token>`). The token never appears in any log call argument, `lastPullError`, a notification body, or a Finding.
- If the network-error case leaks the token anywhere, stop and report (that is a real bug).

## Checks
`npx prisma generate && npx tsc --noEmit && npm run lint`; the two new files plus the existing M8 integration files by name with `--runInBand --forceExit` (time-box each run). Never the full suite.

## Report
One commit `test(M8): end-to-end and token secrecy tests (COD-76)`. Do not push. Reply: sha, files, check output, the coverage table, any bug found.
