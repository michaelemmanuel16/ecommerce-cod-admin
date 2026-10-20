# CodAdmin backend inventory (rebuild baseline)

Source: `/Users/mac/work/codadmin/backend/src` + `backend/prisma/schema.prisma`, read 2026-10-18 on the checked-out tree. Verified against code; `docs/research/codebase-audit.md` used as a pointer only. Anything inferred = **GUESS**. Anything seen in code that looks like a defect = **NOTE**.

Legend: sa=super_admin, ad=admin, mg=manager, sr=sales_rep, im=inventory_manager, da=delivery_agent, ac=accountant. `AUTH`=JWT only (any role). `RP(res,act)`=`requireResourcePermission` (DB matrix, section 7; sa bypasses). `ROLES(..)`=hard-coded role list. `PA`=platform admin (DB flag). `PUBLIC`=no auth. Every authed group also runs `tenantRateLimiter` (Redis, only if `Tenant.rateLimitEnabled`); every `/api/*` mount except auth/platform/public also runs `apiLimiter` (500 per 15 min per IP in prod).

## 0. Audit corrections (audit vs code)
- Schema has **44 models + 18 enums** (audit said 58). No `statusVersion`, no multi-store, no `AccountingPeriod` model in this tree.
- MCP has **14 tools** (audit said 13; `ordersWrite` + 13 read tools).
- `deliveryService.markDeliveryFailed`, `createDelivery`, `autoAssignAgent`, `getAgentStats` have **no callers** outside tests (no fail-delivery route exists; failed delivery is only reachable via order status `failed_delivery`, which does NOT create the failed-delivery GL entry, see 2.2).
- `customerService.mergeCustomers/searchCustomers/getTopCustomers/getCustomerDistribution/getCustomerOrderHistory/getCustomerByPhone/add|removeCustomerTags` have no callers (dead).
- Workflow triggers `payment_received`, `time_based`, `webhook` exist in the enum but nothing fires them. Only `order_created`, `status_change`, `manual` fire.
- `Tenant.defaultDeliveryFee` is stored but never read. Public checkout hard-codes `shippingCost = 0` (`publicOrderController.ts:339`).
- Plan limits and `subscriptionStatus` are **never enforced** (only displayed in `GET /api/billing/subscription`). Confirmed by grep.

## 1. API routes
Mount order and base paths from `server.ts`. Total **275 endpoints** (270 in route files + 5 mounted directly in `server.ts`).

### 1.0 Mounted directly in server.ts
| Method path | Handler | Access | Purpose |
|---|---|---|---|
| GET `/` | inline | PUBLIC | API banner |
| GET `/api/whatsapp/webhook` | whatsappController.verifyWebhook | PUBLIC (verify token) | Meta webhook handshake |
| POST `/api/whatsapp/webhook` | whatsappController.handleWebhook -> whatsappService.processStatusUpdate | PUBLIC (HMAC `x-hub-signature-256`) | Delivery receipts; inbound messages logged only |
| GET `/api/whatsapp/oauth/callback` | whatsappOAuthController.handleOAuthCallback | PUBLIC (CSRF state, 10 min TTL) | Meta Embedded OAuth return |
| POST `/mcp` | mcp/httpTransport | Bearer `mcp_...` key | MCP Streamable HTTP, stateless |
| `/uploads/*` static | express.static | PUBLIC | Local upload fallback |

### 1.1 `/` health (health.routes.ts) PUBLIC, no tenant
GET `/health`, `/ready` (DB `SELECT 1`, healthLimiter), `/live`, `/health/detailed` (healthLimiter), `/metrics` (Prometheus text, process stats). Inline handlers.

### 1.2 `/api/auth` (authController; services: adminService, emailService)
| Endpoint | Access | Purpose |
|---|---|---|
| POST `/register-tenant` | PUBLIC, registrationLimiter 5/15min | Create Tenant (+slug), first super_admin user; tenant lands `pending`; optional plan growth/scale |
| POST `/register` | PUBLIC, authLimiter | Create user with role in {manager,sales_rep,inventory_manager,delivery_agent,accountant}. **NOTE**: sets no `tenantId` (null) and is open to the internet; null-tenant JWT bypasses the tenant extension (see 7.3) |
| POST `/login` | PUBLIC, authLimiter 40/15min | Email+password, returns access (15m) + refresh (7d) tokens, role permissions |
| POST `/refresh` | PUBLIC, authLimiter | Rotate tokens (refresh token stored on User) |
| POST `/forgot-password`, `/reset-password` | PUBLIC, authLimiter | Email reset link (`passwordResetToken/Expires`) |
| POST `/logout` | AUTH | Clear refresh token |
| GET `/me` | AUTH | Current user + permissions |
| DELETE `/delete-account` | sa | Hard-delete all tenant data in one transaction (raw SQL) |

### 1.3 `/api/admin` (adminController -> adminService)
| Endpoint | Access | Purpose |
|---|---|---|
| GET `/config` | PUBLIC | businessName + currency only |
| GET `/config/me` | AUTH | same, authed |
| GET/PUT `/settings` | sa | SystemConfig read/update (provider secrets masked on read, encrypted on write, Paystack mode/key-prefix check) |
| GET/PUT `/permissions` | sa | Role permission matrix read/update; PUT clears cache + socket `permissions:updated` |
| GET `/users` | sa,ad,mg | List users |
| POST `/users`, PUT `/users/:id`, POST `/users/:id/reset-password`, DELETE `/users/:id`, DELETE `/users/:id/permanent` | sa,ad | User CRUD, admin password reset, soft/hard delete; role-weight check (`canManageRole`); writes `AuditLog` |

### 1.4 `/api/users` (userController -> adminService, repPerformanceService; payoutController -> payoutService)
| Endpoint | Access | Purpose |
|---|---|---|
| GET `/`, POST `/` | sa,ad,mg / sa,ad | List / create users |
| GET `/reps/workload` | sa,ad,mg | Rep workload |
| GET `/reps/performance` | sa,ad,mg,sr | Rep performance (repPerformanceService) |
| PUT `/reps/:id` | sa,ad,mg | Update rep details (commissionAmount etc.) |
| GET `/reps/:id/pending-payments`, GET `/reps/:id/payout-history`, POST `/reps/:id/process-payout` | sa,ad,mg | Unpaid delivered orders, payout history, pay commission (creates Payout, flags orders, GL entry) |
| GET `/agents/performance` | sa,ad,mg | Delivery-agent performance |
| GET/PUT `/preferences` | AUTH | Per-user `User.preferences` JSON (onboarding flags etc.) |
| GET `/me/payout-history` | AUTH | Own payouts |
| GET `/:id` | sa,ad,mg | User by id |
| GET `/:id/profile` | self or sa/ad | Own profile |
| PUT `/:id`, DELETE `/:id` | sa,ad | Update / soft-delete user |
| PATCH `/:id/availability` | AUTH | Toggle `isAvailable` |

### 1.5 `/api/customers` (customerController -> customerService)
GET `/` RP(customers,view); POST `/` RP(customers,create); GET `/:id` view; PUT `/:id` update; DELETE `/:id` delete (soft); PATCH `/:id/tags` update; GET `/:id/analytics` view. Row scoping by `requester` inside service for sr/da.

