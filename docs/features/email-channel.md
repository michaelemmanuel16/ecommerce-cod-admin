# Email Channel

Adds email as a first-class communication channel: transactional automation
(order/status notifications, COD digital-product auto-delivery) and, later, bulk
marketing campaigns — all reusing the existing workflow engine, Communications
module, and `MessageLog` tracking. Transactional email sends from a platform-owned
provider on a dedicated CodAdmin subdomain; bulk marketing uses each tenant's own
BYO provider so the two can't share (or damage) each other's sender reputation.

Epic: **MAN-76**. Plan: `~/.claude/plans/hashed-booping-snail.md`.

---

## MAN-77 — P1.1 Email prerequisites: tenant isolation, platform provider, schema
**Date:** 2026-06-22 | **Type:** feat | **Branch:** feature/email-channel-epic | **Commit:** a2e3bc5

### Summary
Foundation that lands before any send code: closes two verified cross-tenant
isolation bugs, adds the platform transactional sender, lands the additive schema
migration, and exports a delivery-idempotency helper consumed by later issues. No
behavior change to existing send paths — every email send is still inert until
MAN-79/80 wire it.

### Changes
- **Backend:**
  - **C1** — `triggerOrderCreatedWorkflows` threads `tenantId: getTenantId()` into the
    `order_created` enqueue (mirrors the `status_change` path). `executeAction` fails
    closed: tenant-scoped send actions (`TENANT_SCOPED_SEND_ACTIONS`) throw if there is
    no tenant context, instead of running fail-open against the Prisma extension.
  - **C2** — `emailService` config cache converted from a module-global to a
    `Map<tenantId, …>` (mirrors `smsService`), so one tenant's encrypted provider key /
    from-address can't be served to another during cross-tenant sends.
  - **C2b** — platform transactional sender: `sendEmail(options, { as: 'platform' | 'tenant' })`.
    Platform resolves `PLATFORM_EMAIL_*` env only and throws `PLATFORM_EMAIL_NOT_CONFIGURED`
    if unset; tenant path unchanged. Keys documented in `.env.example` (env only, no secrets in repo).
  - **C4** — exported `digitalDeliveryService.hasBeenDelivered(orderId)`: true if a sent
    `digital_delivery` `MessageLog` exists OR a live (non-revoked, unexpired) `DownloadToken`
    exists. The single-delivery-path idempotency guard for MAN-80.
- **Database:** additive migration `20260622154500_add_email_channel` — `MessageChannel +email`,
  `MessageStatus +skipped`, `Customer.emailOptOut` (default false), `Customer.unsubscribeToken`
  (unique, nullable, lazily-generated 32-byte random hex). `ALTER TYPE … ADD VALUE` split from any
  same-tx use (M1). Applied + verified on dev and test DBs.
- **Tests:** `emailChannel.prereqs.test.ts` — 10 tests: order_created enqueue carries tenantId,
  worker refuses null-tenant send, non-send action unaffected, 2-tenant cache isolation, platform
  sender uses `PLATFORM_EMAIL_*` without reading tenant DB, `PLATFORM_EMAIL_NOT_CONFIGURED` throw,
  and the three `hasBeenDelivered` branches.

### Key Files
- `backend/src/services/workflowService.ts` — tenantId on the order_created enqueue
- `backend/src/queues/workflowQueue.ts` — fail-closed tenant guard; `executeAction` exported for tests
- `backend/src/services/emailService.ts` — tenant-keyed cache; `getPlatformConfig()`; `as` param on `sendEmail`
- `backend/src/services/digitalDeliveryService.ts` — `hasBeenDelivered()` idempotency helper
- `backend/prisma/schema.prisma` + `migrations/20260622154500_add_email_channel/migration.sql`
- `backend/.env.example` — `PLATFORM_EMAIL_*` documentation

### Follow-ups (noted at /simplify, deliberately out of scope here)
- Move tenant enforcement down to the worker fork (refuse untenanted DB-touching jobs) and retire the
  action-type denylist — behaviour change across all action types + legacy enqueues; own ticket.
- An `enqueueWorkflowExecution` helper that captures `tenantId` so no call site can forget.
- Extract the now-5×-duplicated tenant TTL cache shape (sms/whatsapp/paystack/checkoutForm/email) into a util.
