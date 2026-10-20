# CodAdmin audit: current state of `ecommerce-cod-admin`

I audited the checked-out working tree on `fix/checkout-field-mapping-and-archived-customers` and changed nothing. I had no shell, so I could not run `git status`, tests or builds. Everything below comes from reading files, and anything I inferred is marked GUESS. Test counts come from grep, not from a test run.

## 0. Read this first: the working tree is behind the docs

- The checked-out code has no `statusVersion` and no multi-store model. `docs/features/paystack-checkout.md` lists "MAN-56 order state machine + statusVersion" as done.
- `.git/refs/heads` has `feature/man-56-order-state-machine` (local only) and `feature/multi-store-owner-plumbing`, `feature/multi-store-billing` and `feature/multi-store-per-login` (local and origin). There is also a `refs/stash`.
- GUESS: that work was never merged into this branch, or lives only on `develop`/other branches. Confirm with `git log --all` before using this audit as the baseline for the redesign.
- `.claude/plans/roadmap.md` is dated 2026-03-15 and is stale. Its "AI Operations Assistant" and "AI Admin Copilot" items (MAN-33/34) are listed as future backlog.
- Treat `CLAUDE.md` with care. It names Shadcn as the UI library, but `frontend/src/components/ui/*` are hand-written (`Button.tsx`, `Modal.tsx`, `Table.tsx`; GUESS: not Shadcn). It also names `WorkflowEditor.tsx` as the workflow builder, but the router uses `WorkflowWizard`.

### The three untracked migrations
- `backend/prisma/migrations/20260218174636_decimal_migration/migration.sql`
- `.../20260218181000_add_manual_expense_gl_accounts/migration.sql`
- `.../20260218193000_add_accounting_period_and_retained_earnings/migration.sql`

Each file contains one line: `-- Migration applied directly to DB, SQL not available`. They are empty placeholders, not real migrations.

- **Applied to prod?** GUESS: yes, by hand. Evidence: `20260329000000_add_digital_products/migration.sql` says "includes period_close from DB", and the `period_close` enum value exists in the DB but was never added by any tracked migration.
- **Referenced anywhere?** No. There is no `AccountingPeriod` model in `schema.prisma`. Nothing uses `period_close` except the enum value and one test comment. `getBalanceSheet` computes retained earnings on the fly (`financialService.ts:1749`) as all-time revenue minus expenses, with no period close.
- **Decimal migration:** the schema still uses `Float` for orders, products, expenses, customers and payouts, and `Decimal(19,4)` only for GL, agent balances and collections. The decimal migration did not convert the money columns the schema defines.
- **Consequence:** a fresh DB built by `prisma migrate deploy` (CI does this) runs these as no-ops. Any manual `AccountingPeriod` or manual-expense account objects in prod are invisible to Prisma and drift from the repo. Either delete the three folders or backfill real SQL by diffing against a prod `pg_dump`. Doing that diff is a redesign prerequisite.
- **Other drift:** `20260313_add_password_reset_fields` has a non-timestamp-padded folder name. Memory notes also record 11 pending additive migrations on prod (`reference_codadmin_prod_migration_drift.md`).

## 1. Stack and architecture

| Layer | What it is |
|---|---|
| Frontend | React 18, Vite 7, TypeScript, React Router v6, Zustand 5 stores, Axios (`services/api.ts` with refresh and session-expired dedupe), Tailwind, Recharts, `@dnd-kit` (Kanban), React Flow (workflows), socket.io-client, react-hook-form with zod 3, react-joyride (onboarding), vite-plugin-pwa. |
| Duplicate libs | Both `reactflow` and `@xyflow/react` are installed. Frontend uses zod 3 and backend zod 4. |
| Backend | Node 20, Express 4, TypeScript, `express-async-errors`, Zod and express-validator, Winston, Sentry, Helmet, `compression`. Layering is routes, controllers, services. `bull` plus `ioredis` for queues, `node-cron` for schedules. |
| DB | PostgreSQL via Prisma 5 (`backend/prisma/schema.prisma`, 58 models and enums). |
| Real-time | socket.io (`sockets/index.ts`, `utils/socketInstance.ts`). Events include `order:created`, `order:updated`, `order:status_changed` and `delivery:updated`. |
| Auth | JWT access token plus refresh token carrying a `tenantId` claim (`utils/jwt.ts`, `middleware/auth.ts`). Password reset by email. Roles: `super_admin`, `admin`, `manager`, `sales_rep`, `inventory_manager`, `delivery_agent`, `accountant`. `User.isPlatformAdmin` is a separate flag with `tenantId = null`. |
| RBAC | `requireResourcePermission(resource, action)` reads `SystemConfig.rolePermissions`, merged with defaults, cached 60s per tenant (`auth.ts:58`). Resources: users, orders, customers, products, financial, analytics, workflows, settings, calls, gl. `super_admin` bypasses the check. Frontend gates with `hooks/usePermissions.ts` and `RoleGuard` in `App.tsx`. |
| Multi-tenancy | Shared DB with a `tenant_id` column. A Prisma extension (`utils/prismaExtensions.ts`) injects `tenantId` from AsyncLocalStorage (`utils/tenantContext.ts`) into 24 listed models. It also applies soft-delete (`isActive` for User, Customer, Product, CheckoutForm; `deletedAt` for Order). Cache keys and the permissions cache are per tenant. |
| Storage | Cloudflare R2 (`config/r2.ts`, `@aws-sdk/client-s3`), with multer and a local `/uploads` fallback. A nightly cron deletes local files older than 60 days. |
| Email | SendGrid, Resend or SMTP per tenant (`emailService.ts:245`). A platform transactional sender uses `PLATFORM_EMAIL_*` env. |
| SMS | Arkesel only (`smsService.ts:9`). |
| WhatsApp | Meta Cloud API with OAuth, token refresh cron and webhook (`whatsappService.ts`, `whatsappOAuthController.ts`, `metaOAuthService.ts`). |
| Deploy | Docker Compose (dev/staging/prod/budget). Host nginx in front. GitHub Actions run CI and SSH deploy scripts (`scripts/deploy-staging.sh`, `scripts/deploy-github-actions.sh`). `develop` deploys to staging, `main` to prod. Run `prisma migrate deploy` at deploy time. |
| Domains | Prod app is `app.codadminpro.com` (SPA and API same-origin). The apex `codadminpro.com` is the landing page and proxies `/api`, `/form` and `/mcp`. `platform.codadminpro.com` is the platform admin SPA, switched by `isPlatformDomain()` in `App.tsx:155`. |

