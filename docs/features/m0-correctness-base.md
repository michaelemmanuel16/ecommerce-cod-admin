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

---

## COD-3 — M0-I02 Close open routes and the public register
**Date:** 2026-10-20 | **Type:** fix/feat/refactor | **Branch:** feature/m0-correctness-base | **Commits:** 8d31812, 79487dd, 038fd4b, 3f7220a, de2aa64, 5bb21dc, 1809f41

### Summary
Four open doors are closed. Public register is gone. Delivery routes check role and ownership. The public config call needs a tenant or form slug. The legacy Paystack webhook is removed. Plan tasks: M0-T08, T17, T18, T19.

### Changes
- **Backend:** `POST /api/auth/register` and `register` in `authController` are removed (404 now). A proof test showed the old route made a user with `tenant_id` NULL and a role taken from the request body (201). `scripts/report-null-tenant-users.ts` lists such users (read only). Delivery agents reach only their own deliveries (list, detail, route, proof, complete). Owner, admin, manager and accountant read all; the accountant cannot write. Sales reps and other roles get 403. Another tenant's delivery gives 404. An admin who completes a delivery for the assigned agent writes an `AuditLog` row inside the `completeDelivery` transaction. `GET /api/admin/config` needs `?tenant=<slug>` or `?form=<form slug>`, returns only business name and currency, and gives 404 without a slug. `/metrics` and `/health/detailed` need the `x-metrics-token` header equal to `METRICS_TOKEN` (401 otherwise, always 401 when the variable is unset). `/health`, `/ready` and `/live` stay public. `POST /api/paystack/webhook` (no slug) and `handleLegacyWebhook` are removed (404). The slug route and `/verify/:reference` stay. Prod nginx logs for 14 days (read only) showed 0 hits on the legacy route, so no 410 is kept.
- **Frontend:** `fetchConfig(formSlug?)` in `configStore` passes the form slug on public forms and skips the public call elsewhere. `authStore` and `auth.service` lose the register call; the register tests are dropped.
- **Database:** none.

### Key Files
- `backend/src/controllers/authController.ts`, `backend/src/routes/authRoutes.ts`, `backend/scripts/report-null-tenant-users.ts` (new)
- `backend/src/controllers/deliveryController.ts`, `backend/src/services/deliveryService.ts`, `backend/src/routes/deliveryRoutes.ts`
- `backend/src/services/adminService.ts`, `backend/src/controllers/adminController.ts`, `backend/src/routes/adminRoutes.ts`
- `backend/src/middleware/requireSharedSecret.ts` (new), `backend/src/routes/health.routes.ts`
- `backend/src/controllers/paystackController.ts`, `backend/src/routes/paystackRoutes.ts`
- `frontend/src/stores/configStore.ts`, `frontend/src/stores/authStore.ts`
- Tests: `deliveryRoutesAccess`, `publicConfigMetrics`, `publicRegister`, `publicRoutesTenant` (integration)

---

## COD-4 — M0-I03 Tenant columns, uniques and fail-closed scope
**Date:** 2026-10-20 | **Type:** feat/fix/refactor | **Branch:** feature/m0-correctness-base | **Commits:** d5d6442, fdac599, 1027bae, 95fd3d7, f4b7cba, aac0b50, a5fd581, 0be383a, d305875, 4aa088f, 8724251, 278801f, bdd6539

### Summary
Every tenant row now carries a required `tenant_id`. A query on a scoped model with no tenant context throws `TenantContextMissing`. Jobs, public routes, webhooks and sockets all set a tenant before they read data. Plan tasks: M0-T09 to T16.

