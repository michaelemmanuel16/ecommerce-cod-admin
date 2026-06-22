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

---

## MAN-78 — Reusable email templates + merge tags + workflow picker

**Date:** 2026-06-22 · **Type:** feat · **Branch:** `feature/email-channel-epic` · **Commit:** `ba9495f`

A reusable email object (subject + HTML body + merge tags) shared by both workflow
`send_email` actions (MAN-79) and future bulk campaigns (Phase 2). Templates are
authored/edited rows per tenant; the workflow action references one by `templateId`,
mirroring how `send_whatsapp` picks a template by key. Saving a template never sends it.

### Changes
- **Backend:**
  - **`EmailTemplate` model** — tenant-scoped (`@@unique([name, tenantId])`, `@@index([tenantId])`,
    `@@map("email_templates")`), registered in `TENANT_SCOPED_MODELS`.
  - **`emailTemplateService`** — the six merge tags (`customer_name`, `customer_email`,
    `store_name`, `order_number`, `order_total`, `download_url`); precompiled tag regexes;
    `sanitizeEmailHtml` (sanitize-html allowlist — no script/style/iframe/handlers, forces
    `rel="noopener noreferrer"`); `renderEmailTemplate` (HTML-escapes every value at substitution,
    no re-sanitize since stored bodies are already clean); `DEFAULT_EMAIL_TEMPLATES` (3) +
    idempotent `seedDefaultEmailTemplates(tenantId)`.
  - **CRUD** — `getEmailTemplates/createEmailTemplate/updateEmailTemplate/deleteEmailTemplate` in
    `communicationService` (create/update sanitize the body), zod-validated controllers
    (P2002→409, P2025→404), and routes (list open; mutations require super_admin/admin).
  - **Backfill script** — `backfillEmailTemplates.ts` seeds the 3 defaults for every existing tenant.
- **Frontend:**
  - `emailTemplate.service.ts` — `list/create/update/remove` against `/api/communications/email-templates`.
  - `ActionConfigModal.tsx` — Configure Email gains a template dropdown (loads the tenant's templates),
    with the inline Subject + Email Body fallback when "Custom (write inline)" is selected; merge-tag hint
    lists all 6 tags.
- **Database:** additive migration `20260622184000_add_email_templates` — `CREATE TABLE email_templates`,
  FK CASCADE to tenant, `UNIQUE(name, tenant_id)`. Applied + verified on dev and test DBs.
- **Tests:** `emailTemplate.test.ts` — 8 tests: merge-tag substitution in subject + body, HTML-escape
  injection block, missing/unknown tag handling, sanitize strips `<script>` + `javascript:` URLs + `onclick`,
  `createEmailTemplate` sanitizes on save, seed is idempotent and runs in tenant context.

### Key Files
- `backend/prisma/schema.prisma` + `migrations/20260622184000_add_email_templates/migration.sql`
- `backend/src/services/emailTemplateService.ts` (new)
- `backend/src/services/communicationService.ts`, `controllers/communicationController.ts`, `routes/communicationRoutes.ts`
- `backend/src/scripts/backfillEmailTemplates.ts` (new)
- `backend/src/utils/prismaExtensions.ts` — EmailTemplate registered tenant-scoped
- `frontend/src/services/emailTemplate.service.ts` (new) + `components/workflows/ActionConfigModal.tsx`

### Notes / deferred
- A dedicated **template-builder / Email Campaign tab** (create/edit/preview UI) is intentionally
  deferred to Phase 2 §2.3; MAN-78 ships the model, CRUD, and the workflow picker only. Until then the
  3 seeded defaults are the available templates.

---

## MAN-79 — `send_email` workflow action (the core wire)

**Date:** 2026-06-22 · **Type:** feat · **Branch:** `feature/email-channel-epic` · **Commit:** `b372da6`

The workflow `send_email` action now actually sends. There were two divergent
`send_email` code paths — the live BullMQ worker stub (logged, sent nothing) and a
legacy synchronous `workflowService.executeSendEmail` that read the wrong field — so
this reconciles both to **one shared helper**: one path, one config shape.

### Changes
- **Backend:**
  - **`sendWorkflowEmail(config, context)` in `emailService.ts`** — the single send path.
    Resolves a saved `EmailTemplate` by `config.templateId`, else inline `config.subject` +
    `config.body` (reads `config.body ?? config.message` for back-compat with the old editor field).
    Renders subject + body through the MAN-78 merge renderer with order/customer/tenant context
    (`store_name = tenant.name`, `order_number = order.id`, `order_total = "{currency} {amount}"`
    from `SystemConfig.currency`). Sends via the **platform** transactional provider
    (`sendEmail({ as: 'platform' })`).
  - **`MessageLog(channel=email)`** written `pending` → `sent`/`failed`. Opted-out customers are
    logged `MessageStatus.skipped` (no send); a missing recipient skips cleanly with no log; a prior
    `sent` log for `(orderId, channel=email, templateName)` short-circuits (idempotent — a BullMQ
    retry can't re-send); provider failure records `failed` and does **not** rethrow (no retry storm).
  - **`workflowQueue.ts`** — the live worker `send_email` case now delegates to `sendWorkflowEmail`.
  - **`workflowService.ts`** — the legacy synchronous `executeSendEmail` delegates to the same helper
    (removed the now-unused `sendEmail` import).
- **Frontend:**
  - `ActionConfigModal.tsx` — the inline **Email Body** field rebound from `config.message` to
    `config.body`, fixing the editor↔executor field mismatch end-to-end (the SMS `message` field is
    untouched).
- **Tests:** `sendWorkflowEmail.test.ts` (new, 7 tests) — template render + send + `sent` log; inline
  `config.body` send; legacy `config.message` fallback; opt-out → `skipped` (no send); idempotency →
  `already_sent` (no send, no create); null recipient → `no_recipient` (no log, no send); provider
  failure → `failed` log, no throw. `emailChannel.prereqs.test.ts` updated: the guard-passes test now
  asserts the real helper's `no_recipient` skip shape instead of the old stub's `{ sent: true }`.

### Key Files
- `backend/src/services/emailService.ts` — `sendWorkflowEmail` helper (new export)
- `backend/src/queues/workflowQueue.ts` — worker `send_email` case wired to the helper
- `backend/src/services/workflowService.ts` — legacy path delegates; dead import removed
- `frontend/src/components/workflows/ActionConfigModal.tsx` — inline body → `config.body`
- `backend/src/__tests__/unit/sendWorkflowEmail.test.ts` (new) · `emailChannel.prereqs.test.ts` (updated)

### Notes / deferred
- No schema change — reuses `MessageChannel.email` / `MessageStatus.skipped` and the `EmailTemplate`
  model from MAN-77/78.
- `send_digital_product` (digital delivery on COD) is the next issue (MAN-80); the `download_url`
  merge tag renders empty here until that action populates it.
- Real end-to-end provider send is covered by the epic-level browser e2e (needs a configured platform
  Resend key); the 7 unit tests mock the provider.