Server startup (`server.ts`) does the following:
- It validates env and GL account codes, then mounts about 25 route groups.
- It starts queues and crons: aging, financial reconciliation, message cleanup, pending-checkout cleanup, GL balance verification at 02:00, upload cleanup at 03:00 and WhatsApp token refresh at 01:00.
- It refuses to start if the GL accounts cannot be seeded.

## 2. Feature inventory

Status key: C = complete, P = partial, S = stub, M = missing.

| Module | Status | Key files | Works | Broken or half-done |
|---|---|---|---|---|
| **Orders** | C | `orderService.ts` (create `:212`, status `:965`, delete `:1371`, kanban `:1775`), `orderController.ts`, `bulkOrderController.ts`, `OrderDetails.tsx`, `Orders.tsx` | CRUD, statuses, soft delete, Kanban, CSV/Excel bulk import and export, assign rep/agent, history, tags, source tracking, GL and inventory side effects | `payment_pending`, `payment_failed` and `digital_delivered` exist in the enum but the dashboard whitelist excludes them. Bulk docs are in `docs/features/bulk-orders.md` (marked "Planning" though code exists). No state machine in this tree (see section 0). |
| **Customers** | C | `customerService.ts`, `customerController.ts`, `Customers.tsx`, `CustomerDetails.tsx` | CRUD, tags, per-customer analytics, phone unique per tenant, opt-outs | Latest branch is fixing archived customers. `totalOrders` and `totalSpent` are denormalised Float counters (GUESS: drift risk). |
| **Products and inventory** | P | `productController.ts`, `shipmentController.ts`, `Products.tsx`, `ProductForm.tsx`, `product_cost_entries` | Catalog, COGS, low stock, digital products, inbound shipments (`InventoryShipment`, arrival posts GL inventory purchase) | `PATCH /products/:id/stock` is a raw overwrite (`productController.ts:186`) with no movement ledger and no audit. `Product.sku` is globally unique, not per tenant. Warehouse stock has no movement table. `product_cost_entries` is untenanted. |
| **Agent inventory** | C (docs say so) | `agentInventoryService.ts` (allocate, transfer, return, fulfilment, adjust), `AgentInventoryManagement.tsx`, `AgentMyInventory.tsx` | `AgentStock` and `InventoryTransfer` ledger with types allocation, fulfilment, transfer, return and adjustment | Roadmap still lists phases 3 and 4 as future. |
| **Customer reps (call center)** | P | `callService.ts`, `repPerformanceService.ts`, `assignmentService.ts`, `payoutService.ts`, `CustomerReps.tsx`, `EarningsHistory.tsx`, `components/calls/*` | Call logging (outcome, duration), round-robin and weighted assignment, commission per delivered order, payouts with GL entry, earnings page | `CallsDashboard.tsx` is not routed. No call recording or telephony integration. `Call` and `Payout` have no `tenantId`. |
| **Delivery agents and logistics** | C for in-house agents, M for 3PL | `deliveryService.ts`, `deliveryController.ts`, `DeliveryAgents.tsx`, mobile pages | Assignment, proof (photo/signature/OTP), complete or fail, routes, agent balances, aging, blocking, deposits | There is no 3PL or courier model. 3PL reconciliation goes through MCP `orders_update_status` with `deliveryDate` (external sync). The mobile app is opt-in only. `MobilePlaceholder.tsx` is unused, and a stale App.tsx comment claims Deliveries is a stub, but `MobileDeliveries.tsx` is implemented. |
| **Checkout forms and embed** | C | `checkoutFormService.ts`, `checkoutFormController.ts`, `publicOrderService.ts`, `PublicCheckout.tsx`, `CheckoutFormEditor.tsx`, `lib/embedSnippet.ts`, `vite.embed.config.ts`, `docs/embed.md` | Form builder (fields, design, packages, upsells, regions, pixel, CAPI, redirect URL, allowed origins), iframe embed with postMessage resize, preview, order tracking | "Duplicate form" is a TODO (`CheckoutForms.tsx:55`). Skins were cancelled (single template). |
| **Payments (Paystack)** | C | `paystackService.ts`, `paystackSettlementService.ts`, `paystackController.ts`, `PaymentCallback.tsx`, `PendingCheckout` model | Per-tenant keys, COD, deposit and full-pay buttons, webhook with idempotency (`WebhookEvent`), orders created on settlement, abandoned-checkout sweep | A legacy handler is slated for removal (`paystackController.ts:118`, "sunset 2026-09-01", now past). Tenant payouts (MAN-60) were cancelled. |
| **Finance, expenses, GL** | P | `financialService.ts`, `glService.ts`, `glAutomationService.ts`, `glAccountService.ts`, `financialSyncService.ts`, `Financial.tsx`, `components/financial/*` | Chart of accounts, journal entries (void and reverse), auto-posting for delivery, failed delivery, return, expense, deposit, inventory purchase and payout, P&L, balance sheet, expense CRUD, profitability, cash flow with 30-day forecast, nightly balance check | No period close or accounting period (section 0). Expense receipt upload is a TODO (`AddExpenseModal.tsx:162`). Expenses are stored as Float but posted as Decimal. Chart-of-accounts and tenancy problems are in section 8. |
| **Remittance and COD cash** | C | `agentReconciliationService.ts`, `agingService.ts`, `AgentCollections.tsx`, `AgentReconciliationTab.tsx` | Collection chain draft, verified, approved, deposited, reconciled. FIFO deposit matching, receipts, bulk verify, aging buckets, manual and auto blocking | `AgentCollection`, `AgentDeposit` and `AgentAgingBucket` have no `tenantId` (section 8). |
| **Analytics and dashboard** | C | `analyticsService.ts`, `analyticsController.ts`, `Analytics.tsx` (4 tabs), `DynamicDashboard.tsx`, `config/dashboards/*` | Role-specific config-driven dashboards, 11 analytics endpoints | Several metric inconsistencies (section 4). `getTimeSeriesData` and `getRealTimeStats` are not inspected. |
| **Users, roles, permissions** | C | `userController.ts`, `adminController.ts`, `adminService.ts`, `RolePermissionsMatrix.tsx` | CRUD, reactivation, availability toggle, per-tenant permission matrix, reset password | Role set is fixed to 7 roles. Admin `permanent` delete route exists. |
| **Multi-store** | M in this tree | none | n/a | Exists only on `feature/multi-store-*` branches (section 0). |
| **Notifications, WhatsApp, SMS, email** | C | `notificationService.ts`, `whatsappService.ts`, `smsService.ts`, `emailService.ts`, `communicationService.ts`, `emailCampaignQueue.ts`, `Communications.tsx` | In-app and socket notifications, templates, bulk SMS, WhatsApp and email, campaigns, opt-out, unsubscribe page, `MessageLog` | Docs mark email "In Progress". |
| **Webhooks and integrations** | C | `webhookService.ts`, `webhookController.ts`, `Webhooks.tsx` | Inbound order import by unique URL with field mapping, HMAC option, fingerprint dedupe, logs and stats, test | Legacy `POST /import` exists next to `/import/:uniqueUrl`. `WebhookLog` has no tenant column. |
| **Workflows** | P | `workflowService.ts`, `workflowQueue.ts`, `WorkflowWizard.tsx`, `WorkflowTemplateGallery.tsx` | Triggers (order created, status change, time-based, manual, webhook) and actions (SMS, email, WhatsApp, update order, assign agent, add tag, wait, assign user) | `http_request` is a mock that only logs (`workflowService.ts:489`). `update_order` and `assign_agent` write via raw `prisma.order.update`, bypassing `orderService` and its GL and inventory side effects. Template "use" is a TODO (`Workflows.tsx:124`). `WorkflowEditor.tsx` and `components/workflow/*` are unrouted. |
| **MCP server** | P | `backend/src/mcp/*` | 13 tools (section 6) | 1 write tool. |
| **Billing and SaaS plans** | P | `billingController.ts`, `platformBillingService.ts`, `platformPaystackService.ts`, `config/billing.ts`, `Billing.tsx`, `Pricing.tsx`, `PlatformBilling.tsx` | Plans table, Paystack subscription start, verify and cancel, webhook, platform MRR, grant-free, suspend and reactivate | No enforcement (section 8). Plan limits `maxOrders` and `maxUsers` are only displayed. |
| **Platform admin** | C | `platformService.ts`, `platformController.ts`, `Platform*.tsx` | Tenant CRUD, suspend, announcements, metrics, billing events, health | Platform admin lives in the same codebase and app. |
| **Settings** | C | `Settings.tsx` | Tabs: Profile, Security, My Notifications, User Management, Business, Checkout Forms, Integrations, Role Permissions, Billing | n/a |
| **Onboarding** | C | `onboardingController.ts`, `Onboarding.tsx`, `components/onboarding/*` | Tenant setup wizard, sales rep tour | New tenants get no GL chart seeded (section 8). |