### Changes
- **Backend:** `tenantIsolationExtension` in `prismaExtensions.ts` is fail-closed. `withoutTenant(reason, fn)` opts out on purpose; platform routes use `withoutTenant('platform')`. A JWT with no tenant that is not a platform admin gets 403. MCP keys with no tenant are rejected. Helpers `runInTenant`, `runInTenantOf` and `runJobInTenant` replace raw `tenantStorage.run`. 14 more models are in `TENANT_SCOPED_MODELS` (the 12 new tables, `PendingCheckout`, `WebhookEvent`); `scopedModelList` test reads `Prisma.dmmf` and fails if a model with `tenantId` is missing. `OrderItem`, `FormPackage` and `FormUpsell` stay child rows; two direct reads and two direct updates were fixed to filter by the parent tenant or form. Unique keys are now per tenant: `(tenant_id, code)` on accounts, `(tenant_id, entry_number)` on journal entries, `(tenant_id, sku)` on products, `(tenant_id, name)` on SMS templates; single-key lookups use the compound key. `checkout_forms.slug` and `message_logs.provider_message_id` stay global. `seedTenantDefaults(tenantId)` is idempotent (16-account chart, default email templates; no SMS defaults exist in code). It runs from `register-tenant` and platform `POST /tenants`; startup seed loops over tenants and logs one failure without exiting. `scripts/backfill-null-tenant-chart.ts` (dry run, `--apply`) moves NULL-tenant chart rows. Aging, reconciliation, message cleanup, pending-checkout cleanup, WhatsApp token refresh and the GL balance check run once per tenant (`forEachTenant`). Workflow and email-campaign jobs without `tenantId` fail with a clear error. `agingService.refreshAll` deletes only the current tenant's buckets. Public forms, tracking, download token, unsubscribe, SMS, Paystack, WhatsApp, order import and auth endpoints resolve the tenant before any query. A WhatsApp webhook with several matching tenant configs is resolved by signature. The order import webhook refuses a config with no tenant. Socket rooms are `t:<tenantId>:role:<role>`, `t:<tenantId>:user:<id>`, `t:<tenantId>:order:<id>` and `t:<tenantId>`. `join:order` checks tenant and ownership. Global `io.emit` calls now go to the tenant. Platform admins join only platform rooms. An expired token is rejected with `TOKEN_EXPIRED`.
- **Frontend:** one shared single-flight `refreshAccessToken()` for axios and socket (about 9 parallel refresh calls per page load before). Only a 401 from the refresh ends the session. The socket reconnects with a fresh token.
- **Database:** migration `20261020120000_add_tenant_id_to_remaining_tables` adds required `tenant_id` (index, FK `ON DELETE CASCADE`) to 12 tables and makes `notifications.tenant_id` required, filled from the parent row. Rows with no parent go to `m0_tenant_backfill_orphans`, then to the owner tenant. Nothing is deleted. Prod-dump rehearsal: 1.03 s, 0 NULL `tenant_id` in 13 tables, orphans 165 notifications and 6 webhook logs. Migration `20261020140000_workflow_executions_tenant_not_null` backfills `workflow_executions.tenant_id` and sets NOT NULL. Migration `20261020130000_per_tenant_uniques` swaps the global uniques for per-tenant uniques. Report: `docs/plan/M0-tenant-backfill.md`.

### Key Files
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261020120000_add_tenant_id_to_remaining_tables/` (new)
- `backend/src/utils/prismaExtensions.ts`, `backend/src/utils/tenantContext.ts`
- `backend/src/services/tenantDefaultsService.ts` (new), `backend/scripts/backfill-null-tenant-chart.ts` (new)
- `backend/src/sockets/index.ts`, `backend/src/sockets/rooms.ts` (new)
- `backend/src/middleware/publicTenant.ts`, `backend/src/middleware/auth.ts`, `backend/src/server.ts`
- `backend/src/services/webhookService.ts`, `backend/src/controllers/paystackController.ts`, `backend/src/controllers/whatsappController.ts`, `backend/src/controllers/publicOrderController.ts`
- `backend/src/queues/` (aging, reconciliation, message cleanup, pending-checkout cleanup, workflow, email campaign)
- `frontend/src/services/tokenRefresh.ts` (new), `frontend/src/services/api.ts`, `frontend/src/services/socket.ts`
- Tests: `tenantFailClosed`, `scopedModelList`, `tenantQueues`, `socketRooms` (unit); `tenantDefaults`, `perTenantUniques`, `agingTwoTenant`, `authFailClosed`, `publicRoutesTenant`, `socketTenantRooms` (integration)

---

## COD-5 — M0-I04 Money helper and Decimal migration
**Date:** 2026-10-20 | **Type:** feat | **Branch:** feature/m0-correctness-base | **Commits:** 2159e62, 50c079a, fd79642

### Summary
One `Money` helper on `Prisma.Decimal`, 31 money columns moved to `Decimal(19,4)`, and a script that proves no value changed. Plan tasks: M0-T20, T21, T26.

### Changes
- **Backend:** `backend/src/utils/money.ts` offers add, sub, mul, div, round half up, compare and `toApi()` (string with 2 decimals). `scripts/verify-money-migration.ts` takes a snapshot (rows, non-null count, sum, min, max per column), compares after the migration, and exits 1 if a value differs by more than 0.0001.
- **Frontend:** none.
- **Database:** migration `20261020150000_money_columns_to_decimal` changes 31 columns in 14 tables (the plan said 29) with `USING round(col::numeric, 4)`. Nothing is divided by 100. `users.delivery_rate`, `products.weight` and `pending_checkouts.paystack_charge_minor` stay as they are. `discount_value` converts as is; code must read `discount_type` first. `scripts/rollback-money-decimal.sql` reverses it. Prod-dump rehearsal: about 1.3 s, zero difference in all 14 tables; the rollback copy also gave zero difference. `moneySchema.test.ts` finds no `Float` on a money field. Report: `docs/plan/M0-money-migration.md`.

### Key Files
- `backend/src/utils/money.ts` (new), `backend/src/utils/__tests__/money.test.ts` (new)
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261020150000_money_columns_to_decimal/` (new)
- `backend/scripts/verify-money-migration.ts` (new), `scripts/rollback-money-decimal.sql` (new)
- `backend/src/__tests__/unit/moneySchema.test.ts` (new)

