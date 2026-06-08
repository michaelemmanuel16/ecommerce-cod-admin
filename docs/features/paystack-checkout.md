# Paystack Checkout & Webhook Infrastructure

Infrastructure for processing Paystack webhooks reliably and exposing checkout primitives to embedded host pages. This is the umbrella for the multi-issue payment-rebuild work (CODA-1..5 from the parent plan).

Parent plan: `~/.claude/plans/i-want-to-improve-sleepy-sun.md`

---

## Remaining work & decisions (updated 2026-06-08)

Epic status:

| Issue | Scope | Status |
|---|---|---|
| MAN-55 (CODA-1) | Webhook idempotency + `WebhookEvent` table | ✅ Done |
| MAN-66 (CODA-1.5) | Per-tenant Paystack + webhook routing | ✅ Done |
| MAN-56 (CODA-2a) | Order state machine + `statusVersion` | ✅ Done |
| MAN-67 (CODA-2b) | Checkout builder (Fields tab) | ✅ Done — **skins descoped, see below** |
| MAN-57 (CODA-3) | Embed widget (Mode A/B) + package lock | ✅ Done |
| MAN-58 (CODA-4) | Multi-button COD / Deposit / Full Paystack | ⏳ Blocked by MAN-57 |
| MAN-59 (CODA-5) | Meta CAPI + custom thank-you URL | ⏳ Blocked by MAN-58 |
| MAN-60 (CODA-6) | Tenant payouts / Paystack Transfers | ❌ Cancelled |
| MAN-61 (CODA-7) | Paystack subscription billing (CodAdmin SaaS) | ⏳ Independent track |
| MAN-62 (CODA-8) | Magic Groove dogfood | ⏳ Ops, post-deploy |
| MAN-63 (CODA-9) | Migrate Pile Combo / ManShield / Harmony Boost | ⏳ Ops, post-deploy |

### Key architectural decisions

**Skins cancelled — single template.** MAN-67 (CODA-2b) was titled "Templates + skins (Classic / DRHardsell / Minimal)" but shipped only the Fields-tab builder; the 3-skin system was never built and is now **cancelled, not deferred**. There is **no `skin` column, no `templateConfig` column, no skin router**. The checkout is one template — `frontend/src/components/public/CheckoutForm.tsx`. The embed widget (MAN-57) renders that single template via `preact/compat`. MAN-58's COD / Deposit / Full-Pay CTAs render on that same template, gated by per-form toggles. The product migrations (MAN-62/63) all use it; their `skin = "minimal"` references are moot.

**`paystackPublicKey` lives in `SystemConfig.paystackProvider`, not on `Tenant`.** It is sourced via `paystackService.getPublicKey(tenantId)` (shipped in MAN-66). The MAN-57 config endpoint and MAN-58 CTA wiring use that helper — there is no `Tenant.paystackPublicKey` column despite what the original issue text assumed.

**`CheckoutForm.allowedOrigins` is new.** Added by MAN-57 (Prisma migration, `String[]`, default `[]`). The per-form Origin allowlist is enforced at the **route level** on the new `/api/public/forms/:slug/config` endpoint — the global `/api/public/*` CORS is blanket `origin: '*'`, so per-form 403s cannot ride on it.

**Delivery shape.** MAN-57 → MAN-58 → MAN-59 are three separate PRs in strict dependency order (not bundled). MAN-61 is a parallel, independent PR, built fresh in-house — the outside-contributor PR #220 is being closed, not built upon. MAN-62 + MAN-63 are config/content only (no PR), run after the checkout code deploys to `codadminpro.com`.

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

---

## MAN-57 — Embed widget (Mode A + Mode B) + package lock
**Date:** 2026-06-08 | **Type:** feat | **Branch:** feature/man-57-embed-widget | **Commit:** 513f9ec (pre-merge tip; final SHA assigned on PR merge)

### Summary
Tenants can now embed their checkout on any external page. A new `frontend/embed/` package (net-new Vite library build, Preact via `preact/compat`) ships a small bootstrap that renders the single checkout template (`CheckoutForm.tsx`) inside a Shadow DOM. **Mode A** auto-renders into `<div data-codadmin-checkout data-slug="...">`; **Mode B** attaches order submission to a host's own `<form data-codadmin-checkout-form>`. A per-form **Origin allowlist** (`CheckoutForm.allowedOrigins`) gates the new public `/config` endpoint, and a **package-lock** flag (`?package=N&lock=1` / `data-package data-lock`) deep-links a single-package checkout with the selector hidden and server-side tamper rejection. Two template changes ride along (folded into this PR's scope per the 2026-06-08 issue comment): the desktop checkout collapses to a **single centered column** (`max-w-2xl`), and a per-form **"Show order summary"** toggle (`design.page.showOrderSummary`, default on, no migration) lets the summary block be hidden on pages that already show the offer.