## 3. Frontend pages and routes (`frontend/src/App.tsx`)

### Public (tenant domain)
- `/form/:slug`: public hosted checkout (`PublicCheckout`); also the iframe embed target.
- `/pricing`: public pricing page.
- `/checkout/payment/callback`: Paystack return handler.
- `/login`, `/register`, `/forgot-password`, `/reset-password`: auth pages.
- `/platform/login`: platform admin login on the main domain (dev use).

### Protected, no layout
- `/onboarding`: tenant setup wizard.
- `/checkout-forms/:id/preview`: bare preview shell for the editor iframe.

### Desktop (`Layout` with sidebar)
- `/`: role-specific dashboard (`DynamicDashboard`); platform admins redirect to `/platform`.
- `/orders`: list and Kanban views, filters, bulk import and export.
- `/orders/:id`: order detail, history, calls, delivery.
- `/products`: catalog and shipments.
- `/products/new`, `/products/:id/edit`: product form.
- `/customers`: customer list.
- `/customers/:id`: customer detail and analytics.
- `/delivery-agents`: agent management.
- `/customer-reps`: rep management and payouts.
- `/financial`: three tabs, Overview, Agent Collections, Accounting & Analysis (GL, statements, profitability, expenses).
- `/analytics`: four tabs, Overview, Sales & Revenue, Delivery & Operations, Team Performance. Limited to super_admin, admin, manager and accountant.
- `/workflows`: workflow list.
- `/workflows/new`, `/workflows/:id`: wizard.
- `/communications`: messages, templates, campaigns. Limited to super_admin, admin and manager.
- `/settings`: tabs listed in section 2.
- `/settings/billing`: plan and billing.
- `/settings/billing/callback`: subscription return handler.
- `/checkout-forms`: form list.
- `/checkout-forms/new`, `/checkout-forms/:id/edit`: editor.
- `/webhooks`: inbound webhooks. Limited to super_admin and admin.
- `/agent-inventory`: management view, or "my inventory" for a delivery agent.
- `/earnings-history`: sales rep only.
- `/platform`, `/platform/tenants`, `/platform/tenants/:id`, `/platform/announcements`, `/platform/billing`: platform-admin pages (`PlatformGuard`).