---

## COD-6 — M0-I05 Move money arithmetic off number
**Date:** 2026-10-20 | **Type:** refactor/fix | **Branch:** feature/m0-correctness-base | **Commits:** 1f596f6, 56ddd18, 5e82a15, f140dd4, 8d312a9, 313b12c, a32aaf6

### Summary
Money maths in the backend uses `Money` (Decimal) only. The API sends money as a 2-decimal string. The frontend parses those strings in one place. Plan tasks: M0-T22 to T25.

### Changes
- **Backend:** orders, checkout, packages, upsells and settlement (T22); finance, GL, aging, commissions, reconciliation, expenses and payouts (T23); analytics, MCP tools, exports, customer and user totals, platform billing (T24) no longer use `number` for money. `Order.depositPaid`, `balanceDue` and `PendingCheckout.balanceDue` are major units (a 249.00 order at 30% stores 74.70 and 174.30). Only `paystackChargeMinor` stays in minor units, converted at the Paystack boundary. One serializer, `Money.jsonReplacer`, is set in `server.ts` (`json replacer`) and also used in the MCP JSON helper and the Redis response cache. MCP money tools return 2-decimal strings plus `currency`. `conditionEvaluator` compares Decimal and number exactly (before, workflow rules on money never matched). Meta CAPI gets `Decimal.toNumber()` at the boundary. Order and profitability xlsx exports write numeric cells. Test: 0.1 added 1000 times gives `"100.00"`. Contract test `moneyContract` checks `GET /api/orders`, `GET /api/financial/summary` and MCP `orders_summary`. No outside script does maths on API money, so the `?moneyAs=number` switch was not added.
- **Frontend:** `frontend/src/utils/money.ts` parses and formats API money strings once; stores, types and pages use it.
- **Database:** none.

### Key Files
- `backend/src/services/financialService.ts`, `glAutomationService.ts`, `orderService.ts`, `agingService.ts`, `analyticsService.ts`, `agentReconciliationService.ts`
- `backend/src/controllers/publicOrderController.ts`, `financialController.ts`, `bulkOrderController.ts`, `shipmentController.ts`
- `backend/src/utils/money.ts`, `backend/src/utils/conditionEvaluator.ts`, `backend/src/utils/currency.ts`, `backend/src/mcp/utils.ts`, `backend/src/mcp/tools/`
- `frontend/src/utils/money.ts` (new), `frontend/src/services/socket.ts`
- Tests: `moneyContract` (integration, new); `financialService`, `analyticsService`, `paystackSettlementService`, `conditionEvaluator.extended` (unit)

---

## COD-7 — M0-I06 Two-tenant test harness and suites
**Date:** 2026-10-20 | **Type:** test/fix | **Branch:** feature/m0-correctness-base | **Commits:** 7041101, a9ca6b0, 40495aa, 4252006, 2ffc560, 6262bff, e7a392a, 7a05361

### Summary
A helper builds two tenants. Suites then prove that tenant B data never reaches tenant A across models, HTTP, sockets, MCP, CAPI and public tracking. Three small public-route faults found by the tests are fixed. Plan tasks: M0-T27 to T30.

