# M0 Correctness Base

Milestone M0 of the CodAdmin rebuild. It makes the test suite, the database schema and the deploy path safe to build on before any feature work starts. Plan: `docs/plan/M0.md`.

---

## COD-2 — M0-I01 Baseline tests and production schema parity
**Date:** 2026-10-20 | **Type:** fix/test/ci | **Branch:** feature/m0-correctness-base | **Commit:** c4f0276

### Summary
Green test baseline, `schema.prisma` aligned with the real database, one additive index migration, and CI and deploy guards so schema drift and failed migrations can no longer pass silently. Production was only read (pg_dump and SELECT).

### Changes
- **Backend:** new characterization test `stockDoubleDecrement.test.ts` pins the stock double decrement (−6 for a 3-set order, −4 for a 2-unit order); the fix test is `it.failing` until M4-T08. The 12 skipped integration tests now name their ticket.
- **Frontend:** test setup installs an in-memory `localStorage` when Node 25+ exposes a broken global one (12 authStore tests fixed).
- **Database:** `schema.prisma` matches the migrations (21 tenant FKs `onUpdate: NoAction`, 2 `tenantId` indexes, `Plan.features` default, `customers_phone_number_tenant_key` name). New migration `20261019233746_add_agent_collections_composite_indexes` (2 `CREATE INDEX IF NOT EXISTS`). The 3 local-only `20260218*` placeholder migrations moved to `backups/`.
- **CI:** the backend test job fails when `prisma migrate diff` finds drift; the lint job runs `scripts/tests/deploy-guard.sh`.
- **Deploy:** `deploy-staging.sh` and `deploy-github-actions.sh` exit 1 when `prisma migrate deploy` fails.

### Reports
- `docs/plan/M0-baseline.md` — test and coverage baseline, parity checks
- `docs/plan/M0-schema-diff.md` — production vs repo vs schema, owner decisions
- `docs/plan/M0-money-units.md` — money columns are major units, rule for M0-T21
- `docs/plan/M0-prod-runbook.md` — apply and rollback steps for the index migration (0.5 s on a prod copy)

### Key Files
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261019233746_add_agent_collections_composite_indexes/`
- `backend/src/__tests__/integration/stockDoubleDecrement.test.ts` (new)
- `frontend/src/__tests__/setup.ts`
- `.github/workflows/backend-ci.yml`
- `scripts/deploy-staging.sh`, `scripts/deploy-github-actions.sh`, `scripts/tests/deploy-guard.sh` (new)
