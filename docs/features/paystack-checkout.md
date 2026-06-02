# Paystack Checkout & Webhook Infrastructure

Infrastructure for processing Paystack webhooks reliably and exposing checkout primitives to embedded host pages. This is the umbrella for the multi-issue payment-rebuild work (CODA-1..5 from the parent plan).

Parent plan: `~/.claude/plans/i-want-to-improve-sleepy-sun.md`

---

## MAN-55 — Webhook idempotency audit + WebhookEvent table
**Date:** 2026-05-29 | **Type:** feat | **Branch:** feature/man-55-webhook-idempotency | **Commit:** 69454b5

### Summary
Adds a `WebhookEvent` dedup table with a unique constraint on `(provider, event_type, reference)` and an INSERT-or-bail gate at the top of `paystackController.handleWebhook`. Duplicate webhook deliveries from Paystack (replays, retries, double-fires) are caught at the DB layer, acknowledged with `200 + duplicate:true`, and never re-trigger side effects. The pre-existing atomic `UPDATE ... WHERE payment_status != 'paid'` inside `handleChargeSuccess` is kept as a second-line defense (belt + suspenders).

### Changes
- **Backend:** New `WebhookEvent` Prisma model with unique constraint on `(provider, event_type, reference)`, nullable `tenant_id` FK to `Tenant`, SHA-256 `payload_hash` reserved for forensic audit. Gate inserted in `paystackController.handleWebhook` after HMAC verify, before any side effect: best-effort tenant resolution from `metadata.orderId`, then `prisma.webhookEvent.create`. P2002 catch returns duplicate ACK; non-P2002 errors re-throw to the existing 200-on-error stance.
- **Frontend:** No changes (no UI surface).
- **Database:** Migration `20260529130600_add_webhook_event_idempotency` adds `webhook_events` table with `SERIAL` PK, unique index on `(provider, event_type, reference)`, indices on `tenant_id` and `received_at`, and `CASCADE` FK to `tenants(id)`.

### Key Files
- `backend/prisma/schema.prisma` — new `WebhookEvent` model + `Tenant.webhookEvents` back-reference
- `backend/prisma/migrations/20260529130600_add_webhook_event_idempotency/migration.sql` — hand-rolled SQL matching project SERIAL/CASCADE convention
- `backend/src/controllers/paystackController.ts` — idempotency gate (lines 40–64) + `resolveTenantFromEvent` helper (lines 89–98) with `Number.isInteger && > 0` guard
- `backend/src/__tests__/unit/paystackController.test.ts` — 2 tests: triplet dedup across 3 replays + distinct-reference independence

### Verification
- Replay the same `charge.success` payload 3× → 1st returns `{received:true}`, 2nd + 3rd return `{received:true, duplicate:true}`, `verifyTransaction` called once, atomic `UPDATE` runs once.
- Two distinct references → both process independently, `verifyTransaction` called twice.
- Malformed `metadata.orderId` (`"abc"`, `NaN`, empty, negative, decimal) → `resolveTenantFromEvent` returns `null` without crashing Prisma; dedup row still written with `tenant_id = NULL`.

---

## MAN-66 — Per-tenant Paystack integration + session expiry UX fix
**Date:** 2026-06-02 | **Type:** feat | **Branch:** feature/man-66-tenant-paystack | **Commit:** 94500c1

### Summary
Each tenant now configures their own Paystack public + secret keys in Settings → Integrations; buyer funds settle directly into the tenant's Paystack account. Webhook URL becomes per-tenant (`/api/paystack/webhook/:tenantSlug`); HMAC is verified with that tenant's secret. MAN-55's `WebhookEvent` table is retrofitted to tenant-scoped dedup so two tenants can share a Paystack reference and process independently. Bundled with a UX fix to the session-expired flow: backend now returns a clean 401 + code instead of leaking `jwt malformed` as a 500, and the frontend interceptor dedupes toasts so parallel dashboard requests can't stack the same error 10×.

