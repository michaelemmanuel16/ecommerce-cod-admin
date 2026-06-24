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

## MAN-81 — Email unsubscribe (RFC 8058 one-click)

**Date:** 2026-06-23 · **Type:** feat · **Branch:** `feature/email-channel-epic` · **Commit:** `a13d7f2`

Marketing-class emails now ship with a real opt-out: a visible `Unsubscribe` link
plus RFC 8058 `List-Unsubscribe` headers so Gmail/Apple Mail render a native
one-click unsubscribe. Opt-out is a **POST side-effect only** — mail scanners and
link prefetchers auto-`GET` links, which would silently unsubscribe customers, so
the GET route renders a confirm page and never mutates.

### Changes
- **Backend:**
  - **`unsubscribeService.ts` (new):**
    - `buildUnsubscribeUrl(token)` → `${getBackendUrl()}/api/public/unsubscribe/:token`.
    - `applyUnsubscribe(html, token, url)` — shared helper returning `{ html, headers }`. Appends the
      footer fallback only when the rendered body doesn't already contain the link (detects off the
      hex **token**, which survives HTML-escaping, not the full URL whose slashes don't), and wires
      `List-Unsubscribe: <url>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Empty url
      (no customer) → body untouched, no headers. Reused by Phase 2 bulk so neither path re-implements it.
    - `ensureUnsubscribeToken(customer)` — returns the stored token, lazily minting + persisting a fresh
      32-byte random hex (`crypto.randomBytes(32).toString('hex')`) when absent.
    - `findCustomerByUnsubscribeToken(token)` — **unscoped** lookup (token is globally unique + random;
      public routes carry no tenant context). `optOutByUnsubscribeToken(token)` — idempotent opt-out,
      POST-only; returns false for unknown/forged tokens.
  - **`unsubscribeRoutes.ts` (new):** public router — `GET /:token` renders a confirm page (no write);
    `POST /:token` performs the opt-out. Mounted at `/api/public/unsubscribe` **before** `/api/public`
    in `server.ts` so the more specific prefix wins.
  - **`emailTemplateService.ts`:** added `unsubscribe_url` to `EMAIL_MERGE_TAGS` (now 7) and
    `appendUnsubscribeFooter(html, url)` (escapes the URL, appends an `<hr>` + muted unsubscribe `<p>`).
  - **`emailService.ts`:** `SendEmailOptions.headers?` threaded into all three providers
    (SendGrid/Resend/SMTP); `sendWorkflowEmail` mints the token **in parallel** with the tenant/config
    reads (single `Promise.all`, no added latency), injects `unsubscribe_url` into the render context,
    and runs the rendered body through `applyUnsubscribe` before send.
  - **`utils/url.ts` (new):** `getBackendUrl()` shared helper (also de-dupes the inline URL build in
    `digitalDeliveryService`).
- **Frontend:** `ActionConfigModal.tsx` — `{{unsubscribe_url}}` added to the merge-tag hint.
- **Tests:** `unsubscribe.test.ts` (new) — footer fallback append/skip detection across HTML-escaped
  bodies, header shape, empty-url no-op; `sendWorkflowEmail.test.ts` — asserts the unsubscribe footer +
  headers are applied on the workflow send path.

### Key Files
- `backend/src/services/unsubscribeService.ts` (new)
- `backend/src/routes/unsubscribeRoutes.ts` (new)
- `backend/src/utils/url.ts` (new)
- `backend/src/services/emailTemplateService.ts` · `emailService.ts` · `digitalDeliveryService.ts` (modified)
- `backend/src/server.ts` — mounts `/api/public/unsubscribe`
- `frontend/src/components/workflows/ActionConfigModal.tsx` — merge-tag hint
- `backend/src/__tests__/unit/unsubscribe.test.ts` (new) · `sendWorkflowEmail.test.ts` (updated)

### Notes / deferred
- No schema change — reuses `Customer.emailOptOut` + `unsubscribeToken` from the MAN-77 migration.
- Unscoped public lookup is safe **only** because the token is globally unique + random; do not
  tenant-scope it.
- Bulk-campaign unsubscribe (Phase 2 / MAN-83) reuses `applyUnsubscribe` + `ensureUnsubscribeToken`
  + `buildUnsubscribeUrl` — no re-implementation.

## MAN-82 — Email capture (grow the owned list)

**Date:** 2026-06-23 · **Type:** feat · **Branch:** `feature/email-channel-epic` · **Commit:** `1ef5c20`

The whole email bet (epic decision #4) depends on the funnel reliably collecting
real customer emails going forward. This issue makes `Customer.email` a first-class
captured asset across every order path — public checkout, admin manual order, and
bulk import — while keeping synthesized placeholder addresses out of the marketing
pool. Much of the backend (bulk-import `customerEmail`, the Paystack
placeholder-is-local guard) was already present from prior work; this issue adds
the two genuine gaps and locks the rest in with tests.

### Changes
- **Frontend — email as a standard default field:**
  - `components/public/CheckoutForm.tsx` — added `Email Address` (type `email`) to `DEFAULT_FIELDS`
    after `Alt Phone`, before `Region/State`. It is **not** in `DEFAULT_REQUIRED_KEYS`, so it renders
    present-but-optional on physical COD; the existing `isDigital` derivation still force-requires it
    for digital products. `DEFAULT_FIELDS` only renders when a form hasn't customized its fields, so
    existing forms are unaffected.
  - `components/forms/CheckoutFormBuilder.tsx` — mirrored `Email Address` into the builder's
    `defaultFields` seed so newly created forms start with the field present.
- **Backend — capture on repeat manual orders:**
  - `services/orderService.ts` — `createOrder`'s repeat-customer (phone-match) branch now builds a
    `Prisma.CustomerUpdateInput` that links a newly-provided `customerEmail` (when different from the
    stored one) **and** alt phone, instead of only updating alt phone. Mirrors the public checkout
    path so admin/manual orders also grow the owned list, including records first created without an
    email. The create branch already set `email: data.customerEmail || null`.
- **Already present — locked in with tests (no behavior change):**
  - Bulk import persists `customerEmail` on customer create/update (`BulkImportOrderData`).
  - The Paystack synthesized `<phone>@codadminpro.com` address is **local to the init call** and is
    never persisted onto `Customer.email` — so a fake, bouncing placeholder never becomes a campaign
    recipient (protects sender reputation, epic decision #5).

### Tests
- `__tests__/unit/orderService.test.ts` — repeat manual order with a new email updates the customer
  (`customer.update` called with `data: { email }`); unchanged email does **not** trigger an update.
- `__tests__/unit/publicOrderController.test.ts` — a blank-email Paystack checkout persists
  `Customer.email = null` yet still hands the synthesized `<phone>@codadminpro.com` to Paystack init.
- `frontend/.../CheckoutForm.test.tsx` — email field renders by default on a physical form **without**
  a required asterisk (Full Name keeps one); a digital product forces the default email field required.

### Key Files
- `frontend/src/components/public/CheckoutForm.tsx` · `components/forms/CheckoutFormBuilder.tsx` (modified)
- `backend/src/services/orderService.ts` (modified)
- `backend/src/__tests__/unit/orderService.test.ts` · `publicOrderController.test.ts` (tests)
- `frontend/src/__tests__/components/CheckoutForm.test.tsx` (tests)

### Notes / deferred
- No schema change.
- **Bulk-eligibility filter deferred to MAN-83:** excluding `email == null` / `emailOptOut == true`
  (and the `@codadminpro.com` domain) at campaign-recipient selection lands with `getRecipients` in the
  Phase 2 bulk path, where it belongs.
- The contact-update pattern now appears in three places (`orderService` create/repeat +
  `publicOrderController`); `/simplify` flagged the duplication but it was left as a follow-up — the
  dedup spans pre-existing call sites outside this issue's surgical scope.

## MAN-83 — Queued bulk email + campaign model/history

**Date:** 2026-06-23 · **Type:** feat · **Branch:** `feature/email-channel-epic` · **Commit:** `b1055a3`

Phase 2.1 of the epic: the backend for Salesgee-style bulk email. A manual
"compose → pick audience → send" enqueues one BullMQ job per recipient (volume +
provider rate limits make the existing SMS/WhatsApp sync await-loop unsafe here),
and a new `EmailCampaign` row groups the sends so a history table can show the
delivered/failed/skipped breakdown. Marketing-class, so it sends on the tenant's
**BYO** provider (decision #2) and carries the MAN-81 unsubscribe footer/headers.
The Communications Email-channel UI that drives this is the next issue (MAN-84).

### Changes
- **Schema (additive migration `20260623140000_add_email_campaign`):**
  - `EmailCampaign` model (tenant-scoped, registered in `TENANT_SCOPED_MODELS`) + `EmailCampaignStatus`
    enum (`queued`/`sending`/`completed`). Snapshots the eligibility denominators at send time
    (`audienceTotal`, `noEmailCount`, `optedOutCount`, `totalRecipients`) so the history detail can show
    audience → emailable even after the audience changes (D-CRIT).
  - `MessageLog.campaignId` (`Int?`, `@@index`, FK `onDelete: SetNull`) links each send to its campaign.
  - **Partial-unique** `message_logs_campaign_customer_key` on `(campaign_id, customer_id) WHERE campaign_id IS NOT NULL` — enforces one send row per recipient per campaign (idempotency backstop) without ever constraining workflow/transactional logs. Not expressible in the Prisma schema, so it lives in the migration only.
- **Queue — `queues/emailCampaignQueue.ts` (new):**
  - `enqueueCampaignRecipient` — deterministic `jobId` `campaign:<id>:cust:<id>` (Bull drops a duplicate enqueue — the first idempotency layer).
  - `processCampaignRecipient` — restores tenant context via `tenantStorage.run(data.tenantId)`; re-checks eligibility (logs `skipped` for `no_recipient`/`opted_out`/`placeholder_email` — the MAN-82 `@codadminpro.com` guard re-applied in the worker); idempotent (a prior `sent` log short-circuits, a `pending`/`failed` row is reused not duplicated); renders via the MAN-78 renderer with `store_name` threaded in the job data (no per-recipient tenant lookup), applies MAN-81 `applyUnsubscribe`, sends via `sendEmail({ as: 'tenant' })`, writes `pending` → `sent`/`failed`, never rethrows. `maybeCompleteCampaign` flips the campaign to `completed` once no recipient is pending. Worker registered only when `NODE_ENV !== 'test'`.
- **Service — `communicationService.ts`:**
  - `bulkSendEmail` — resolves/sanitizes content from an `EmailTemplate` (`templateId`) or inline subject/body; computes the three denominators (`Promise.all` of three counts); creates the campaign (`queued`); **cursor-paginates** the eligible audience (`PAGE=500`) and batch-enqueues (`Promise.all`) — replacing the old hard `take:1000` so 1k–5k sends aren't silently dropped (H4); updates `totalRecipients` + flips to `sending` (or `completed` if zero eligible). Manual send only.
  - `getCampaigns` / `getCampaign(id)` — `groupBy` `MessageLog.status` → `campaignStats` breakdown (audience → no-email → opted-out → emailable → waiting/sent/delivered/failed/skipped). `getCampaign` returns `null` for an unknown id (→ 404).
  - `getRecipients` — `email` added to the channel union; shared `EMAIL_ELIGIBLE` fragment (`email != null`, `emailOptOut == false`, `NOT endsWith @codadminpro.com`).
- **Controller / routes:** `bulkSendEmailSchema` (zod — `templateId` **or** `subject`+`htmlBody`, `customerIds` **or** `filter`); `POST /communications/bulk-email` (201, `requireRole` super_admin/admin), `GET /communications/campaigns` + `GET /communications/campaigns/:id` (super_admin/admin/manager). Worker booted via `import './queues/emailCampaignQueue'` in `server.ts`.

### Tests
- `__tests__/unit/emailCampaignQueue.test.ts` (new, 4) — eligible send via the tenant provider + `sent` MessageLog; opt-out skip; `@codadminpro.com` placeholder skip; idempotent `already_sent`.
- `__tests__/unit/communicationServiceEmail.test.ts` (new, 6) — denominators + one enqueue per recipient carrying `{campaignId,customerId,tenantId,storeName}`; zero-eligible completes immediately; inline-no-subject rejects; `getRecipients` email filter shape; `getCampaign` breakdown; `getCampaign` null.
- `__tests__/unit/communicationController.test.ts` — 2 stale assertions updated now that `email` is a valid channel (missing-channel error string; invalid-channel example → `telegram`).

### Key Files
- `backend/prisma/schema.prisma` · `migrations/20260623140000_add_email_campaign/migration.sql`
- `backend/src/queues/emailCampaignQueue.ts` (new)
- `backend/src/services/communicationService.ts` · `controllers/communicationController.ts` · `routes/communicationRoutes.ts` · `server.ts` · `utils/prismaExtensions.ts`
- `backend/src/__tests__/unit/emailCampaignQueue.test.ts` · `communicationServiceEmail.test.ts` (new) · `communicationController.test.ts` (updated)

### Verification (GATE 4 — API + queue)
Ran the live endpoints against the dev DB (backend from source on :3001; the docker image is stale).
`POST /bulk-email` for the whole tenant created a campaign with `audienceTotal 52 / noEmail 17 / totalRecipients 35`; the queue drained 35/35 → 35 `MessageLog` rows / 35 distinct customers / 0 duplicate pairs / partial-unique present; campaign auto-flipped to `completed`; `GET /campaigns/:id` returned the exact breakdown, tenant-scoped. Communications page loaded clean (Email bar = 35, no console errors). Verification rows cleaned up afterward; the migration stays applied.

### Notes / deferred
- **UI is MAN-84** — eligibility-transparency banner, `EmailComposer`/`CampaignHistoryTab`/`MergeTagToolbar`, async/queued UX, provider-not-configured guard.
- `totalRecipients` is stored (not derived) deliberately — it's the snapshot of what was actually enqueued, more accurate than re-counting a moving audience.
- `maybeCompleteCampaign` runs a `COUNT(pending)` per job; fine for background MVP scale, revisit only if campaign volume makes it hot.

---

## MAN-84 — Communications Email channel UI (Phase 2.3)

- **Date:** 2026-06-24
- **Type:** feat (frontend)
- **Branch:** `feature/email-channel-epic`
- **Commit:** `037b43e`

Surfaces the MAN-83 backend as the Salesgee-style compose → pick audience → send → history flow,
extending `Communications.tsx` rather than adding a page. Implements the Design-phase requirements
(D-CRIT eligibility transparency, D-H1 async UX, D-H2 provider guard, D-H3 editor, D-M1 structure).

### Frontend
- **`components/communications/EmailComposer.tsx` (new)** — campaign-name + Subject + HTML body
  textarea; three prebuilt templates (announcement / promo / re-engage); cursor-aware merge-tag
  insert into the last-focused field (Subject **or** Body); audience filters (state / product /
  has-ordered) → `Check Eligibility`; **eligibility banner** "X of Y can be emailed (Z no address,
  W opted out)" (D-CRIT); **Preview** renders subject+body with sample merge values inside a
  `sandbox=""` `<iframe srcDoc>` (no `allow-scripts` → the merchant's own draft HTML renders, no
  script ever executes); `handleSend` validates + `window.confirm` → `bulkSendEmail` → toast
  "Campaign queued — track it in Campaigns" → `setSearchParams({ tab: 'campaigns' })` (D-H1).
  Provider-not-configured → `EmptyState` linking to `/settings?tab=integrations` (D-H2).
- **`components/communications/CampaignHistoryTab.tsx` (new)** — own top-level Campaigns tab; polls
  `getCampaigns()` every 4s while any campaign is `queued`/`sending`, timer cleared on unmount (D-H1);
  `STATUS_VARIANT` badge map; `overflow-x-auto` table; **no-address + opted-out + skipped rendered as
  one neutral gray "Skipped" column, Failed red only when `failed > 0`** (D-CRIT); Megaphone
  `EmptyState` when no campaigns.
- **`components/communications/MergeTagToolbar.tsx` + `mergeTags.ts` (new)** — `BULK_MERGE_TAGS`
  (the 4 tags that resolve for a bulk blast — order-scoped tags deliberately omitted) +
  `SAMPLE_MERGE_VALUES`; constants split into their own module to satisfy the react-refresh lint rule.
- **`pages/Communications.tsx`** — Email channel button (indigo, `aria-pressed`, Check icon when
  selected → **non-color selected state**, D-M1/a11y); `channelType` union extended with `'email'`;
  `BulkSendTab` renders `<EmailComposer />` for email; new top-level `campaigns` tab →
  `<CampaignHistoryTab />`; subtitle updated to mention email.
- **`services/communication.service.ts`** — `getEmailAudience`, `bulkSendEmail`, `getCampaigns`,
  `getCampaign` + `EmailAudience` / `CampaignStats` / `EmailCampaign` / `AudienceFilter` interfaces.

### Backend (thin)
- **`GET /api/communications/email-audience`** — `getEmailAudience` controller →
  `communicationService.getEmailAudience(filter)`, backed by a new `audienceDenominators(base)` helper
  (audience / no-email / opted-out / emailable) that `bulkSendEmail` is refactored to reuse.
- **Test:** `__tests__/unit/communicationServiceEmail.test.ts` — `getEmailAudience` returns
  `{audienceTotal:20, noEmail:12, optedOut:3, emailable:5}` from mocked counts.

### Verification (GATE 4)
Backend + frontend build / lint / test green; `validate-workflows.sh` pass. Browser (Chrome,
`admin@codadmin.com`): Communications → Email shows the composer once a dev provider is configured,
eligibility banner reads from the live endpoint, queued send toasts and switches to Campaigns, the
history table renders the breakdown with no-address as a neutral skip; provider-unset shows the
EmptyState; console clean. Screenshots captured for the Phase 5 review.

### Notes
- Merge-tag preview uses client-side `SAMPLE_MERGE_VALUES` (no backend round-trip); the real
  per-recipient render still happens in the MAN-78 backend renderer at send time.
- This is the final issue of the Email Channel epic (MAN-76); the consolidated PR follows.