### 1.6 `/api/products` (productController, shipmentController; no service layer; shipmentController -> glAutomationService)
| Endpoint | Access | Purpose |
|---|---|---|
| GET `/shipments`, GET `/shipments/:id` | RP(products,view) | Inbound inventory shipments |
| POST `/shipments`, PATCH `/shipments/:id`, DELETE `/shipments/:id` | RP(products,update_stock) | Create/edit/delete shipment (status `pending`) |
| PATCH `/shipments/:id/arrive` | RP(products,update_stock) | Mark arrived: increments `stockQuantity`, posts GL inventory purchase (DR 1200 / CR 1010) |
| GET `/` | either RP(products,view) or RP(orders,create) | List products |
| POST `/` | RP(products,create) | Create (physical or digital) |
| GET `/low-stock`, GET `/:id` | RP(products,view) | Low stock (<= `lowStockThreshold`), detail |
| PUT `/:id`, DELETE `/:id` | RP(products,update)/delete | Update / soft delete |
| PATCH `/:id/stock` | RP(products,update_stock) | Raw overwrite of `stockQuantity`. **NOTE**: no movement ledger |

### 1.7 `/api/orders` (orderController, bulkOrderController -> orderService)
| Endpoint | Access | Purpose |
|---|---|---|
| GET `/` | RP(orders,view) | List/filter (sr/da scoped to own) |
| GET `/export` | RP(orders,view), bulk limiter 5/5min | CSV/Excel export, max 500 rows |
| POST `/upload` | RP(orders,bulk_import), limiter 10/5min | CSV/XLSX import (multer, 10 MB), rep/agent name mapping |
| POST `/bulk` | RP(orders,bulk_import) | JSON bulk import, batches of 50 |
| GET `/kanban`, GET `/stats` | RP(orders,view) | Kanban columns, stats |
| DELETE `/bulk` | RP(orders,delete), limiter | Bulk soft delete |
| POST `/` | RP(orders,create) | Create order (find/create customer by phone) |
| GET/PUT/DELETE `/:id` | view/update/delete | Detail / update / soft delete |
| PATCH `/:id/status` | RP(orders,update) | Status change with inventory/GL/workflow side effects (2.2) |
| PATCH `/:id/assign-rep`, `/:id/assign-agent` | RP(orders,assign) | Assign customer rep / delivery agent (agent blocked-check) |

### 1.8 `/api/deliveries` (deliveryController -> deliveryService)
GET `/` AUTH; GET `/agent-orders` RP(orders,view); GET `/by-order/:orderId` RP(orders,view); GET `/routes/:agentId` AUTH; GET `/:id` AUTH; PATCH `/:id/proof` AUTH (photo/signature/OTP proof); PATCH `/:id/complete` AUTH (completes delivery, GL revenue entry, draft collection). **NOTE**: complete/proof/get have only `authenticate`, no role or ownership middleware (GUESS: ownership checked in service for da).

### 1.9 `/api/agent-reconciliation` (agentReconciliationController -> agentReconciliationService, agingService)
| Endpoint | Access | Purpose |
|---|---|---|
| GET `/` | sa,ad,mg,ac,da | Collections list |
| GET `/stats/:agentId` | sa,ad,mg,ac | Agent collection stats |
| POST `/:id/verify`, POST `/bulk-verify` | sa,ad,mg,ac | draft->verified; GL DR1010 / CR1015 |
| POST `/:id/approve` | sa,ad,mg | verified->approved |
| GET `/agents/:id/balance` | sa,ad,mg,ac,da | Agent balance |
| GET `/agents/balances` | sa,ad,mg,ac | All balances. **NOTE**: declared after `/agents/:id/balance`; ordering is fine (different depth) |
| GET `/deposits`, POST `/deposits` | sa,ad,mg,ac,da | List / submit agent deposit (method bank_transfer/cash/mobile_money/check, unique reference, receipt URL regex) |
| POST `/deposits/:id/verify`, `/deposits/:id/reject`, `/deposits/bulk-verify` | sa,ac | Verify (FIFO match to approved collections, GL DR1010/CR1020) / reject with notes / bulk (max 50) |
| GET `/aging`, GET `/aging/export` | sa,ad,mg,ac | Aging report / CSV |
| POST `/agents/:id/block`, `/agents/:id/unblock`, GET `/agents/blocked` | sa,ad,mg (GET also ac) | Manual block (blocks assignment) / list |

### 1.10 `/api/agent-inventory` (agentInventoryController -> agentInventoryService)
POST `/allocate`, `/transfer`, `/return`, `/adjust` (adjust requires notes) : sa,ad,mg,im. GET `/product/:productId`, `/summary`: sa,ad,mg,im,ac. GET `/agent/:agentId`, `/transfers`: sa,ad,mg,im,ac,da. Maintains `AgentStock` + `InventoryTransfer` ledger.

### 1.11 `/api/financial` (financialController -> financialService, agingService, glAccountService)
All RP(financial,view) unless noted.
GET `/summary`, `/reports`, `/balance-sheet`, `/profit-loss`, `/profit-margins`, `/profitability`, `/profitability/export`, `/pipeline-revenue`, `/cash-flow`, `/cash-flow/export/csv`, `/agent-aging`, `/agent-aging/export/csv`, `/transactions`, `/cod-collections`, `/expenses`, `/expenses/breakdown`, `/agent-cash-holdings`, `/agents/settlement/:agentId`: reports/lists.
POST `/collections/deposit` RP(financial,update): legacy mark COD transactions deposited (GL DR1010/CR1015). POST `/transactions/:id/reconcile` RP(financial,update).
POST `/expenses` RP(financial,create): record expense (+GL DR5100/CR1010, socket). PUT `/expenses/:id` update, DELETE `/expenses/:id` delete (GL reversal assumed, GUESS).
Admin ops (ad,sa): GET `/health` (financial integrity check), POST `/refresh-aging`, `/backfill-collections`, `/backfill-delivery-dates`, `/backfill-commissions`.

### 1.12 `/api/gl` (glController -> glService)
RP(gl,*): GET/POST `/accounts`, GET/PUT/DELETE `/accounts/:id`, PATCH `/accounts/:id/deactivate|activate`, GET `/accounts/:id/balance`, `/accounts/:id/ledger`, `/accounts/:id/ledger/export` (CSV). GET `/journal-entries`, `/journal-entries/:id`: view. POST `/journal-entries` (manual) and POST `/journal-entries/:id/void`: **sa only**.

### 1.13 `/api/analytics` (analyticsController -> analyticsService), all RP(analytics,view), Redis/in-memory cache
GET `/dashboard` (300s), `/sales-trends`, `/conversion-funnel`, `/rep-performance`, `/agent-performance` (300s), `/customer-insights` (600s), `/pending-orders`, `/recent-activity` (60s), `/status-distribution`, `/product-performance`, `/area-distribution` (300s; date validators).

### 1.14 `/api/workflows` (workflowController -> workflowService)
RP(workflows,*): GET `/templates` (10 built-in), GET `/`, POST `/`, GET/PUT/DELETE `/:id`, POST `/:id/execute` (execute), GET `/:id/executions`.

### 1.15 `/api/webhooks` (webhookController -> webhookService) inbound order import
PUBLIC (webhookLimiter 100/15min): POST `/import/:uniqueUrl` (per-config URL, optional HMAC `requireSignature`), POST `/import` (legacy, apiKey-based). Admin (sa,ad): GET/POST `/`, GET/PUT/DELETE `/:id`, GET `/:id/stats`, GET `/:id/logs`, POST `/:id/test`.

