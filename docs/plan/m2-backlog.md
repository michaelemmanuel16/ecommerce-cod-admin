# M2 follow-up backlog

Found in the M2 (COD-21) QA and review on 2026-10-21. These items wait here because Linear hit its free issue limit. Make each one a Linear ticket later.

## Already in Linear

- COD-133: Audit log: the resource filter is ignored
- COD-134: Audit log: from after to returns empty, bad date error unclear
- COD-135: Role Permissions screen does not show the M2 roles, tools or Audit
- COD-136: GET /api/users/:id returns the system user and AI agent users
- COD-137: Revoking an MCP key leaves its AI agent user active

## Not yet in Linear

### 1. Order history shows 'integration' with no user for MCP status changes

**What happens:** An MCP-driven status change writes OrderHistory with actorKind "integration" and changedBy null. The audit log correctly records ai_agent (user 60). The agent user is not linked in order history.

**Repro:** MCP orders_update_status on an order, then read orderHistory in GET /api/orders/:id.

**File:line:** not given in the report (orders_update_status tool / order service history write).

**Suggested fix:** Pass the actor (kind ai_agent, user id) through the registry context into the history write.

QA ref: F11 (Low).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 2. MCP orders_search accepts unknown fields and wrong total

**What happens:** orders_search silently accepts unknown fields and a bad page ("x") because the input schema is not strict. Its `total` equals the returned count (1 with limit 1) while nextCursor is present, so total is not the full count.

**Repro:** tools/call orders_search {"page":"x","limit":1}

**File:line:** not given in the report (orders_search in backend/src/tools).

**Suggested fix:** Make the schema strict. Return the real total or rename the field. Check the other 13 tools for the same non-strict schema.

QA ref: F12 (Low).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 3. Generate Key remote config URL does not work in local dev