### Mobile (`/m`, delivery_agent only)
- `/m` (dashboard), `/m/deliveries`, `/m/deliveries/:id`, `/m/deliveries/order/:orderId`, `/m/inventory`, `/m/collections`.
- `/m/settings` reuses the desktop `Settings` (TODO at `App.tsx:258`).
- `MobileRedirect` only auto-redirects when the user opted in.

### Platform subdomain
- `/login`, `/`, `/tenants`, `/tenants/:id`, `/announcements`, `/billing`.

### Dead or unrouted files (no importer found)
- `pages/Dashboard.tsx`, `pages/OrdersList.tsx`, `pages/OrdersKanban.tsx`, `pages/CallsDashboard.tsx`, `pages/WorkflowEditor.tsx`, `pages/mobile/MobilePlaceholder.tsx`, `examples/WorkflowBuilderDemo.tsx`.
- GUESS: `components/workflow/*` is dead too, since only `WorkflowEditor` and the demo reference `WorkflowBuilder`.
- `components/kanban/KanbanBoard.tsx` is live through `Orders.tsx`.

## 4. KPIs and metrics

### Dashboard: `services/analyticsService.ts:54` `getDashboardMetrics`
Default range is month-to-date. Sales reps and delivery agents are scoped to their own orders.
- **`totalOrders`:** count of orders with `createdAt` in range and `deletedAt` null.
- **`todayOrders`:** same count, but for today only.
- **`pendingOrders`:** all-time count with status `pending_confirmation`.
- **`deliveredOrders`:** count with status `delivered` and `deliveryDate` in range.
- **`totalRevenue`, `todayRevenue`:** sum of (credit − debit) on GL account 4010 for non-voided entries by `entryDate`, so revenue is gross and GL-based.
- **`activeAgents`:** active, available delivery agents.
- **`avgDeliveryTime` (hours):** mean of (`actualDeliveryTime` − `scheduledTime`) over the last 100 deliveries from the last 7 days. This measures lateness against schedule, not dispatch to delivery.
- **`deliveryRate`:** `deliveredOrders / totalOrders × 100`. The numerator is cohorted by `deliveryDate` and the denominator by `createdAt`, so the cohorts are mismatched.

