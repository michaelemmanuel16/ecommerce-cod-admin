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