### 1.16 `/api/notifications` (notificationController, direct prisma)
AUTH: GET `/`, PATCH `/:id/read`, PATCH `/read-all`.

### 1.17 `/api/upload` : POST `/` AUTH, multer image only (jpeg/png/gif/webp, 15 MB) -> R2 if configured else local `/uploads`.

### 1.18 `/api/checkout-forms` (checkoutFormController -> checkoutFormService, paystackService)
GET `/`, `/:id`, `/:id/preview-config`, `/:id/stats`: sa,ad,mg. POST `/`, PUT `/:id`, DELETE `/:id`: sa,ad. Form builder: fields JSON, design (palette-validated), packages, upsells, regions, pixel config, CAPI token, redirectUrl, allowedOrigins, COD/Paystack deposit/full toggles, depositPercent.

### 1.19 `/api/calls` (callController -> callService)
RP(calls,create) POST `/`; RP(calls,view) GET `/`, `/order/:orderId`, `/customer/:customerId`, `/stats`. Create emits socket `call:logged`.

### 1.20 `/api/whatsapp` (whatsappController, whatsappOAuthController)
OAuth (sa): POST `/oauth/initiate`, GET `/oauth/phones`, POST `/oauth/select`, DELETE `/oauth/disconnect`. GET `/oauth/enabled`, `/messages`, `/messages/:id`, `/stats`: sa,ad,mg. POST `/send`, POST `/test`, GET `/status`: sa,ad.

### 1.21 `/api/sms` (smsController -> smsService)
PUBLIC POST `/webhook` (Arkesel delivery report). sa,ad: GET `/status`, POST `/test`.

### 1.22 `/api/email` : POST `/test` sa,ad (emailService.sendTestEmail).

### 1.23 `/api/communications` (communicationController -> communicationService)
sa,ad,mg: GET `/messages`, `/stats`, `/recipients`, `/email-audience`, `/email-templates`, `/campaigns`, `/campaigns/:id`, `/opt-outs`. AUTH: GET `/sms-templates`. sa,ad: POST/PUT/DELETE `/sms-templates[/:id]`, POST/PUT/DELETE `/email-templates[/:id]`, POST `/bulk-sms`, `/bulk-whatsapp`, `/bulk-email` (queues campaign), PATCH `/opt-out/:customerId`.

### 1.24 `/api/paystack` (paystackController -> paystackService, paystackSettlementService; platformBillingWebhookController)
| Endpoint | Access | Purpose |
|---|---|---|
| POST `/platform-webhook` | PUBLIC, HMAC platform secret | CodAdmin's own subscription billing events |
| POST `/webhook/:tenantSlug` | PUBLIC, HMAC tenant secret | Buyer payments (`charge.success` -> settle PendingCheckout -> create Order); idempotent via `WebhookEvent` |
| POST `/webhook` | PUBLIC | Legacy; returns deprecation (sunset 2026-09-01 overdue) |
| GET `/verify/:reference` | PUBLIC | Callback-page verify + settle |
| GET `/admin/verify/:reference` | sa,ad | Manual verify |

### 1.25 `/api/onboarding` (onboardingController, direct prisma)
GET `/status` AUTH; POST `/setup` sa: saves business details to SystemConfig, sets onboarding flag in `User.preferences`; creates a Tenant for legacy tenantless users.

### 1.26 `/api/billing` (billingController -> platformBillingService, platformPaystackService)
GET `/plans` PUBLIC; GET `/subscription` AUTH; POST `/start-subscription` sa (Paystack init in NGN minor units, needs `paystackPlanCode` + `priceNGN`); GET `/verify-subscription/:reference` sa; POST `/cancel-subscription` sa.

### 1.27 `/api/platform` (platformController -> platformService); PA unless noted
AUTH only: GET `/announcements/active`. PA: GET `/metrics`, `/metrics/trends`, `/tenants`, `/tenants/:id`, `/billing-events`, `/announcements`, `/plans`, `/health`; POST `/tenants`, `/tenants/:id/suspend`, `/tenants/:id/reactivate`, `/tenants/:id/grant-free`, `/announcements`; PUT `/tenants/:id`; DELETE `/tenants/:id` (requires confirm slug), `/announcements/:id`.

### 1.28 `/api/mcp-keys` (inline in mcpKeyRoutes, direct prisma) sa
GET `/` list active keys; POST `/` create (`mcp_` + 64 hex, SHA-256 stored, raw shown once; label, expiry); DELETE `/:id` revoke.

### 1.29 `/api/public` (publicOrderController -> checkoutFormService, publicOrderService, paystackService, metaCapiService, workflowService) PUBLIC, CORS `*`, X-Frame-Options removed
GET `/forms/:slug`, `/forms/:slug/config` (form + packages + upsells + Paystack public key); POST `/forms/:slug/orders` (COD: create order now; Paystack: PendingCheckout + initialize, order created on settlement); POST `/forms/:slug/track/initiate-checkout` (CAPI InitiateCheckout); POST `/orders/track` (phone+order id, limiter 30/15min); GET `/download/:token` (digital file via signed token); GET/POST `/unsubscribe/:token` (HTML opt-out page, `Customer.emailOptOut`).

## 2. Services and owned business logic
37 service files in `services/`. Plus `utils/` helpers noted where they own logic.