### Analytics endpoints (`analyticsService.ts`)
- **`getSalesTrends:252`:** per day or month, `orders` count, `revenue` = sum of `order.totalAmount` for all statuses (cancelled included), `delivered` count, `conversionRate` = delivered / orders. This disagrees with the GL-based dashboard revenue.
- **`getConversionFunnel:332`:** count grouped by status.
- **`getRepPerformance:369`:**
  - `totalAssigned`; `completed` = delivered.
  - `successRate` = completed / total.
  - `revenue` = sum of `totalAmount` over delivered.
  - `pending` is all-time non-terminal.
  - `unpaidDelivered*` uses `commissionPaid = false`.
  - `avgResponseTime` = mean(`updatedAt` − `createdAt`) in minutes. This is unreliable, because any edit moves `updatedAt`.
- **`getAgentPerformance:499`:**
  - `successRate` = delivered / total.
  - `failed` = cancelled, returned or failed_delivery.
  - `active` = ready_for_pickup or out_for_delivery.
  - `onTimeRate` = deliveries with actual ≤ scheduled, divided by all deliveries. Unfinished deliveries and unscheduled ones are in the denominator, and the rate is not date-filtered.
- **`getCustomerInsights:574`:** `activeCustomers` runs the identical query to `totalCustomers`, which is a bug. Top 10 by `totalSpent`, customers by area, and AOV = average `totalAmount` of delivered orders, all-time.
- **`getProductPerformance:642`:** units = sum of quantity, revenue = sum of `totalPrice`, order count. All order statuses are included.
- **`getAreaDistribution:702`:** order count and sum of `totalAmount` by `deliveryArea`, top 20.
- Also present, not inspected: `getTimeSeriesData:736`, `getRealTimeStats:791`, `getPendingOrders:835`, `getRecentActivity:885`, `getOrderStatusDistribution:927`.
- **Frontend:** trend deltas are computed client-side in `utils/dashboard/trendCalculator.ts`, and widgets are wired through `config/dashboards/*.ts`, `hooks/useDashboardData.ts` and `utils/dashboard/dataResolver.ts`.

### Finance: `services/financialService.ts`
- **`getFinancialSummary:130`:**
  - `totalRevenue` = GL account 4010 only.
  - `totalExpenses` = GL accounts 5010, 5020, 5030, 5040, 5050 and 5100.
  - `profit` = revenue − expenses.
  - `profitMargin` = profit / revenue × 100.
  - `codCollected` = sum of `Transaction.amount` where type is `cod_collection` and status is collected, deposited or reconciled.
  - `outstandingReceivables` = sum of `AgentCollection.amount` where status is draft, verified, approved or deposited.
  - `codPending` = outstandingReceivables + sum of `totalAmount` of out_for_delivery orders with `codAmount`.
  - Digital revenue (4020) and Paystack fees (5060) appear to be excluded from this summary. GUESS: this is an inconsistency with the P&L, and `getProfitLoss` at `:1774` was not read.
- **`calculateProfitMargins:965`:** revenue = sum of `totalAmount` of delivered orders (windowed on `updatedAt`). Cost = current `product.cogs × quantity` (not COGS at time of sale). Gross profit and margin are computed from those. This is not GL-based and can differ from the summary.
- **`getPipelineRevenue:1400`:** sum of `totalAmount` for orders in confirmed, preparing, ready_for_pickup or out_for_delivery, grouped by status.
- **`getAgentCashHoldings:1451`:** `AgentBalance.currentBalance > 0`, collection count, oldest collection date, top 20.
- **`getCashFlowReport:1529`:**
  - `cashInHand` = GL 1010 balance.
  - `cashInTransit` = sum of `totalAmount` of delivered orders whose `paymentStatus` is not reconciled or deposited (operational, not GL).
  - `outstandingReceivables` = GL 1020 balance.
  - `cashExpected` = out_for_delivery orders with `codAmount`.
  - `cashAvailableNow` = inHand + receivables.
  - `totalCashPosition` = all four components. GUESS: possible double counting between in-transit and receivables.
  - `totalCashPipeline` = cashAvailableNow + inTransit + expected.
- **`generateCashFlowForecast:1585`:** 30 days, linear. Average daily collections (last 30 days) minus average daily expenses, starting at GL 1010 + 1015, floored at 0, cached.
- **`getBalanceSheet:1679`:** GL balances as of a date. Retained earnings = all-time revenue − expenses.
- **Also:** `getProfitabilityAnalysis:1024`, `getAgentAgingAnalysis:1868` (not read in detail).