### Changes
- **Backend (config endpoint):** New `GET /api/public/forms/:slug/config` (`publicOrderController.getPublicFormConfig`) extends the public form shape with `paystackPublicKey` (sourced via `paystackService.getPublicKey(tenantId)` — never CodAdmin's key, never the secret) and strips `tenantId`/`allowedOrigins` from the response. Enforces the per-form Origin allowlist at route level (403 when an `Origin` header is present and not on a non-empty allowlist). 5-min in-process config cache keyed by slug, invalidated on form save (`clearCheckoutFormConfigCache`).
- **Backend (allowlist + validation):** New `CheckoutForm.allowedOrigins` column (`String[]`, default `[]`). `checkoutFormController` normalizes each entry through `new URL(value).origin` (strips path/trailing slash, dedupes) on create + update. `checkoutFormRoutes` validates `allowedOrigins.*` with `isURL({ require_protocol: true })`.
- **Backend (anti-tampering):** `createPublicOrder` recomputes all totals from DB package/upsell prices; the client `totalAmount` is used only for dedup matching, never pricing. Package-id mismatch under a lock 400s on top of the existing id check.
- **Frontend (embed package):** `frontend/embed/{embed.tsx,EmbedCheckout.tsx,embedApi.ts}` + `vite.embed.config.ts`. Per-element Shadow DOM, `mounted` WeakSet guards double-mount, `MutationObserver` re-scans for dynamically injected containers. On a digital product the order response carries `authorization_url` and the widget redirects to Paystack; physical products stay COD. Embed build wired into `frontend/Dockerfile` + `scripts/pre-push-check.sh` (built `dist-embed/` is gitignored).
- **Frontend (admin builder):** Settings tab gains the "Embed allowed domains" input; Packages tab gains per-package "Copy direct buy link" (`?package=N`) and "Copy embed snippet" (`buildWidgetSnippet`) actions. `embedSnippet.ts` escapes the slug (`escapeHtml` + `escapeJsString`, `</script>`-safe) and the slug is regex-validated server-side.
- **Frontend (template ride-alongs):** `CheckoutForm.tsx` single-column `max-w-2xl mx-auto`; `OrderSummary` render gated by `design.page.showOrderSummary`; toggle added in `DesignTab.tsx`; `ChecoutFormDesign` type extended.
- **Database:** Migration `20260608120000_add_checkout_form_allowed_origins`.

### Key Files
- `frontend/embed/embed.tsx`, `frontend/embed/EmbedCheckout.tsx`, `frontend/embed/embedApi.ts` (new)
- `frontend/vite.embed.config.ts` (new)
- `frontend/src/lib/embedSnippet.ts`, `frontend/src/lib/orderPayload.ts` (new helper)
- `backend/src/controllers/publicOrderController.ts` — `/config` endpoint, Origin gate, DB-authoritative totals
- `backend/src/services/checkoutFormService.ts` — `PUBLIC_FORM_SELECT`, slug config + cache
- `backend/src/controllers/checkoutFormController.ts` — `normalizeAllowedOrigins`
- `backend/src/routes/{publicOrderRoutes,checkoutFormRoutes}.ts` — route + validation
- `backend/prisma/schema.prisma` + `migrations/20260608120000_add_checkout_form_allowed_origins/`
- `frontend/src/components/public/CheckoutForm.tsx`, `OrderSummary.tsx` — single column + summary toggle
- `frontend/src/components/forms/builder/{SettingsTab,DesignTab,PackagesTab}.tsx`
- `backend/src/controllers/__tests__/publicFormConfigController.test.ts`, `frontend/src/__tests__/lib/{embedSnippet,orderPayload}.test.ts` (new tests)

### Verification
- Backend: 67 suites pass (incl. new `publicFormConfigController.test.ts` — allowlist allow/deny, no-Origin pass-through, empty-allowlist unrestricted, public-key returned, secret never returned). Frontend: 136 tests pass. Workflow validation passes.
- Origin allowlist: request to `/config` from an off-list `Origin` → 403; on-list or no-Origin → 200.
- Package lock: tampered `package_id` POST → 400; totals always recomputed server-side.
- Snippet XSS: `</script>` in slug escaped via `escapeJsString`; slug regex `^[a-z0-9-]+$`.
- Security review (`/cso`, diff-scoped): 0 critical/high/medium; 1 low informational (Origin allowlist is an embedding control, not an access boundary — order endpoint not Origin-gated; abuse-bounded by rate limiter + IP cooldown + dedup).
- Not live-tested: the digital→Paystack `authorization_url` redirect branch through the embed (the dev smoke-test form is physical/COD).