### 2.1 Table
| Service | Owns |
|---|---|
| orderService | Order CRUD, bulk import, status machine side effects, kanban, stats, assign rep/agent, soft delete, customer stats counters |
| deliveryService | Delivery record, proof, `completeDelivery` (order delivered, COD Transaction, revenue GL, draft AgentCollection), route lookup. Dead: fail/auto-assign/stats |
| financialSyncService | `syncOrderFinancialData`: idempotent post-delivery sync (Transaction + revenue GL + AgentCollection + AgentBalance) |
| glAutomationService | All auto-posted journal entries (2.3) + startup chart seed `asyncVerifyGLAccounts` |
| glService | Chart of accounts CRUD, manual journal entries, void/reverse, ledger, balance recalculation, CSV export |
| glAccountService | `getAccountIdByCode`, `verifyAllAccountBalances` (nightly) |
| financialService | Summary, P&L, balance sheet, cash flow + 30-day forecast, profitability, margins, expenses (CRUD + GL), COD collections, legacy deposit marking, agent holdings/settlement, aging analysis |
| agentReconciliationService | Collection chain, deposits, FIFO matching, balances, block/unblock |
| agingService | Aging buckets (0-1, 2-3, 4-7, 8+ days from `collectionDate`), report/CSV, overdue agents (4-7 > 0 or 8+ > 0). Event-driven refresh |
| agentInventoryService | Allocate/transfer/return/adjust agent stock, order fulfilment record/confirm/reverse, summaries |
| payoutService | Rep commission payouts |
| repPerformanceService | Rep success rate, MTD delivered, earnings by period |
| callService | Call logging + stats; allowed loggers sa,ad,mg,sr |
| assignmentService | Round-robin and weighted user selection (in-memory index, lost on restart); skips inactive, unavailable, blocked agents |
| customerService | Customer CRUD, tags, analytics, phone-unique per tenant, opt-outs |
| analyticsService | Dashboard KPIs, trends, funnel, rep/agent performance, product/area, pending, recent activity |
| checkoutFormService | Form CRUD, packages/upsells, config cache by slug, preview, stats |
| publicOrderService | Public COD order creation (30-min dedupe on phone+package+total, stock decrement, FormSubmission), order tracking |
| paystackService | Per-tenant Paystack init/verify/signature, config cache 60s |
| paystackSettlementService | `settlePaystackPayment`: atomic PendingCheckout claim, amount check, order creation, digital GL (4020, fees 5060), digital delivery |
| platformPaystackService | CodAdmin own subscription billing against platform Paystack account |
| platformBillingService | Bind subscription fields, resolve tenant by customer/subscription code |
| platformService | Tenant admin: metrics, MRR, list/create/update/suspend/reactivate/grant-free/delete, announcements, health |
| adminService | SystemConfig, role permissions, user admin, audit log, role weights |
| workflowService | Workflow CRUD, execution enqueue, trigger matching for order_created/status_change, templates, in-process action runner (duplicate of queue runner) |
| webhookService | Inbound order import, field mapping, dedupe fingerprint, HMAC check, logs/stats/test/retry |
| communicationService | Message log, recipients, bulk SMS/WhatsApp/email, campaigns, templates, opt-outs |
| smsService | Arkesel send, SMS templates, order SMS |
| whatsappService | Graph v21.0 template/text send, order templates, status updates, SMS fallback |
| whatsappTokenRefreshService | Daily refresh of OAuth long-lived token when within 7 days of expiry |
| metaOAuthService | Meta OAuth URL, code exchange, long-lived token, WABA subscribe, phone numbers, revoke |
| metaCapiService | Meta Conversions API Purchase + InitiateCheckout (hashed user data, event_id dedupe with Pixel) |
| emailService | Provider switch sendgrid/resend/smtp, tenant vs platform sender, password-reset and test mail |
| emailTemplateService | Merge tags, HTML sanitize, unsubscribe footer, default templates seed per tenant |
| unsubscribeService | Token creation, opt-out, unsubscribe URL |
| digitalDeliveryService | Download tokens (default 72 h expiry, 5 downloads), email links, revoke/resend |
| notificationService | In-app notifications + socket push. Used: overdue collections, agent blocked/unblocked. **No callers** (dead): `notifyOrderAssigned`, `notifyOrderStatusChanged`, `notifyDeliveryScheduled` |

### 2.2 Order status machine (orderService.updateOrderStatus)
- **No transition validation** (`validateStatusTransition` commented out). API validator accepts: pending_confirmation, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled, returned, failed_delivery. `payment_pending`, `payment_failed`, `digital_delivered` are enum-only (set by Paystack/digital flows).
- Ownership: sr/da restricted to own orders (`checkResourceOwnership`); sa/ad/mg bypass.
- **Stock zone**: `out_for_delivery` and `delivered` are "deducted" statuses. Entering the zone: if a delivery agent is assigned, draw from `AgentStock` first (`recordOrderFulfillment`), remainder from warehouse `Product.stockQuantity` (guarded decrement, fails if insufficient). Leaving the zone: restore agent stock first (`reverseOrderFulfillment`), rest to warehouse. `out_for_delivery -> delivered` with agent: `confirmOrderDelivery`.
- `delivered`: sets `deliveryDate` (default now, MCP may backdate), `paymentStatus = collected`; then (outside the txn, fire-and-forget) `FinancialSyncService.syncOrderFinancialData` if `codAmount` truthy. 15-min reconciliation job catches misses (batch 50).
- `returned` with `revenueRecognized`: finds latest non-voided `order_delivery` entry and posts reversal (2.3).
- `cancelled` via `cancelOrder`: restock only if order was in deducted zone.
- After commit: socket `order:updated`, `order:status_changed`, then `workflowService.triggerStatusChangeWorkflows` (non-blocking).
- Order create: stock check only (no decrement); emits `order:created`; triggers `order_created` workflows.
- **NOTE (GUESS: double decrement)**: `publicOrderService.createPublicOrder` decrements `Product.stockQuantity` by package quantity at creation (upsell products not decremented), and the status machine decrements again at `out_for_delivery`/`delivered`. Verify before rebuild.
- **NOTE**: `PATCH /deliveries/:id/complete` path also marks delivered and posts GL but is a second route to the same outcome (`deliveryService.completeDelivery`), with its own transaction (no stock logic seen there, GUESS).

### 2.3 GL auto-posting rules (config/glAccounts.ts codes; `GL_DEFAULTS`: failed-delivery fee default 50.00, min COGS 0.01, return fee default 0)
All entries: idempotent per (sourceType, sourceId, not voided), balanced check, Decimal(19,4), retry on `entryNumber` collision, tenant passed explicitly from the order.
| Trigger | sourceType | DR | CR |
|---|---|---|---|
| Delivered (COD) | `order_delivery` | 1015 Cash in Transit = total - agent commission; 5040 Agent commission (flat); 5050 Sales-rep commission; 5010 COGS (if > 0.01) | 4010 Revenue = total; 2020 Commissions Payable = rep commission; 1200 Inventory = COGS |
| Failed delivery | `failed_delivery` | 5020 Failed Delivery Expense (delivery fee or 50) | 1010 Cash in Hand |
| Return | `order_return` | 4010 Revenue = total; 1200 Inventory = COGS; 2020 = rep commission; 5030 Return Processing = fee | 1015 = net; 5040, 5050 reversals; 5010 COGS; 2010 Refund Liability = fee |
| Collection verified | `agent_collection` | 1010 Cash in Hand | 1015 Cash in Transit |
| Agent deposit verified | `agent_deposit` | 1010 Cash in Hand | **1020 AR Agents** |
| Legacy COD deposit | `agent_deposit` | 1010 | 1015 |
| Expense | `expense` | 5100 Operating Expense | 1010 |
| Commission payout | `payout` | 2020 Commissions Payable | 1010 |
| Shipment arrived | `inventory_purchase` | 1200 Inventory = total cost (unit + shipping + duties + other) | 1010 |
| Digital sale (Paystack) | `digital_sale` | 1030 Paystack Receivable = total; 5060 Paystack Fees = fee | 4020 Digital Revenue = total; 1030 = fee |
| Manual (sa) | `manual` | user-defined balanced lines | |
| Void | `reversal` | swap of original lines; links `reversingEntryId`, sets `isVoided` | |
- Commission = flat per-user `User.commissionAmount` per delivered order (not a percentage). Agent holds net (gross - agent commission); rep commission accrues to payable.
- Chart seeded at startup (`asyncVerifyGLAccounts`, 16 system accounts, no tenant context) and server exits if seeding fails.
- **NOTE**: agent deposit credits 1020 AR Agents while delivery debits 1015 and collection verify credits 1015. 1020 is never debited in any rule. GUESS: AR 1020 balance goes negative and 1015 never fully clears (double handling of the same cash). Needs accounting review.
- **NOTE**: `Account.code` and `JournalEntry.entryNumber` are globally unique, so a second tenant cannot own the same codes; seeding has no tenant (audit finding confirmed).
- Not present: period close / `AccountingPeriod` (enum value `period_close` exists, unused). Balance sheet retained earnings = all-time revenue - expenses.