**What happens:** The config URL uses FRONTEND_URL (http://localhost:5173/mcp). Vite returns 404 for /mcp, so the copied remote config fails in dev. The backend /mcp on :3001 works.

**Repro:** POST http://localhost:5173/mcp

**File:line:** not given in the report (key dialog config builder).

**Suggested fix:** Build the config URL from an API/MCP base URL setting, or add a Vite proxy for /mcp in dev. Production is probably fine; confirm with the owner.

QA ref: F13 (Low, dev config).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: no. Touches production DB: no.

### 4. AI Assistant key list: revoke buttons unlabelled, no expiry shown

**What happens:** All Revoke buttons share the accessible name "Revoke key" with no key name. The list shows no expiry (default is 90 days). The role label "Legacy MCP (14 tools)" repeats "14 tools".

**Repro:** read_page on Settings > AI Assistant.

**File:line:** not given in the report (AI Assistant keys card).

**Suggested fix:** Add aria-label "Revoke key <name>". Show the expiry date. Drop the duplicated tool count from the legacy role name or the badge.

QA ref: F14 (Low).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 5. Malformed JSON body returns 500 instead of 400

**What happens:** Any JSON route, including /mcp and /api/auth/login, returns 500 "Internal server error" for a malformed JSON body. Pre-existing, not from M2.

**Repro:** curl -X POST -H 'Content-Type: application/json' -d '{bad' <backend>/api/auth/login

**File:line:** not given (global error handler / body parser).

**Suggested fix:** Handle the body-parser SyntaxError in the error middleware and return 400 with a plain message. Keep JSON-RPC shape for /mcp.

QA ref: F15 (Info, pre-existing).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 6. Orders UI: status menu lists every status, order page lacks history and assign

**What happens:** The Orders list status select offers all statuses (no allowed-move filter, no payment_pending/payment_failed). The order detail page shows no order history and no assign controls. The browser session logged out once between visits (cause not isolated). Pre-existing or unclear.

**Repro:** Open /orders and /orders/16002.

**File:line:** not given in the report (OrdersList, order detail page).

**Suggested fix:** Filter the status menu by the state machine's allowed moves. Add history and assign to order detail. Try to reproduce the logout separately.

QA ref: F16 (Info).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 7. System user guards: refuse forgot-password, reset-password and delete-user

**What happens:** The workflow system user (email pattern system+<tenantId>@system.codadmin.internal, admin role) is not checked by the forgot-password, reset-password and delete-user paths. These paths do not check the user kind, so the system user could be reset or deleted.

**Repro:** Call each of the three paths with the system user's email/id in a test tenant.

**File:line:** auth controller/service (forgot, reset) and users service (delete). Exact lines to be found when built.

**Suggested fix:** Refuse these three actions for the system user (match the reserved email pattern or the user kind). Return a clear 400/403. Add tests for each path. POST /api/users already rejects the reserved email with RESERVED_EMAIL.

Raised in the GATE 6 review (System user row).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 8. Before v2 launch: read-only production checks (owner runs)

**What:** Before the v2 launch, the owner runs a read-only check on the production DB. Nobody else touches production.

**Checks (SELECT only):**
- Count of system users per tenant (email like 'system+%@system.codadmin.internal'). Expect one per tenant that has run a workflow, and confirm no real user has that reserved email.
- Shape of the stored role permissions (does the matrix lack audit, orders:update_status etc.).
- Count of MCP keys: total, active, revoked, and how many have no role (legacy keys).

**Also note:** The old-MCP-key backfill script runs on production only at v2 launch. The owner runs it himself, with a dry run first. The NOT NULL rule on the key role comes in a later step, after the backfill.

**Suggested fix:** Write the three SELECT statements into the ticket comment or a runbook. No code change.

Raised in the GATE 6 review (Legacy MCP keys, System user rows).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: no. Touches production DB: yes (read-only SELECTs, run by the owner; the backfill script writes and is run by the owner at v2 launch only).

### 9. Optional lower base role for AI (MCP) keys

**What happens:** An AI agent user created for a key gets the super_admin base permission role. What the key can do is limited only by the tool list of its key role (backend/src/tools/registry.ts ~112-114).

**Idea:** Let a key use a lower base role, so the base permission check also narrows access (defence in depth).

**Suggested fix:** Add an optional base role on key create (default stays as today). Registry checks both the tool list and the base role's permissions. Decide the default for existing keys with the owner. Needs a design decision before building.

Raised in the GATE 6 review (AI agent users row).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 10. Decide: should POST /api/orders/bulk default to running no workflows?

**Context:** The CSV upload now has a runWorkflows switch that defaults to off. POST /api/orders/bulk (JSON import from code) has no such switch and still runs workflows.

**Decision needed:** Should bulk also default to no workflows, with runWorkflows to turn them on? Consider the QA finding F1, where a status change sent a real WhatsApp message. Check the callers of /bulk first.

**If yes:** add the runWorkflows field (default false), pass it to the service, and add tests. This changes behaviour for existing callers.

Raised in the GATE 6 review (Workflow behaviour row).

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 11. Workflow editor: update_order action only offers New Order Status

**What happens:** The update_order action modal (frontend ActionConfigModal.tsx ~line 228) only has "New Order Status". The backend has supported priority and notes since commit 940efa4: priority is an int or low/normal/medium/high/urgent, notes are appended, max 1000 characters.

**Repro:** Workflows > edit a workflow > add action Update order.

**Suggested fix:** Add a priority select and a notes textarea (max 1000) to the modal. Save them in the action config as the backend expects. Add a frontend test.

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 12. Order priority display mismatch (Int in DB, strings in Badge)

**What happens:** Order.priority is an Int in the DB, but the frontend Badge (variant="priority", used in frontend/src/pages/OrdersList.tsx ~43) expects the strings low/medium/high/urgent. Nothing converts, so the badge shows wrong or no label. Pre-existing, not from M2.

**Repro:** Open /orders for orders with a priority value.

**Suggested fix:** Add one mapping (int to label and label to int) shared by the Badge and the workflow editor. Check what the API returns first and decide whether the backend should return the label.

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: no.

### 13. M2 skipped clean-ups from the whole-M2 /simplify (grouped checklist)

These were found in the T19 whole-M2 review and skipped because each one changes behaviour or reaches outside M2. They are small and independent, so I kept them as one grouped ticket. Split a line into its own ticket when someone picks it up.

- [ ] Do the channel check in one place. Would change some audit statuses from "denied" to "invalid".
- [ ] Use one workflow policy field instead of three flags (imported, runWorkflows, depth).
- [ ] Use one executor for workflow actions (code is still in two places).
- [ ] Split the tool query service into the domain services.
- [ ] Use database constraints for the reserved system email instead of the Prisma extension.
- [ ] Make user queries return only people by default.
- [ ] Do not wait for audit writes on read-only tools.
- [ ] Assign by role in bulk.
- [ ] Add an index for the workflow loop guard. Needs a migration.
- [ ] Remove the audit tool field, because it repeats the resource id.
- [ ] Share one helper for the role tool list and count.
- [ ] Rate-limit bad keys before validation.
- [ ] Cache the access checks on chat.

Two items touch the DB schema (index, constraints): those need a migration and the owner runs it on production at release.

Found in: M2 (COD-21) QA / review, 2026-10-21
Touches production deploy: yes (only via normal release). Touches production DB: yes for the index and constraint items (migrations, only via normal release); no for the rest.
