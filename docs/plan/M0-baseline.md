# M0 baseline (M0-T02, M0-T03)

Run date: 2026-10-20. Branch `feature/m0-correctness-base` at a45e934. Node v26.8.1. Local Postgres container `ecommerce-postgres-dev`.

Setup (M0-T01): `npm ci` in backend and frontend, `npx prisma generate`, `prisma migrate deploy` on `ecommerce_cod_test`. Dev DB `ecommerce_cod` was already up to date. Both DBs show 94 finished migrations in `_prisma_migrations` (dev 95 rows, test 99 rows; the extra rows are rolled-back / unfinished attempts). Both DBs also contain 3 applied migrations that are not in the repo folder (`20260706120000_add_owner_fk_and_store_membership`, `20260706130000_owner_fk_restrict`, `20260707120000_add_tenant_billing_email`). The repo has 91 migration folders, including the 3 untracked `20260218*` placeholders (55 bytes each); prisma accepts them and they are recorded as applied in both DBs, so they were not moved.

## Baseline before fixes

| Suite | Command | Result |
|---|---|---|
| Backend | `npm test -- --forceExit` | exit 0. 87 suites passed, 2 skipped (89). 1085 passed, 12 skipped, 0 failed (1097). |
| Frontend | `npx vitest run` | exit 1. 20 files passed, 1 failed (21). 140 passed, 12 failed (152). |
| Playwright | not run | Not run, as the plan says. |

### Failing tests (frontend, all in `src/__tests__/stores/authStore.test.ts`, 12 of 12 tests in the file)

All 12 fail with the same error, raised in `beforeEach` at `authStore.test.ts:19` (`useAuthStore.setState`):

`TypeError: Cannot read properties of undefined (reading 'setItem')` at `node_modules/zustand/esm/middleware.mjs:297`.

Tests: should initialize with null user and token; should handle successful login; should handle login error; should handle successful registration; should handle registration error; should clear user data on logout; should logout without showing toast; should set access token; should update user preferences; should handle updatePreferences error; should refresh permissions when authenticated; should not refresh permissions when not authenticated.

Cause: Node 25+/26 has a built-in global `localStorage` that shadows jsdom's and is unusable without `--localstorage-file`. Zustand `persist` then has no storage. The test was right; the environment was wrong.

### Skipped before fixes (backend, 12 tests)

`describe.skip` in `integration/webhook-flow.test.ts` (6 tests) and `integration/order-workflow.test.ts` (6 tests). Titles carried no ticket id.

### Coverage before fixes

| Suite | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Backend (`npm run test:coverage -- --forceExit`, exit 0) | 55.37 | 42.73 | 47.96 | 54.91 |
| Frontend (`vitest run --coverage`, 12 tests failing) | not measured while failing | | | |

Backend Jest thresholds today: lines 37, branches 25, functions 29, statements 38 (M0-T35 will set them from these numbers).

## Fixes and skips (M0-T03)

| Item | Action | Why |
|---|---|---|
| `authStore.test.ts` (12 tests) | Fixed | `frontend/src/__tests__/setup.ts` installs an in-memory `Storage` when the global `localStorage` is unusable. No product code changed. |
| `webhook-flow.test.ts` (6 tests) | Kept skipped; title now `[COD-2] ... (skipped: needs seeded test DB)` | Needs a seeded `admin@example.com` user and webhook data. Was already skipped with a TODO. |
| `order-workflow.test.ts` (6 tests) | Kept skipped; title now `[COD-2] ... (skipped: needs seeded test DB)` | Same reason. |

COD-2 is used because no better ticket exists. A grep for `it.skip`, `describe.skip`, `xit`, `xdescribe`, `xtest` in backend and frontend `src` finds only these two titles, both with COD-2.

## After fixes

| Suite | Result |
|---|---|
| Backend `npm test -- --forceExit` | exit 0. 88 suites passed, 2 skipped (90). 1089 passed, 12 skipped, 0 failed (1101). The new suite is `stockDoubleDecrement` (4 tests). |
| Frontend `npx vitest run` | exit 0. 21 files passed. 152 passed, 0 failed. |

| Coverage after fixes | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| Backend (unchanged by the fixes; new test adds a little) | 55.37 | 42.73 | 47.96 | 54.91 |
| Frontend | 57.72 | 50.93 | 56.95 | 58.67 |

Frontend vitest thresholds: lines 30, statements 30, functions 30, branches 15. All met.

## Double-decrement characterization (M0-T04)

`backend/src/__tests__/integration/stockDoubleDecrement.test.ts`. Observed on the local test DB, no delivery agent:

| Package | At creation | At out_for_delivery | At delivered | Total |
|---|---|---|---|---|
| 3 sets | -3 | -3 | 0 | -6 |
| 2 units (F-305) | -2 | -2 | 0 | -4 |

These match the plan. Test A pins them. Test B asserts -3 / -2 with `it.failing` and the text "fixed in M4-T08".

Note: `npm run test:integration -- stockDoubleDecrement --forceExit` runs all integration suites, because the script's `--testPathPattern=integration` is OR-ed with the extra pattern. The new suite is in that run and passes. To run only it: `npx jest --runInBand --forceExit stockDoubleDecrement`.