### 2.4 Reconciliation / COD cash chain
`AgentCollection` (1:1 order) states: `draft` (created on delivery, amount = net) -> `verified` (accountant/admin; GL 2.3) -> `approved` (admin/manager) -> `deposited` (FIFO-matched by an agent deposit, sets `allocatedAmount`) -> `reconciled`. `AgentDeposit`: `pending` -> `verified` (checks agent `currentBalance >= amount`, decrements `AgentBalance`, FIFO matches approved collections oldest first) | `rejected` (notes required). `AgentBalance`: totalCollected, totalDeposited, currentBalance, isBlocked. Manual block only (no auto-block rule found). Blocked agents are skipped by assignment (`assignmentService`). Event `AGENT_COLLECTION_RECONCILED` triggers aging refresh.

### 2.5 Aging
Buckets by days since `collectionDate`: <=1, <=3, <=7, 8+. Population = collections in draft/verified/approved/deposited (excl. reconciled and soft-deleted orders). Warning = bucket 4-7, critical = bucket 8+. Refresh is global (`deleteMany({})` + rebuild, no tenant filter, **NOTE** cross-tenant), run daily 06:00, plus on events `AGENT_COLLECTION_RECONCILED`, `BULK_ORDERS_IMPORTED`, `ORDERS_DELETED`. Overdue notification daily 10:00 to admins.

### 2.6 Workflows
Triggers fired: `order_created`, `status_change` (matches `triggerData.status` or `targetStatus`), manual `/execute`. Conditions: AND/OR groups, operators equals, not_equals, greater_than, less_than, >=, <=, contains, not_contains, starts_with, ends_with, in, not_in, is_empty, is_not_empty. Actions: `send_sms`, `send_email`, `send_whatsapp` (template keys order_created, confirmed, out_for_delivery, delivered, failed_delivery; auto SMS fallback), `update_order`, `assign_agent`, `assign_user` (round-robin/weighted via assignmentService), `add_tag`, `wait` (in-job `setTimeout`, blocks worker), `http_request` (**mock, logs only**). Execution logged in `WorkflowExecution`; failure stops the run. `update_order`/`assign_agent` write directly via Prisma, bypassing orderService (no GL/inventory/history). Two parallel action runners exist (workflowQueue.ts and workflowService.processWorkflowExecution). 10 built-in templates in `data/workflowTemplates.ts`: assign-by-product, high-value-alert, send-confirmation-sms, assign-by-area, vip-customer-priority, failed-delivery-followup, out-for-delivery-notification, low-stock-alert, collect-payment-reminder, weekend-order-handling.

### 2.7 Checkout / payments
- Public order: COD creates order `pending_confirmation` immediately and fires CAPI Purchase. Paystack (deposit or full) creates `PendingCheckout`, initializes in minor units, order is created on webhook/callback settle after: tenant match, Paystack verify, amount >= expected, atomic delete-claim. Digital products: GL digital sale, download token, email links, status `digital_delivered`.
- Deposit: `depositPaid`, `balanceDue` (Int) and `codAmount` = balance for the agent to collect.
- Order sources: form, manual, bulk import, webhook (`source`, `externalOrderId`, `webhookFingerprint` dedupe).

### 2.8 Analytics definitions (see audit section 4 for inconsistencies, which still hold)
Dashboard revenue = GL 4010 credit-debit by `entryDate`; sales-trends revenue = sum(totalAmount) all statuses; financial summary revenue = 4010 only (digital 4020 and fees excluded, GUESS inconsistency); margins use current `product.cogs` not historical. `getCustomerInsights.activeCustomers` duplicates `totalCustomers` query (bug). Unused-by-route methods: `getTimeSeriesData`, `getRealTimeStats`.

## 3. Background jobs, schedulers, realtime
In-process (same Node process as the API). Redis host/port/password from env. Under `NODE_ENV=test` queues are inert stubs.
### 3.1 Bull queues (all `attempts: 3`, exponential backoff)
| Queue | Job | Schedule | Does |
|---|---|---|---|
| `agent-aging-refresh` | `refresh-buckets` | cron `0 6 * * *` | `agingService.refreshAll` |
| `agent-aging-refresh` | `notify-overdue-collections` | cron `0 10 * * *` | Notify admins of agents with 4+ day buckets |
| `financial-reconciliation` | `reconcile-delivered-orders` | `*/15 * * * *`, timeout 120s | Delivered, `revenueRecognized=false`, `codAmount>0`, batch 50; re-run financial sync under each order's tenant |
| `message-log-cleanup` | `cleanup-old-messages` | `0 4 * * *` | Delete `MessageLog` older than `MESSAGE_LOG_RETENTION_DAYS` (90) in 1000-row batches |
| `pending-checkout-cleanup` | `cleanup-stale-pending` | `0 * * * *` | Delete `PendingCheckout` older than `PENDING_CHECKOUT_RETENTION_HOURS` (24) |
| `workflow-execution` | `execute-workflow` | on demand | Run workflow actions sequentially under tenant context; emits `workflow:execution_started/completed` |
| `email-campaign` | `send-campaign-email` | on demand (one job per recipient, deterministic jobId, backoff 2s) | Render template, append unsubscribe footer + List-Unsubscribe headers, skip opted-out and placeholder `@codadminpro.com` addresses, update campaign status `queued/sending/completed` |
Repeatable jobs are removed and re-added at every boot.
### 3.2 node-cron
| Cron | Where | Does |
|---|---|---|
| `0 1 * * *` | whatsappTokenRefreshService (only if `META_APP_ID` set) | Refresh WhatsApp OAuth token within 7 days of expiry |
| `0 2 * * *` | server.ts | `GLAccountService.verifyAllAccountBalances` (log discrepancies) |
| `0 3 * * *` | server.ts | Delete local `/uploads` files older than 60 days |
### 3.3 Timers / events
- `setInterval` OAuth pending-state cleanup (whatsappOAuthController; CSRF TTL 10 min, pending data TTL 5 min). In-memory `Map`, lost on restart.
- `appEvents` (EventEmitter): `AGENT_COLLECTION_RECONCILED`, `BULK_ORDERS_IMPORTED`, `ORDERS_DELETED` consumed by agingService.
- In-memory caches: permissions (60s per tenant), SMS/WhatsApp/Paystack/Email provider config (60s), checkout form config by slug, MCP auth (single entry, 60s), HTTP response cache (`middleware/cache.ts` in-memory + Redis `cache.middleware.ts`).
### 3.4 socket.io (`sockets/index.ts`)
Auth: JWT in `handshake.auth.token`. Rooms joined on connect: `role:<role>`, `user:<id>`; client may `join:order` / `leave:order` (`order:<id>`); `ping`->`pong`. **NOTE**: rooms are not tenant-scoped (e.g. `role:admin` spans all tenants); workflow events use global `io.emit`.
Server -> client events: `order:created`, `order:updated`, `order:status_changed`, `order:assigned`, `orders:deleted`, `delivery:updated`, `notification`, `permissions:updated` (also global broadcast), `call:logged`, `expense:created|updated|deleted`, `transaction:deposited`, `transaction:reconciled`, `gl:entry-created`, `collection:verified`, `collection:approved`, `agent:balance-updated`, `deposit:verified`, `workflow:execution_started`, `workflow:execution_completed`.