### Agent and collections
- **Aging buckets:** `agingService.ts:53` groups unreconciled collections by days since `collectionDate` into 0–1, 2–3, 4–7 and 8+. It rebuilds from scratch on cron and on events.
- **`getOverdueAgents:293`:** returns agents with warning and critical amounts (thresholds not read).
- **Balance fields:** `AgentBalance` tracks `totalCollected`, `totalDeposited` and `currentBalance`.
- **Rep earnings:** `repPerformanceService.ts` computes success rate, month-to-date delivered, status counts, and earnings = orders × `commissionAmount` (fixed per delivery).

### Platform: `services/platformService.ts:8`
- MRR = sum over active tenants of `plan.priceGHS` × tenant count.
- Active, suspended and total tenant counts.
- Active users = logged in within 30 days, excluding platform admins.
- Cumulative tenant growth by day.

### MCP
MCP analytics tools (`mcp/tools/analytics.ts`) have their own daily, weekly and monthly summaries. GUESS: they are separate logic from `analyticsService` and may not match the dashboard. Not compared.

## 5. Data model (`backend/prisma/schema.prisma`)

- **Tenancy and SaaS:**
  - `Tenant` has a slug, currency (default GHS), plan, subscription status and Paystack customer/subscription codes.
  - `Plan` has `priceGHS`, `priceNGN`, `maxOrders`, `maxUsers` and `features`.
  - `PlatformAnnouncement`, `McpApiKey`, `SystemConfig` (one row per tenant; holds providers, permissions and business settings) and `WebhookEvent`.
- **People:** `User` (all staff; role, commission, availability, vehicle fields, plus agent `totalCollected`) and `Customer` (`@@unique([phoneNumber, tenantId])`, opt-outs, unsubscribe token).
- **Catalog:** `Product` (price, `stockQuantity`, `cogs`, digital fields), `product_cost_entries` and `InventoryShipment` (inbound purchases).
- **Orders:**
  - `Order` has status, `paymentStatus`, money fields (all Float), `codAmount`, deposit and balance, `fbp`/`fbc`, soft delete, `customerRepId`, `deliveryAgentId`, `payoutId`, `glJournalEntryId`, `revenueRecognized` and `webhookFingerprint`. It carries `@@unique([tenantId, paymentReference])`.
  - Related: `OrderItem`, `OrderHistory`, `Delivery` (1:1 with order), `Transaction` (1:1), `Call`, `DownloadToken` and `FormSubmission`.
  - Status enum: `pending_confirmation`, `payment_pending`, `confirmed`, `preparing`, `ready_for_pickup`, `out_for_delivery`, `delivered`, `digital_delivered`, `cancelled`, `returned`, `failed_delivery`, `payment_failed`.
  - `PaymentStatus`: `pending`, `paid`, `collected`, `deposited`, `reconciled`.
- **Checkout:** `CheckoutForm`, `FormPackage`, `FormUpsell`, `FormSubmission` and `PendingCheckout` (Paystack snapshot, no FK).
- **Cash accountability:** `AgentCollection` (1:1 with order), `AgentDeposit`, `AgentBalance` and `AgentAgingBucket`.
- **Accounting:** `Account` (self-referencing tree, `currentBalance` Decimal), `JournalEntry` (with a `JournalSourceType` enum, void and reversal self-relations), `AccountTransaction` (`tenantId` required), `Expense` and `Payout`.
- **Stock:** `AgentStock` (unique per agent and product), `InventoryTransfer` (`TransferType`: allocation, order_fulfillment, agent_transfer, return_to_warehouse, adjustment).
- **Comms:** `MessageLog`, `SmsTemplate`, `EmailTemplate`, `EmailCampaign` and `Notification`.
- **Automation and integration:** `Workflow`, `WorkflowExecution`, `WebhookConfig`, `WebhookLog` and `AuditLog`.
- **Number types:** 54 `Float`/`Decimal` fields in total. Money is split between Float (orders, products, expenses, packages) and Decimal (GL, agent balances, shipments, plans).

## 6. MCP server (`backend/src/mcp/`)

### Transports and auth
- **stdio:** `server.ts`, run with `npm run mcp`. Reads the `MCP_API_KEY`-style env var (name in `mcp/config.ts`).
- **HTTP:** `httpTransport.ts`, `POST /mcp`, Bearer `mcp_...`. It is stateless and builds a fresh server per request.
- **Keys:** `McpApiKey` rows store a SHA-256 hash, tenant, label, expiry and revoke time. Keys are managed at `/api/mcp-keys` and in Settings > Integrations (`McpIntegration.tsx`).
- **Tenant scoping:** every tool call is wrapped (`createServer.ts:32`) with a rate limit, key validation (60s cache) and `tenantStorage.run({tenantId})`, so tools get the same Prisma tenant extension as the API.
- **Weaknesses:**
  - The rate limiter (`rateLimiter.ts`) is one in-process token bucket, shared by all tenants.
  - The auth cache holds a single entry.
  - MCP calls have no user identity, so there is no actor for audit.