### Changes
- **Backend (Paystack):** `paystackService.initializeTransaction/verifyTransaction/validateWebhookSignature` accept `tenantId` and load that tenant's encrypted secret via `SystemConfig.paystackProvider`. New route `POST /api/paystack/webhook/:tenantSlug` resolves tenant from URL slug, HMACs against tenant secret, dedupes on `(tenantId, provider, eventType, reference)`. Legacy unscoped `POST /api/paystack/webhook` returns 410 with a hint pointing at the per-tenant URL. `paystackService.requireConfig` throws `AppError(400, 'PAYSTACK_NOT_CONFIGURED')` so a public order on a tenant without keys returns a clean 400 + Integrations hint instead of a 500 (the checkoutForm-save toggle validation lands with the three-button Paystack toggles in Phase 3 / MAN-57).
- **Backend (auth UX fix):** `authController.refresh` wraps `verifyRefreshToken` in try/catch and throws `AppError(401, 'SESSION_EXPIRED' | 'TOKEN_FORMAT_OUTDATED')` instead of letting raw `JsonWebTokenError` bubble to the global error handler as 500 + `"jwt malformed"`.
- **Frontend (Paystack):** `PaystackIntegration.tsx` renders the tenant-scoped webhook URL using `systemConfig.tenantSlug` and surfaces the masked secret state on first load.
- **Frontend (auth UX fix):** `api.ts` adds `handleSessionExpired(message)` with a module-level `sessionExpiredHandled` guard so 6 parallel widget 401s collapse to a single logout + redirect. Fixed `react-hot-toast` ids (`'session-expired'`, `'server-connection-lost'`) dedupe the toast itself. Real 5xx / network failures show "Server connection lost. Retrying…" without forcing logout, preserving the session for retry.
- **Database:** Migration `20260601190000_per_tenant_paystack` drops the old unique `(provider, event_type, reference)` and adds the new tenant-scoped tuple. Follow-up migration `20260602060000_backfill_webhook_event_tenant_id` backfills `WebhookEvent.tenant_id` from `orders.payment_reference`, deletes any rows it can't reconcile, then flips the column `NOT NULL` so the cross-tenant guard can't be bypassed by legacy null-tenant rows.

### Key Files
- `backend/prisma/schema.prisma` — `WebhookEvent.tenantId` NOT NULL + new unique tuple
- `backend/prisma/migrations/20260601190000_per_tenant_paystack/migration.sql` — backfill → constraint swap
- `backend/src/services/paystackService.ts` — per-tenant scoping for all three methods
- `backend/src/controllers/paystackController.ts` — tenant slug resolution + tenant-scoped HMAC + dedup
- `backend/src/routes/paystackRoutes.ts` — new `/:tenantSlug` route + legacy 410
- `backend/src/controllers/publicOrderController.ts` — passes `form.tenantId` into Paystack init
- `backend/src/controllers/authController.ts` — refresh endpoint JWT error wrapping
- `frontend/src/services/api.ts` — `handleSessionExpired` + deduped toasts
- `frontend/src/components/settings/integrations/PaystackIntegration.tsx` — per-tenant webhook URL block
- `backend/src/__tests__/unit/paystackService.test.ts` — per-tenant scoping coverage
- `backend/src/__tests__/unit/paystackController.test.ts` — tenant slug 404, HMAC against tenant secret, cross-tenant dedup, legacy 410
- `frontend/src/__tests__/components/PaystackIntegration.test.tsx` — masked secret, webhook URL render, mode persistence

### Verification
- Two tenants each paste their own test keys; each tenant's orders land only in their own Paystack dashboard.
- Per-tenant webhook URL receives + verifies HMAC with that tenant's secret; same reference from two tenants processes independently (one `WebhookEvent` row per tenant).
- Public order on a Paystack-configured form whose tenant hasn't added keys → 400 `PAYSTACK_NOT_CONFIGURED` with a Settings → Integrations hint (form-save toggle validation arrives with MAN-57).
- Session expiry on the Admin Dashboard: single `"Your session has expired. Please log in again."` toast + redirect to `/login`. The previous `"jwt malformed"` 500 and stacked `"Server connection lost. Retrying…"` toasts are gone.
- `paystackSecretKey` never appears in any public API response.