### Changes
- **Backend:** `createTwoTenants()` and `asTenant()` in `integration/helpers/twoTenants.ts`; `tenantIsolation.test.ts` is rebuilt on it. New suites: `twoTenantModels` (list, get and count per model), `twoTenantHttp` (delivery routes, admin config), `twoTenantMcp`, `twoTenantCapi` (right pixel and token per tenant), `twoTenantSockets`, and `publicTrackingDownload` (429 on the 31st request, no phone or address, wrong phone gives "not found", 410 for expired, revoked or used-up tokens). Fixes: public tracking no longer returns the customer phone and now returns the delivery partner name; the public download route is limited to 30 requests per 15 minutes per IP; an expired, revoked or used-up download token returns 410 (unknown stays 404). The simplify pass dropped 4 duplicate tests (1335 to 1331 passing); each is covered in another file.
- **Frontend:** none.
- **Database:** none.

### Key Files
- `backend/src/__tests__/integration/helpers/twoTenants.ts` (new), `twoTenantsHelper.test.ts` (new)
- `backend/src/__tests__/integration/twoTenantModels.test.ts`, `twoTenantHttp.test.ts`, `twoTenantMcp.test.ts`, `twoTenantCapi.test.ts`, `twoTenantSockets.test.ts`, `publicTrackingDownload.test.ts` (all new)
- `backend/src/__tests__/integration/tenantIsolation.test.ts`
- `backend/src/middleware/rateLimiter.ts`, `backend/src/routes/publicOrderRoutes.ts`, `backend/src/controllers/publicOrderController.ts`, `backend/src/services/digitalDeliveryService.ts`

---

## COD-8 — M0-I07 Docs, coverage gate and M0 close-out (T34 to T38)
**Date:** 2026-10-20 | **Type:** docs/ci/refactor/fix | **Branch:** feature/m0-correctness-base | **Commits:** 94bd08f, e8689c6, 627bf4e, 82eace0, 1532dfb

### Summary
Docs match the app, the coverage gate holds the current level, the whole M0 diff is simplified, the frontend type check passes, and the browser check found one socket gap that is fixed. Plan tasks done: M0-T34 to T38. M0-T39 (owner review, push, PR) is not started.

### Changes
- **Backend:** Jest `coverageThreshold` is set to the current measured values rounded down: lines 62, branches 49, functions 60, statements 62 (the older baseline numbers were lower). Raising lines to 99 made the run fail (checked by hand), then restored. The M0-wide simplify (T36) adds `enterTenant`, a shared `safeEqual` in `utils/crypto.ts`, `BALANCE_TOLERANCE` in `config/glAccounts.ts`, one `tenantIdForFormSlug` in `tenantLookupService.ts`, and shared two-tenant test helpers. It is a refactor with no behaviour change; 4 duplicate tests were dropped (see COD-7). Fix 1532dfb: the tenant owner logs in as `super_admin`, but the order, finance and team role rooms did not list that role, so the owner's open pages did not update live. The role lists now include `super_admin`. Rooms stay tenant-scoped.
- **Frontend:** 22 old type errors are cleared (type-only changes in 16 files plus a `lodash/debounce` typing shim) so `npm run build:check` passes.
- **Database:** none.
- **CI and docs:** `backend-ci` and `frontend-ci` drop their `pull_request` path filters, so both suites run on every PR. `security-audit.yml` gains a `docs-guard` job that fails on `Shadcn` or `WorkflowEditor` in `CLAUDE.md` and on retired KPI wording in `docs/mockups/v2`. `docs/mockups/v2/finance.html` chart-of-accounts codes are relabelled. `financial-module-prd.md` change log notes that MAN-56 and the multi-store branches are reference only. `CLAUDE.md` is git-ignored in this repo, so its edit (hand-written UI with tokens, `WorkflowWizard`) is on disk only and not in a commit.

### Key Files
- `backend/jest.config.js`, `.github/workflows/backend-ci.yml`, `.github/workflows/frontend-ci.yml`, `.github/workflows/security-audit.yml`
- `backend/src/sockets/index.ts`, `backend/src/__tests__/unit/socketRooms.test.ts`
- `backend/src/utils/tenantContext.ts`, `backend/src/utils/crypto.ts`, `backend/src/config/glAccounts.ts`, `backend/src/services/tenantLookupService.ts` (new)
- `frontend/src/types/lodash-debounce.d.ts` (new), `frontend/src/components/dashboard/`, `frontend/src/hooks/useDashboardData.ts`
- `docs/mockups/v2/finance.html`, `docs/features/financial-module-prd.md`