## 4. Integrations
| Integration | Detail |
|---|---|
| SMS: Arkesel | `https://sms.arkesel.com/api/v2/sms/send`; per-tenant `SystemConfig.smsProvider {authToken(api key, encrypted), senderId default "CODAdmin", isEnabled}`; delivery report webhook `POST /api/sms/webhook`; order SMS templates for order_created, confirmed, out_for_delivery, delivered, failed_delivery; only provider |
| WhatsApp (Meta Cloud API v21.0) | Per-tenant `whatsappProvider {accessToken, phoneNumberId, businessAccountId, appSecret, webhookVerifyToken, isEnabled, token expiry}`; env fallback `WHATSAPP_*`. Template sends (Meta-approved names order_created, order_confirmed, order_out_for_delivery, order_delivered, order_delivery_failed), text sends, status webhook (HMAC), opt-out respected, SMS fallback on failure. Embedded OAuth (initiate, WABA phone list, select, disconnect, webhook subscribe, token revoke, daily refresh) when `META_APP_ID/SECRET` set |
| Email | Per-tenant `emailProvider {provider: sendgrid|resend|smtp, apiKey, smtp*}`; platform sender via `PLATFORM_EMAIL_*` env (default resend) for password reset and platform mail; tenant sender for workflows/campaigns/digital delivery; unsubscribe link + RFC headers; `EmailTemplate` + `EmailCampaign` |
| Paystack (tenant) | Per-tenant `paystackProvider {publicKey, secretKey(enc), mode test|live, isEnabled}`; init/verify; webhook `/api/paystack/webhook/:tenantSlug` (`charge.success`), HMAC with tenant secret; replay guard `WebhookEvent`; currencies GHS/NGN minor units |
| Paystack (platform) | Env `PLATFORM_PAYSTACK_SECRET_KEY`; subscription init/verify/disable; webhook `/api/paystack/platform-webhook` events `subscription.create`, `charge.success`, `invoice.payment_failed`, `subscription.disable`, `subscription.not_renew`; tenant resolved by customer code / subscription code / metadata.tenantId |
| Meta CAPI | Per-form `CheckoutForm.metaCapiAccessToken`, `metaCapiTestEventCode`, pixel id in `pixelConfig.facebookPixelId`; events Purchase (COD at create, Paystack on settle via PendingCheckout) and InitiateCheckout; SHA-256 normalized email/phone/name, raw fbp/fbc/ip/ua; `event_id` dedupe with browser Pixel; `Order.capiEventFired` guard; `fbp`/`fbc` stored on Order |
| Meta OAuth | WhatsApp only (above); Graph base `https://graph.facebook.com/v21.0` |
| Inbound order webhook | `/api/webhooks/import/:uniqueUrl`; `WebhookConfig {fieldMapping, headers, secret, requireSignature, apiKey, productId}`; dedupe by `externalOrderId` and fingerprint (phone+amount+config); `WebhookLog` |
| Outbound webhooks | **None** (workflow `http_request` is a stub) |
| MCP server | `backend/src/mcp`; stdio (`npm run mcp`, env `COD_ADMIN_API_KEY`) and HTTP `POST /mcp`; key table `McpApiKey`; per-call: in-process token bucket 30/min (global, not per tenant), key re-validate (60s single-entry cache), `tenantStorage.run`. Own Prisma client pool of 2 |
| File storage | Cloudflare R2 via S3 SDK (`R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL`), key built per tenant; local disk fallback `/uploads` (60-day cron purge). Spreadsheet import via multer in memory (csv/xlsx/xls, 10 MB). Digital product files referenced by URL (`digitalFileUrl`) |
| Sentry | `SENTRY_DSN` (optional) |
| Redis | Bull queues, tenant rate limit, response cache |
| Logging | Winston (`utils/logger`) |
| Other | json2csv, csv-parse, nodemailer, Resend SDK, SendGrid |
### MCP tools (14)
| Tool | Type | Purpose |
|---|---|---|
| `orders_search` | read | Filter by status, dates, customer, agent, keyword; paginated (default 25, max 100) |
| `orders_summary` | read | Count by status, revenue, fulfilment rate |
| `orders_update_status` | **write** | `orderService.updateOrderStatus`; idempotent; optional backdated `deliveryDate` (YYYY-MM-DD) for 3PL reconciliation |
| `analytics_daily`, `analytics_weekly`, `analytics_monthly` | read | Summaries with comparison/growth (own queries, GUESS: may not match analyticsService) |
| `agents_status`, `agents_performance` | read | Delivery agent workload / performance |
| `deliveries_active` | read | Active deliveries by agent/status/city |
| `customers_lookup` | read | By phone or name with order summary |
| `products_inventory` | read | Stock, low-stock filter |
| `financial_summary` | read | Revenue, collections, pending, agent balances |
| `reps_status`, `reps_performance` | read | Rep workload / performance |
Resource: `resources/schema.ts` (stale field names, GUESS). No MCP user identity (no actor for audit).