### Tools (13)

| Tool | File | What it does |
|---|---|---|
| `orders_search` | `tools/orders.ts:31` | Filter orders by status, dates, customer, agent or keyword; paginated. |
| `orders_summary` | `tools/orders.ts:112` | Count by status, total revenue and fulfilment rate for a period. |
| `orders_update_status` | `tools/ordersWrite.ts:115` | **The only write tool.** Calls `orderService.updateOrderStatus`, with the same whitelist as the UI. Idempotent, accepts a backdated `deliveryDate`, and fires inventory, payment and GL side effects. |
| `analytics_daily` / `_weekly` / `_monthly` | `tools/analytics.ts:23,105,150` | Business summaries with comparison and growth. |
| `agents_status` | `tools/agents.ts:17` | Delivery agent workload. |
| `agents_performance` | `tools/agents.ts:79` | Deliveries completed, success rate and average time. |
| `deliveries_active` | `tools/deliveries.ts:18` | Active deliveries, filtered by agent, status or city. |
| `customers_lookup` | `tools/customers.ts:17` | Search by phone or name, with order history. |
| `products_inventory` | `tools/products.ts:15` | Stock levels, low-stock filter. |
| `financial_summary` | `tools/financial.ts:14` | Revenue and collections summary. |
| `reps_status` / `reps_performance` | `tools/customerReps.ts:17,79` | Rep workload and performance. |

There is also an MCP resource `resources/schema.ts`. It describes Order, Customer and Agent fields with names that do not match the real schema (for example `deliveryFee` vs the real `shippingCost`; GUESS: stale).

### What an in-app AI agent could reuse today
All of these are service-level and callable inside `tenantStorage`. Each exposes a method signature in the listed file. None is registered as an MCP tool yet, except order status.

- **Update order status:** `orderService.updateOrderStatus` (already an MCP tool).
- **Update order or customer fields:** `orderService.updateOrder` (`:818`); `customerService`.
- **Add expense:** `financialService.recordExpense(data, requester?)` (`:347`). It posts the GL entry atomically. It needs `recordedBy`, which is either the requester or `data.recordedBy` parsed to an int.
- **Allocate, transfer, return or adjust agent stock:** `agentInventoryService.allocateStock`, `transferStock`, `returnStock`, `adjustStock` (all take a creator user id).
- **Verify collection, create or verify a deposit, block or unblock an agent:** `agentReconciliationService`.
- **Log a call:** `callService`.
- **Send WhatsApp, SMS or email:** `whatsappService.sendWhatsAppForOrder`, `smsService`, `emailService`, `communicationService`.
- **Run workflows:** `workflowService`.

### Gaps for an AI agent
- **No warehouse stock-movement function.** `PATCH /products/:id/stock` writes the number directly with no ledger. A real "create stock movement" needs a new service and table.
- **Shipment create and arrive logic sits in `shipmentController.ts`.** There is no `shipmentService`, so it needs extraction first.
- **Required actor FKs.** `InventoryTransfer.createdById`, `JournalEntry.createdBy` and `InventoryShipment.createdById` are required Users. An agent needs a per-tenant service-user id.
- **Role checks.** Many services take a `requester` for role scoping, and the MCP path passes none. An AI action layer needs its own policy and approval step, because RBAC only runs in Express middleware.

## 7. Test health

| Suite | Runner | Files | Cases (grep count) |
|---|---|---|---|
| Backend unit and integration | Jest 29 with ts-jest (`backend/jest.config.js`, `--runInBand`) | 91 (about 74 unit-style, about 13 integration, 1 perf) | about 1,090 |
| Frontend | Vitest 4 with Testing Library (`frontend/vitest.config.ts`) | 21 | about 156 |
| E2E | Playwright (`playwright.config.ts`, `e2e/`) | 11 specs plus 1 manual script | not counted |

- **Backend coverage:** services (GL, orders, analytics, financial, reconciliation, Paystack, communications, workflows, platform) and tenant isolation (`tenantIsolation.test.ts`, `prismaExtensions.test.ts`).
- **Frontend coverage:** mostly stores, the checkout builder and embed, and a few pages. Most pages and the dashboard have no tests.
- **Integration tests need a real Postgres and Redis.** CI starts both (`.github/workflows/backend-ci.yml`).
- **Skips:** `.skip`/`.todo`/`xit` appear in 7 files (9 hits): the 5 oldest E2E specs plus `order-workflow.test.ts` and `webhook-flow.test.ts`.
- **Coverage gate** is low: lines 37%, branches 25%, functions 29%, statements 38%. `sockets`, `queues` and `scripts` are excluded from coverage.
- **MCP:** one test file (`mcpOrdersUpdateStatus.test.ts`, 9 cases). The read tools are untested.
- **CI workflows:** `backend-ci.yml`, `frontend-ci.yml`, `security-audit.yml`, `claude.yml` and `claude-code-review.yml`.
- **Not verified:** I did not run anything, so whether the suites currently pass is unknown.