## 5. Prisma models (44) and enums (18)
Soft delete (extension): `isActive=false` for User, Customer, Product, CheckoutForm (+ phantom `Automation`); `deletedAt` for Order. Bypass via `withSoftDeleted`.
Tenant scoped by extension (24): User, Customer, Product, Order, Delivery, Transaction, Expense, Account, JournalEntry, AccountTransaction, Workflow, WorkflowExecution, WebhookConfig, Notification, CheckoutForm, InventoryShipment, InventoryTransfer, AgentBalance, AgentStock, MessageLog, SystemConfig, McpApiKey, EmailTemplate, EmailCampaign.
| Model | Purpose / key fields | tenantId col |
|---|---|---|
| Tenant | Company: slug, currency (GHS), currentPlanId, subscriptionStatus, trialEndsAt, Paystack customer/subscription/auth codes, subscriptionRenewsAt, paymentFailedAt, card last4, freeAccessExpiresAt, rateLimitEnabled/rateLimitConfig, defaultDeliveryFee (unused) | - |
| Plan | name (free/growth/scale/enterprise + legacy starter/pro), maxOrders, maxUsers, priceGHS, priceNGN, paystackPlanCode, features JSON, isActive | no (global) |
| PlatformAnnouncement | title, body, type, isActive, expiresAt | no |
| User | All staff incl. agents/reps: email unique global, role, isActive, isPlatformAdmin, isAvailable, commissionAmount (flat), deliveryRate, totalEarnings, totalCollected, vehicle*, location, preferences JSON, refreshToken, reset token | yes (nullable) |
| Customer | phone unique per (phone, tenant), address/state/area, tags[], totalOrders/totalSpent (Float counters), sms/whatsapp/emailOptOut, unsubscribeToken | yes |
| Product | sku unique global, price, stockQuantity, lowStockThreshold, cogs, productType (physical/digital), digital file fields, batch_quantity | yes |
| product_cost_entries | Per-product cost history (category, amount, supplier, reference) | no |
| InventoryShipment | Inbound purchase: qty, unit/shipping/customs/other cost, totalCost, status, glJournalEntryId | yes |
| Order | status, paymentStatus, subtotal/shipping/discount/total/cod (Float), depositPaid/balanceDue (Int), paymentMethod/Reference, fbp/fbc, capiEventFired, source, externalOrderId, webhookFingerprint unique, commissionPaid, payoutId, revenueRecognized, glJournalEntryId, deliveryDate, deletedAt; unique (tenantId, paymentReference) | yes |
| OrderItem | qty, unitPrice, totalPrice, itemType, metadata | no |
| OrderHistory | Status audit rows (status, notes, changedBy) | no |
| Delivery | 1:1 order: agent, scheduledTime, actualDeliveryTime, proofType/Data/ImageUrl, attempts, route JSON | yes |
| Transaction | 1:1 order payment record (type e.g. cod_collection, amount, status PaymentStatus) | yes |
| Expense | category, amount (Float), receiptUrl, expenseDate, recordedBy | yes |
| Account | Chart of accounts tree: code unique global, accountType, normalBalance, isSystem, currentBalance Decimal | yes |
| JournalEntry | entryNumber unique global, sourceType/sourceId, void + reversal links | yes |
| AccountTransaction | Journal line: debit/credit Decimal, runningBalance | yes (required) |
| Workflow | triggerType, triggerData, actions JSON, conditions JSON, isActive | yes |
| WorkflowExecution | status, input, output, error | yes |
| WebhookConfig | Inbound import endpoint config | yes |
| WebhookLog | Inbound call log | no |
| WebhookEvent | Paystack replay guard; unique (tenant, provider, eventType, reference) | yes (not in scoped set) |
| Notification | In-app notifications | yes |
| SystemConfig | One row per tenant: business info, provider JSONs, rolePermissions, operatingHours, notificationTemplates | yes unique |
| CheckoutForm | slug unique global, product, fields/styling/design JSON, regions, currency, pixelConfig, redirectUrl, allowedOrigins[], codEnabled, paystackDepositEnabled/FullEnabled, depositPercent, CAPI token/test code | yes |
| FormPackage | Offer tiers: price, quantity, discount, popular/default, highlight | no |
| FormUpsell | Upsell product/price/items | no |
| FormSubmission | Raw form data + selected package/upsells per order | no |
| PendingCheckout | Paystack snapshot before order exists: reference unique, tenantId, totals, items, formData, fbp/fbc | tenantId col, no FK |
| Call | Rep call log: outcome enum, duration, notes | no |
| Payout | Rep commission payout: amount, method, status | no |
| AuditLog | userId, action, resource, resourceId, metadata, ip, ua | no |
| AgentCollection | 1:1 order: amount (net), allocatedAmount, status chain, verifier/approver | no |
| AgentDeposit | Agent cash deposit: amount, method, referenceNumber unique, receipt, status | no |
| AgentBalance | 1:1 agent: collected/deposited/current, block fields | yes |
| AgentAgingBucket | Cached buckets per agent | no |
| AgentStock | Agent stock per product + running totals; unique (agent, product) | yes |
| InventoryTransfer | Stock ledger: type, from/to agent, order, createdBy | yes |
| DownloadToken | Digital download token: expiresAt, downloadCount, maxDownloads, isRevoked | no |
| MessageLog | All SMS/WhatsApp/email: channel, direction, status, providerMessageId unique, campaignId | yes |
| SmsTemplate | name unique global, body | no |
| EmailTemplate | name+tenant unique, subject, body | yes |
| EmailCampaign | title, subject, body, status, audience counts | yes |
| McpApiKey | keyHash unique, prefix, label, expiry, revokedAt, lastUsedAt | yes |

### Enums (18)
- ShipmentStatus: pending, arrived
- UserRole: super_admin, admin, manager, sales_rep, inventory_manager, delivery_agent, accountant
- OrderStatus: pending_confirmation, payment_pending, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, digital_delivered, cancelled, returned, failed_delivery, payment_failed
- PaymentStatus: pending, paid, collected, deposited, reconciled
- DeliveryProofType: signature, photo, otp
- WorkflowTriggerType: order_created, status_change, payment_received, time_based, manual, webhook
- WorkflowActionType: send_sms, send_email, update_order, assign_agent, add_tag, wait, http_request (runtime also uses send_whatsapp, assign_user stored in JSON)
- CallOutcome: confirmed, rescheduled, no_answer, cancelled, other
- AccountType: asset, liability, equity, revenue, expense
- NormalBalance: debit, credit
- CollectionStatus: draft, verified, approved, deposited, reconciled
- DepositStatus: pending, verified, rejected
- JournalSourceType: order_delivery, failed_delivery, agent_deposit, expense, payout, manual, reversal, order_return, agent_collection, inventory_purchase, period_close, digital_sale
- MessageChannel: whatsapp, sms, email
- MessageDirection: outbound, inbound
- MessageStatus: pending, sent, delivered, read, failed, skipped
- TransferType: allocation, order_fulfillment, agent_transfer, return_to_warehouse, adjustment
- EmailCampaignStatus: queued, sending, completed

Money types: Float for Order/OrderItem/Product.price/Expense/Payout/FormPackage/Customer totals; Decimal(19,4) for GL, AgentCollection/Deposit/Balance/Bucket, InventoryShipment, User.totalCollected, Product.cogs, Plan prices. 92 migration folders, three are empty placeholders (audit section 0).

## 6. Configurable behaviour
### 6.1 Per-tenant `SystemConfig` keys
`businessName, businessEmail, businessPhone, businessAddress, taxId, currency, operatingHours (JSON), smsProvider (authToken*, senderId, isEnabled), emailProvider (provider, apiKey*, fromEmail, fromName, smtpHost/Port/Secure), whatsappProvider (accessToken*, appSecret*, webhookVerifyToken*, phoneNumberId, businessAccountId, isEnabled, OAuth expiry), paystackProvider (publicKey, secretKey*, mode, isEnabled), notificationTemplates (JSON, GUESS: unused), rolePermissions (JSON, role -> resource -> actions)`. `*` = encrypted at rest (`enc:v1:` AES, key `PROVIDER_ENCRYPTION_KEY`) and masked on read. Unset `rolePermissions` -> defaults merged per role.
### 6.2 Per-tenant other settings
`Tenant.currency` (default GHS), `rateLimitEnabled` + `rateLimitConfig {requestsPer15Min default 5000, burstPerSec 50}` (burst unused, GUESS), `defaultDeliveryFee` (unused), `region`, `logo`. Per-user: `commissionAmount`, `isAvailable`, `preferences`. Per-form: payment toggles, deposit percent, regions, allowed origins, pixel/CAPI, redirect URL, design palette (12 swatches, button shape/size/label). Per-product: lowStockThreshold, cogs, digital expiry hours (default 72) and max downloads (default 5). Per-webhook: field mapping, signature requirement. Per-customer: sms/whatsapp/email opt-out.
### 6.3 Plans and billing (seeded by migration `20260611173500`)
| Plan | maxOrders | maxUsers | priceNGN | Notes |
|---|---|---|---|---|
| free | null | null | null | Scale-level, never billed; `freeAccessExpiresAt` optional; granted by platform admin |
| growth | 5000 | 10 | 10,000 | self-serve |
| scale | null | null | 20,000 | self-serve |
| enterprise | null | null | null | contact sales |
| starter/pro | | | | legacy GHS, deactivated |
`paystackPlanCode` is NULL in seed (GUESS: set manually in prod). Status values: active, trialing, pending, past_due, cancelled, suspended. **No enforcement of status or limits anywhere**; no trial logic (`trialEndsAt` unused, per memory "no trial"). `priceGHS` is 0 for all current plans.
### 6.4 Env vars that change behaviour
Required at boot: `DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, WEBHOOK_SECRET` (each >= 32 chars; WEBHOOK_SECRET used for webhook crypto/HMAC), `REDIS_HOST, REDIS_PORT`. Optional: `REDIS_PASSWORD, PORT (3000), NODE_ENV (dev relaxes limiters; test stubs queues), FRONTEND_URL, LEGACY_FRONTEND_URL, PLATFORM_URL, BACKEND_URL, BASE_URL (CORS, links, OAuth redirect, callbacks), REQUEST_TIMEOUT_MS (default 30000 applied), SENTRY_DSN, PROVIDER_ENCRYPTION_KEY, MESSAGE_LOG_RETENTION_DAYS (90), PENDING_CHECKOUT_RETENTION_HOURS (24), META_APP_ID, META_APP_SECRET (enable OAuth + refresh cron), WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_BUSINESS_ACCOUNT_ID / WHATSAPP_APP_SECRET / WHATSAPP_WEBHOOK_VERIFY_TOKEN (global fallback), PLATFORM_PAYSTACK_SECRET_KEY, PLATFORM_EMAIL_PROVIDER / _FROM / _FROM_NAME / _API_KEY / _SMTP_HOST / _SMTP_PORT / _SMTP_SECURE, SENDGRID_API_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, EMAIL_FROM, EMAIL_FROM_NAME, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL, COD_ADMIN_API_KEY (stdio MCP)`. Test/script only: `LOAD_TEST_*, CONCURRENT_AGENTS, TOTAL_ORDERS, ALLOW_DB_CLEANUP`.
### 6.5 Code constants
`SYSTEM_USER_ID = 1` (used by reconciliation job as actor; **NOTE** assumes user 1 exists and is not tenant-specific). `TRANSACTION_CONFIG` timeout 60s / maxWait 15s. `BULK_ORDER_CONFIG` (export max 500, import batch 50, file 10 MB, dedupe window 24h, phone 10-20 chars, address 5-500). Rate limits: auth 40/15min, registration 5/15min, api 500/15min, webhook 100/15min, whatsapp webhook 1000/15min, health 30/min, public order track 30/15min. JWT: access 15m, refresh 7d. bcrypt cost 10, password max 72 chars. MCP: 30 calls/min, auth cache 60s, page default 25/max 100. Permissions cache 60s. Public order dedupe 30 min. WhatsApp token refresh buffer 7 days.

## 7. Auth, roles, tenancy
### 7.1 Roles and permission model
- 7 roles (enum in 5). Role weights (`adminService/authUtils`): sa 100, ad 80, mg 60, im 40, sr 20, da 10, ac 10; `canManageRole` = strictly greater weight (sa always).
- Three checks coexist: (a) hard-coded `requireRole/requirePermission(roles)`; (b) `requireResourcePermission(resource, action)` reading `SystemConfig.rolePermissions` merged over defaults; (c) row-level ownership in services (`checkResourceOwnership`, sa/ad/mg bypass; sr = assigned rep, da = assigned agent).
- Resources/actions: users, orders (+bulk_import, assign), customers, products (+update_stock), financial, analytics, workflows (+execute), settings, calls, gl; actions create/view/update/delete.
- Default matrix:
| Role | Grants |
|---|---|
| super_admin | everything (middleware bypass) |
| admin | all CRUD except financial update/delete and settings update, products update_stock; settings: view |
| manager | orders view/update/bulk_import/assign; customers CRUD; products view; financial view; analytics view; workflows view/execute; calls view; gl view |
| sales_rep | orders create/view/update; customers CRUD; products view; analytics view; calls create/view |
| inventory_manager | orders view; customers view; products CRUD + update_stock; analytics view |
| delivery_agent | orders view/update; customers view; products view; financial create; analytics view; calls view |
| accountant | orders/customers/products view; financial view/create; analytics view; gl create/view/update |
- Matrix editable per tenant by sa (`PUT /api/admin/permissions`); frontend mirrors with `usePermissions`.
- Audit: `AuditLog` written by adminService for user/config/permission changes only.
### 7.2 Tokens and sessions
JWT payload `{id:number, email, role, tenantId|null}`. Access 15m, refresh 7d (separate secrets, refresh token persisted on User, rotated on `/refresh`). `isPlatformAdmin` is NOT in the JWT; `requirePlatformAdmin` reads it from DB each request and then runs with `tenantId = null` (cross-tenant). Socket auth reuses the access token. Password: min 8 with upper/lower/digit/special (register validation), reset by emailed token.
### 7.3 Tenant model
Shared DB, `tenant_id` column. `authenticate` puts `decoded.tenantId` in AsyncLocalStorage; Prisma extension injects `tenantId` into where/data for the 24 scoped models; no context = no filter (**fail-open**). Public, queue, cron and webhook paths set context manually (`tenantStorage.run`) or not at all. Un-scoped models with no tenant column listed in section 5 (AgentCollection, AgentDeposit, AgentAgingBucket, Payout, Call, OrderHistory, OrderItem, AuditLog, WebhookLog, SmsTemplate, FormSubmission, DownloadToken, product_cost_entries, Plan) rely on parent scoping or are leaked cross-tenant (**NOTE**). Global uniques: User.email, Product.sku, Account.code, JournalEntry.entryNumber, CheckoutForm.slug, SmsTemplate.name, MessageLog.providerMessageId. Tenant creation: `register-tenant` (public, status `pending`, no chart of accounts or email templates seeded), platform `POST /tenants` (status `active`), or legacy auto-create in onboarding.
### 7.4 Platform admin
`User.isPlatformAdmin` flag, `tenantId` null; created by `npm run create-platform-admin`. Capabilities: tenant CRUD, suspend/reactivate (status flag only, not enforced), grant free plan, delete tenant (confirm slug), MRR/growth metrics, billing events, announcements, system health. Same API process and same SPA (platform domain switch in frontend).
### 7.5 Known access gaps (NOTE)
1. Public `POST /api/auth/register` -> tenantless privileged-role user with unfiltered data access (GUESS: severity high; verify with a test).
2. Suspended/pending/past_due tenants keep full access.
3. Delivery routes `GET /deliveries`, `/:id`, `/routes/:agentId`, `PATCH proof|complete` have no role check.
4. `GET /api/admin/config` is unauthenticated and tenant-less (returns first config row's businessName/currency, GUESS cross-tenant leak when multiple tenants).
5. Socket rooms are not tenant-isolated.
6. `/metrics`, `/health/detailed` are public.

## 8. Other backend pieces to carry over
- Middleware: `requestTimeout(30s)`, helmet (frameguard removed on `/api/public`), compression, CORS (env origins; public API `*`), raw-body capture for 3 webhook paths, `errorHandler`/`notFound`, express-validator + zod, `express-async-errors`.
- Utilities with logic: `customerLookup` (phone matching), `packageParser`, `bulkOrderValidators`, `sanitizer` (HTML), `glUtils`, `corsOrigins`, `url`, `crypto` (webhook HMAC), `providerCrypto` (AES secrets), `socketInstance`, `tenantContext`, `checkoutPalette` (12-color palette).
- Scripts (`backend/scripts` 43 files, `src/scripts`): bootstrap-admin, create-platform-admin, seed, GL/payout/expense/deposit backfills, consistency checks, dedupe bulk orders. `docker-entrypoint.sh` runs migrations (GUESS).
- Tests: Jest, ~91 files; coverage excludes sockets, queues, scripts.

## 9. Counts
Endpoints 275 | Route groups 30 route files | Controllers 32 | Services 37 | Models 44 | Enums 18 | Bull queues 6 (7 job types) | node-cron 3 | Timers 1 | socket event types 21 | MCP tools 14 | Roles 7 | Permission resources 10.