## 8. Tech debt and risks before a redesign

### High
1. **No subscription enforcement.**
   - `register-tenant` creates tenants as `pending` (`authController.ts:393`), and the comment says "enforcement sibling" will lock them.
   - No such middleware exists in `middleware/`. `suspended`, `past_due` and `pending` tenants can still use the API.
   - `maxOrders` and `maxUsers` are never enforced.
   - Result: unpaid access.
2. **GL chart of accounts is not tenant-safe.**
   - `Account.code` and `JournalEntry.entryNumber` are globally `@unique`.
   - Startup seeding (`asyncVerifyGLAccounts`) creates accounts with no tenant context, so they get `tenant_id = NULL`. The tenant extension then hides them from tenant-scoped queries (the "NULL tenant_id hides rows" note in memory).
   - Nothing seeds a chart for a new tenant: `onboardingController` and `register-tenant` have no account creation.
   - GUESS: GL posting works for the original tenant (backfilled) but fails or silently misroutes for later tenants, and a second tenant cannot create the same codes.
3. **Tenant isolation is fail-open and partial.**
   - The extension passes through when there is no tenant context (cron, queues, setImmediate, public routes).
   - Models missing from `TENANT_SCOPED_MODELS` and with no `tenantId`: `AgentCollection`, `AgentDeposit`, `AgentAgingBucket`, `Payout`, `Call`, `SmsTemplate`, `AuditLog`, `WebhookLog`, `OrderHistory`, `DownloadToken`, `FormSubmission` and `product_cost_entries`. `PendingCheckout` and `WebhookEvent` carry a `tenantId` column but are not in the scoped list.
   - `agingService.refreshAll` is global and runs `agentAgingBucket.deleteMany({})` on cron. GUESS: aging reports can expose other tenants' agents.
   - `SmsTemplate.name` is globally unique.
   - `Product.sku` is globally unique.
4. **Schema and migration drift.** The three placeholder migrations (section 0), a stale `statusVersion` doc claim, and a `deploy-staging.sh` that tolerates failed `migrate deploy` (`|| echo Warning`).
5. **Money type split.** Order, product, expense and package amounts are Float while the GL is Decimal(19,4). Rounding mismatches can leak between operational KPIs and GL. The "decimal migration" never landed in the schema.

### Medium
6. **KPI inconsistency.** At least four revenue definitions: GL 4010 (dashboard and finance), `Σ totalAmount` including cancelled (sales trends), delivered-only (profit margins), and product-line revenue (product performance). Fix the definitions before redesigning dashboards (section 4).
7. **Workflow engine gaps.** Mock `http_request`; `update_order` and `assign_agent` bypass `orderService`, so they skip GL, inventory and history.
8. **Business logic in controllers.** `shipmentController.ts` and `productController.ts` (stock) have no service layer, which blocks reuse by an AI agent or MCP.
9. **No warehouse stock ledger.** Only raw overwrite plus agent transfers.
10. **MCP limits.** A global in-process rate limiter and a single-entry auth cache.
11. **Dead code and duplicate libs** (section 3): unrouted pages, two React Flow packages, `components/ui` custom plus `components/common` duplicates (for example `ErrorBoundary` exists in both `components/` and `components/common/`).
12. **Mobile agent UX** is opt-in only. Docs and comments disagree about its maturity.
13. **Sunset item overdue:** legacy Paystack handler (`paystackController.ts:118`).
14. **Reliability and ops.**
    - Cron jobs and workers run inside the API process.
    - The 30s request timeout applies to all routes (`requestTimeout`).
    - Uploads fall back to the local disk, which is volatile in containers.
    - The platform admin SPA ships inside the tenant SPA.

### Low
15. **Doc rot.** `CLAUDE.md`, `docs/README.md` and `.claude/plans/roadmap.md` are out of date, and `docs/features/*` status labels disagree with the code.
16. **Debug logging.** `analyticsService.getDashboardMetrics` has `console.log` debug blocks gated on `NODE_ENV === 'development'`.
17. **Stale MCP schema resource** (`mcp/resources/schema.ts`).

## Files to read first for the redesign
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/prisma/schema.prisma`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/utils/prismaExtensions.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/middleware/auth.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/orderService.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/glAutomationService.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/financialService.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/analyticsService.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/agentReconciliationService.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/mcp/createServer.ts`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/controllers/authController.ts` (register-tenant, line 360 onward)
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/App.tsx`
- `/Users/mac/Downloads/claude/ecommerce-cod-admin/docs/features/paystack-checkout.md`
