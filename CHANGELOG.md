# Changelog

All notable changes to the E-Commerce COD Admin Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **[Finance]**: Delivery fee rules per partner and outcome, one fee posted per outcome to 5070 against cash in transit 1015, deposits move 1015 to 1010 once with first-in first-out matching stored for exact rejects, excess to 2040, and the old deposit route on the same path. (COD-48)
- **[Finance]**: Rep commission entries post DR 5050 / CR 2020 once when earned and reverse on return, with a backfill for open delivered orders; one payout service and API for reps and agents that pays open entries oldest first, rejects above owed and double payment, and adds the payouts permission. (COD-51)
- **[Finance]**: Expenses post to the ledger by expense date with receipts and F-918 categories; manual journal and void rules (system entries cannot be voided by hand); ledger in entry-date order with a true running balance and exports; new Expenses, Chart of accounts, Ledger and Journal screens that show why a button is disabled. (COD-52)
- **[Finance]**: Fees tab for delivery fee rules in the partner drawer; one payout form for reps and delivery agents with owed check and part payments; Rep commissions tab. (COD-53, COD-54)
- **[Finance]**: Partner payouts recorded once (API and MCP tool), matched to orders and posted to the ledger; Findings with assign, explain and owner write-off; manual payout to the oldest unpaid orders with a preview; partner CSV status import. (COD-49)
- **[Finance]**: Collections are verified in one step with a reason to reject and a cash-held guard; live aging per partner in 0–3, 4–7, 8–14 and 15+ days; overdue uses each partner's days to pay (7 by default) everywhere. (COD-50)
- **[Finance]**: Finance reports read the ledger: monthly P&L, income statement and balance sheet; cash flow without the 1020 double count; profit by product, order cohort and cost of failed deliveries. (COD-52)
- **[Finance]**: Record payout from the partner drawer with a preview of the orders it clears, an unapplied-amount warning and a duplicate-reference check; disabled with a reason for users without the payouts permission. (COD-53)
- **[Finance]**: M5 settlement schema (partner settlements and lines, commission entries, Finding assignee and resolution, per-outcome delivery fee on orders, fee rules by valid-from), chart of accounts 2040, 2050, 3010, 5070, 5080 with 1010 relabelled and 1020, 5040 retired, and one payout record for reps and agents (`payee_id`, kind, reference, recorder) with a before-and-after copy check. (COD-47)
- **[Products]**: Products page with tiles, month picker, stock over all holders with days of cover and delivery success against the target, read-only stock by holder, product drawer with type and cost locks, Incoming shipments tab with the receive window (short units, landed cost) and supplier claims; old agent stock screens removed. (COD-43)
- **[Inventory]**: Inventory page with location cards, stock table against the latest count ("Count is old" after any on-hand change), move windows showing reserved units with a warning, adjust, stock counts with Apply count, receive and dispute dialogs, own store, keeper home and transfer history with CSV export. (COD-44)
- **[Deliveries]**: Deliveries page replaces Delivery Agents: one list for agents and 3PLs with totals and delivery success against the target, reasons card with the returned-units-missing line, waiting and out-for-delivery lists, partner drawer (Summary, Orders with proof photos, Stock, Fees), add partner and availability switch; batched order proofs and a cross-origin proof photo. (COD-45)
- **[Deliveries]**: Delivery partners API `/api/delivery-partners` (list with total row, summary, waiting, failure reasons, region review, create, profile edit with audit, availability switch), region normalisation of new orders, delivery proof by order with a signed photo URL, a delivery attempt row on each failed or rescheduled move, failure reason backfill script, and dead delivery methods removed. (COD-42)
- **[Stock]**: Stock counts with apply (one adjustment, a Finding per gap), inventory read APIs (overview, levels, holders, returns summary; reps and agents 403; value only for cost roles), Products API (tabs, month, days of cover, delivery success, summary tiles, create with opening stock, archive and restore with open orders and units), nullable `maxDownloads`, revenue-weighted margin, and the nightly stock-vs-levels check. (COD-41)
- **[Stock]**: Shipments API `/api/shipments` (list, 3 tiles, create, edit and delete while pending, one currency per shipment with a stored or typed rate), receive with a counted quantity (receipt movement, landed cost = total ÷ counted, weighted-average product cost, one ledger entry DR 1200 / CR 1010, supplier claim and Finding for short units, a 3PL count row), claim settle (DR 1010 / CR 1200, once) or write-off, old `arrived` rows mapped to `received`, and the landed cost stored on delivered orders and used by the COGS legs. (COD-40)
- **[Stock]**: `stockService` as the only writer of stock quantities, stock leaves once at delivered and comes back once on leaving it (upsell lines included, no move at creation, dispatch or cancel, short holder opens a Finding), transfers through "in transit" with receive, dispute, resolve and cancel, `/api/inventory/transfers` and `/api/inventory/adjust`, old agent-inventory write routes and `PATCH /api/products/:id/stock` removed, admin gets `products:update_stock`. (COD-39)
- **[Stock]**: Stock per location schema (locations, levels, counts, partner profiles, delivery attempts, shipment claim and landed-cost columns), `Product.cogs` at 4 decimals, per-tenant `migrate-stock-to-levels.ts` with a dry run that fails on any change in the sum per product (old warehouse stock to Logiswift, agent stock to agent locations, dispatch and checkout corrections, old transfers mapped), and the M4 stock fixture. (COD-38)
- **[Payments]**: Provider interface with a Paystack adapter and a fake provider, tenant `PaymentConnection` with encrypted, masked keys and `/api/payment-connections`, form payment rules by the F-402 matrix behind `features.prepaidPhysical`, neutral method names (`online_full`, `online_deposit`), and `Tenant.defaultDeliveryFee` dropped. (COD-31)
- **[Payments]**: Neutral payment webhook `/api/payments/webhook/:provider/:tenantSlug` (old Paystack URL kept), checkout statuses with a 10-minute sweep, a payment-settled hook with a ledger poster, `POST /api/financial/paystack-payouts` (DR 1010, CR 1030) and Findings for unmatched payments, failed ledger posts and unsettled Paystack money. (COD-32)
- **[Checkout]**: Checkout forms API: archive instead of delete, restore, clone without the CAPI token, https thank-you page, host-only allowed domains, read-only country, type follows the product, required keys on activation, public regions route, pixel id checks and a CAPI test event; public checkout: sold out, region from the list, out-of-stock add-ons hidden, duplicate guard on the server total that returns the order only to its submitter, and `orderNumber` in the reply. (COD-33)
- **[Checkout]**: Checkout forms list on the new design with orders this month, archive and restore, server clone, copy link from the public host and a manager-up role rule; form editor with read-only country and type, https thank-you page and allowed domains in Basics, City or town and Order notes in Fields, up and down buttons, the required-key guard in the editor, and the store's regions. (COD-34)
- **[Checkout]**: Form editor tabs Packages (table with live final price), Upsells (on/off, popular, hint from 30 orders), Payment (methods by the store setting, currency warning, test-mode line) and Tracking (pixel checks, write-only Conversions API token, test event); Design adds label and price colours, page background, a banner and a contrast warning; preview at 390 and 1024 px that places no order and fires no pixels, behind the manager-up rule, and a preview window from the list. (COD-35)
- **[Checkout]**: Public checkout restyle with store currency symbol (GH₵), "Placing your order.", inline sold-out and errors, terms in the page and the field label "State" (old "Region" labels migrated); "Order placed" screen with order number, what happens next and support WhatsApp; "This form is not available."; payment callback with confirming, pending (5 s polling up to 5 min), success, failed and not found states, and a verify answer with no customer data. (COD-36)
- **[Checkout]**: Compact package rows with the "Most popular" tag on the row border and the saving under the price, compact add-on rows, 48 px inputs, and a two-column desktop checkout with a sticky order summary; the embed stays one column. (COD-150)
- **[Checkout]**: M3b test sweep: pixel and CAPI regression with event id parity, two-tenant integration checks for payment connections and new routes, Playwright for the editor, public COD, digital online payment and form roles; manager sees the form editor read-only; forms list and editor fit at 1280 and 760 px and the editor follows dark mode. (COD-37)
- **[Finance]**: Nightly ledger check with one `ledger_gap` finding per day, `GET /api/financial/health`, daily FX rates (ExchangeRate-API) with `/api/fx` and a Currencies & FX settings tab, store currency on the tenant with `orders.currency`, and return GL entries dated by `returnedAt`. (COD-14)
- **[Analytics]**: Wording guard tests with one allow-list, and a KPI contract test that checks GH₵92,000.00 on every endpoint and MCP tool. (COD-15)
- **[KPI]**: Every analytics, financial and order-stats endpoint and every MCP tool reads revenue and rates from the KPI layer (fixture-proven GH₵92,000.00 / 376 delivered); financial summary adds digital revenue and Paystack fees; `profit-margins` and dead analytics routes removed; date ranges are store-zone days end to end. (COD-13)
- **[KPI]**: Rep, leadership, product and partner KPIs — per-rep confirmation and delivered-from-confirmed rates, `/api/reports/team` (admin/manager), `/api/kpi/leadership` (pace, projection, needed a day, lever), delivered units, partner rates and timings, time to first call with operating hours, one role-scope rule on every KPI route, and numbers fixture part 2 with per-area checks. (COD-12)
- **[KPI]**: KPI layer — `KpiResult` and store-zone dates, delivered revenue (return leaves in its return month), confirmation rate, delivery success rate (cohort or delivery basis) and order-to-cash yield on closed cohorts, `GET /api/kpi/revenue` and `/api/kpi/rates`, a grep guard that keeps KPI maths in one place, and the `seed:fixture` numbers fixture (GH₵92,000.00, 71%, 48%). (COD-11)
- **[Orders]**: Order state machine — one `transitionOrder` path for every status writer, with the F-301 table, role and owner gates, an optimistic lock, force with reason and audit, integration jumps for 3PL feeds, one place for side effects (revenue with linked reversal, FeeRule failed fee per attempt, queued sync), `GET /api/orders/:id/transitions`, and the `orders:update_status` permission. Dead customer code removed. (COD-10)
- **[KPI]**: Order lifecycle fields (confirmed, dispatched, first contact, returned, status version trigger, decline and failure reasons), tenant-scoped Target, Finding, FeeRule and FxRate models, E.164 phone normalization with old-format and partial lookups, `/api/reference/regions`, one currency list and one status label map, and dry-by-default backfill scripts. Fixes the customers list `sortBy` 500. (COD-9)
- **[Tenancy]**: Fail-closed tenant scope — required `tenant_id` on 12 more tables (and `notifications`, `workflow_executions`), per-tenant uniques for account code, journal entry number, SKU and SMS template name, and a Prisma extension that throws `TenantContextMissing` when a scoped model is queried with no tenant. Jobs, crons, public routes, webhooks and socket rooms now set the tenant first; `seedTenantDefaults` seeds each new tenant. One shared token refresh for axios and socket. (COD-4)
- **[Money]**: `Money` helper on `Prisma.Decimal` (2-decimal API strings) and migration of 31 money columns to `Decimal(19,4)`, with `verify-money-migration.ts` (zero-difference proof) and a tested rollback script. (COD-5)
- **[CI]**: Migration parity check — the backend test job fails when `schema.prisma` differs from the migrated database; the lint job runs `scripts/tests/deploy-guard.sh`. (COD-2)
- **[Email]**: Bulk email campaigns UI — Communications gains an **Email** channel (indigo button, non-color selected state for a11y, D-M1) and its own top-level **Campaigns** tab. `EmailComposer` ships a textarea + cursor-aware merge-tag toolbar (tags work in Subject too), three prebuilt HTML templates, and an XSS-safe sandboxed `<iframe>` preview that fills the 4 bulk-safe merge tags with sample values (D-H3). A provider-not-configured `EmptyState` links to Settings → Email instead of a composer that silently fails (D-H2). A pre-send **eligibility banner** ("X of Y customers can be emailed — Z no address, W opted out", D-CRIT) reads from a new `GET /api/communications/email-audience` endpoint (controller + `audienceDenominators` service helper). Send is queued: confirm → toast "Campaign queued — track it in Campaigns" → switches to the Campaigns tab, where `CampaignHistoryTab` polls every 4s while any campaign is queued/sending (D-H1) and renders no-address/opted-out as neutral **skips**, never red **Failed** (D-CRIT). Components extracted under `frontend/src/components/communications/` rather than growing `BulkSendTab`. (MAN-84)
- **[Email]**: Queued bulk email campaigns + campaign history — new tenant-scoped `EmailCampaign` model (`EmailCampaignStatus` queued/sending/completed) plus `MessageLog.campaignId` with a partial-unique `(campaign_id, customer_id)` index that enforces one send row per recipient without constraining workflow/transactional logs. `POST /api/communications/bulk-email` snapshots the eligibility denominators (audience / no-email / opted-out), creates the campaign, and **cursor-paginates** the eligible audience into a new BullMQ `emailCampaignQueue` (one job per recipient — no silent 1k cap), sending via the tenant's **BYO** provider with the RFC 8058 unsubscribe footer/headers. Each job is tenant-threaded (`tenantStorage`) and idempotent (a prior `sent` log short-circuits a retry; opt-out / no-email / `@codadminpro.com` placeholder recipients are logged `skipped`, never sent); the campaign auto-flips to `completed` when no recipient is still pending. `GET /communications/campaigns` and `/campaigns/:id` aggregate the live eligibility breakdown (audience → emailable → waiting/sent/delivered/failed/skipped) from `MessageLog`. `getRecipients` gains an `email` channel (real, non-opted-out, non-placeholder addresses). Manual send only — saving never sends. Backend only; the Communications Email-channel UI is MAN-84. (MAN-83)
- **[Email]**: Email capture as a first-class asset — email is now a standard default checkout field (present on every form that hasn't customized its fields, via `CheckoutForm` `DEFAULT_FIELDS` + the `CheckoutFormBuilder` seed), **present but not required** on physical COD (phone-first market) while the existing `isDigital` path still force-requires it for digital products. Manual orders now grow the list too: `orderService.createOrder` updates a returning customer's email (and alt phone) instead of only alt phone, mirroring the public checkout path. Bulk import already persists `customerEmail`, and the synthesized `<phone>@codadminpro.com` Paystack placeholder stays local to the init call and is never persisted onto `Customer.email` — both now locked in with tests so a fake, bouncing address never enters the marketing pool. (MAN-82)
- **[Email]**: Email unsubscribe (RFC 8058 one-click) — marketing-class workflow emails now carry an `Unsubscribe` link plus `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers. Opt-out is **POST-only** (`POST /api/public/unsubscribe/:token` flips `Customer.emailOptOut`); the GET route renders a confirm page and never mutates, so mail-scanner/prefetch GETs can't silently unsubscribe people. Tokens are stored 32-byte random hex (`ensureUnsubscribeToken`), looked up unscoped (globally unique). A shared `applyUnsubscribe` helper appends a footer fallback when the merchant template omits `{{unsubscribe_url}}` and wires the headers — reused by Phase 2 bulk. New `{{unsubscribe_url}}` merge tag + a shared `getBackendUrl` util (de-dupes `digitalDeliveryService`). (MAN-81)
- **[Email]**: `send_email` workflow action now sends — replaced the BullMQ worker stub with one shared `sendWorkflowEmail` helper that both the live worker and the legacy synchronous `workflowService` path delegate to (one path, one config shape). Resolves a saved `EmailTemplate` by `templateId` or inline subject/body (`config.body`, with `config.message` back-compat), renders the 6 merge tags, and sends via the platform transactional provider. Writes `MessageLog(channel=email)` pending → sent/failed; skips + logs opted-out customers (`MessageStatus.skipped`) and missing recipients; idempotent — a prior sent log for `(orderId, templateName)` short-circuits a BullMQ retry, and provider failure logs `failed` without rethrowing. Fixed the editor↔executor field mismatch (inline Email Body now binds to `config.body`). (MAN-79)
- **[Email]**: Reusable email templates — tenant-scoped `EmailTemplate` model (unique per name) with CRUD endpoints, an HTML-sanitizing save path (`sanitize-html` allowlist), and a 6-tag merge renderer (`customer_name`/`customer_email`/`store_name`/`order_number`/`order_total`/`download_url`) that HTML-escapes every value at substitution. Three default templates seeded per tenant (Order Confirmation / Digital Delivery / Status Update) via an idempotent backfill. The workflow `send_email` action gains a template dropdown (mirrors the WhatsApp picker) with an inline subject/body fallback. (MAN-78)
- **[Email]**: Email channel prerequisites — `MessageChannel.email` + `MessageStatus.skipped`, `Customer.emailOptOut` + unique `unsubscribeToken` (additive migration); tenant-keyed email config cache; fail-closed tenant guard on workflow send actions + `tenantId` on the `order_created` enqueue; platform transactional sender (`sendEmail({ as: 'platform' })` via `PLATFORM_EMAIL_*`); `digitalDeliveryService.hasBeenDelivered()` idempotency helper. No send paths active yet. (MAN-77)
- **[Payments]**: Multi-button checkout — per-form payment matrix (`codEnabled` / `paystackDepositEnabled` / `paystackFullEnabled`, max two enabled) renders one CTA per method on the public form. Deposit orders charge a configurable percentage via per-tenant Paystack and persist the remainder on `Order.balanceDue`; settlement (webhook only) lands in `PaymentStatus.deposited` (deposit) or `paid` (full), validated against the Paystack-reported amount and idempotent on repeat delivery. Form-save is blocked with a Settings → Integrations link when a Paystack method is enabled but the tenant has no keys. (MAN-58)
- **[Payments]**: Meta Conversions API purchase events — server-side `Purchase` events with SHA-256-hashed PII and `event_id = paymentReference || orderId` for client/server dedup, fired on COD create and Paystack settlement, exactly-once via `Order.capiEventFired`, best-effort. Access token encrypted at rest, write-only-masked in admin reads, stripped from the public form config. Custom thank-you redirect (`redirectUrl`) now also carries `reference` + `package`. (MAN-59)
- **[Checkout Forms]**: Embeddable checkout widget — `frontend/embed/` package renders the checkout on any external page. Mode A auto-renders into `<div data-codadmin-checkout data-slug>` inside a Shadow DOM (Preact via `preact/compat`); Mode B attaches order submission to a host's own `<form data-codadmin-checkout-form>`. New `GET /api/public/forms/:slug/config` endpoint serves the public form shape plus the tenant's Paystack public key. (MAN-57)
- **[Checkout Forms]**: Per-form embed Origin allowlist — new `allowedOrigins` field gates the `/config` endpoint at route level (403 for off-list origins); per-package "Copy direct buy link" and "Copy embed snippet" actions on the Packages tab. (MAN-57)
- **[Checkout Forms]**: Package-lock deep links — `?package=N&lock=1` (or `data-package data-lock`) render a single-package checkout with the selector hidden; mismatched `package_id` rejected server-side. (MAN-57)
- **[Checkout Forms]**: Single-column checkout layout on all breakpoints and a per-form "Show order summary" toggle (`design.page.showOrderSummary`, default on). (MAN-57)
- **[Checkout Forms]**: Salesgee-style builder rewrite — full-page editor at `/checkout-forms/:id/edit` with 5 tabs (Basics / Packages / Upsells / Settings / Design) and a live-preview iframe pane synced to the editor draft over `postMessage` (debounced 150ms). New Design tab uses a 12-swatch brand palette for primary/CTA/surface/text/background, plus button shape/size, input style, banner URL, label override (60 char), and offer position. Backed by an additive `design Json?` column with a backfill that maps existing `styling.buttonColor`/`accentColor` into `design.colors`. New admin-only `/api/checkout-forms/:id/preview-config` endpoint serves drafts to the preview iframe. (MAN-67)
- **[Checkout Forms]**: Copy URL and Copy Embed row actions on the list page + editor top bar, replacing the EmbedCodeModal. Embed snippet uses 100% width + auto-grow height with HTML/JS-escaped slug. Platform-specific embed instructions moved to `docs/embed.md`. (MAN-67)
- **[Checkout Forms]**: Unsaved-changes guard on the editor — React Router `useBlocker` for in-app nav and `beforeunload` for tab close / hard refresh. (MAN-67)
- **[Payments]**: Per-tenant Paystack integration — each tenant configures their own Paystack keys in Settings → Integrations; buyer funds settle directly into the tenant's Paystack account via per-tenant webhook URL `/api/paystack/webhook/:tenantSlug` with tenant-scoped HMAC and dedup (MAN-66)
- **[Payments]**: Paystack webhook idempotency via `WebhookEvent` table — duplicate deliveries deduped at DB layer with unique `(provider, event_type, reference)` constraint (MAN-55)
- **[Communications]**: Full communications dashboard with message history, delivery stats, bulk messaging, template manager, and opt-out management (MAN-32)
- **[Communications]**: Auto-cleanup queue for MessageLog records with 90-day retention (MAN-32)
- **[Communications]**: Customer opt-out enforcement in WhatsApp and SMS messaging services (MAN-32)
- **[SMS]**: Arkesel SMS integration with auto-fallback when WhatsApp fails (MAN-31)
- **[WhatsApp]**: Product-specific delivery messages with custom links via workflow conditions (MAN-31)
- **[WhatsApp]**: `send_whatsapp` workflow action with template picker and custom link support
- **[Workflows]**: Product name available in status change workflow conditions for per-product routing
- **[WhatsApp]**: Meta OAuth integration — "Connect with Meta" for automatic token exchange and phone selection
- **[WhatsApp]**: Daily token refresh cron with on-demand fallback guard in message dispatch
- **[WhatsApp]**: Phone picker modal with auto-select for single-number WABAs
- **[UI]**: URL-based tab persistence for Settings, Financial, and Integrations pages
- **[Financial]**: Mobile deposit submission with receipt photo upload for agents (MAN-28)
- **[Financial]**: Per-agent Deposits tab in collection modal with verify/reject actions (MAN-28)
- **[Financial]**: Collection modal pagination for high-volume agents (MAN-28)
- **[Financial]**: Agent inventory history tracking on mobile (MAN-28)
- **[Inventory]**: Mobile inventory view with per-product allocation history drill-down (MAN-27)
- **[Platform]**: Super-admin dashboard with tenant metrics, MRR, active users, and growth trends (MAN-46)
- **[Platform]**: Tenant management: list, detail, create, suspend, reactivate, delete with full cascade (MAN-46)
- **[Platform]**: Global announcements system with banner display for all authenticated users (MAN-46)
- **[Platform]**: System health endpoint showing database and Redis status (MAN-46)
- **[Platform]**: Dedicated platform admin login at `/platform/login` with `isPlatformAdmin` flag (MAN-46)
- **[Performance]**: Per-tenant rate limiting via Redis sliding window, configurable per tenant (MAN-47)
- **[Performance]**: Request timeout middleware with 30s default (MAN-47)
- **[Performance]**: Tenant-aware Redis cache key partitioning (MAN-47)
- **[Onboarding]**: Business details collection (email, phone, address, tax ID) during setup wizard (MAN-16)
- **[Settings]**: Delete Account with password confirmation for tenant super admins (MAN-16)
- **[Settings]**: Billing & Plans tab with plan comparison and usage display (MAN-16)
- **[Checkout]**: Duplicate order prevention with 10-minute IP + localStorage cooldown (MAN-16)
- **[Public]**: Pricing page at `/pricing` with Free/Starter/Pro tiers and FAQ (MAN-16)
- **[Docs]**: SaaS onboarding guide for new tenants (MAN-16)
- **[CI/CD]**: Sentry DSN injected into staging and production deployments (MAN-16)

### Fixed
- **[Deliveries]**: Edit person in the partner drawer opened behind the drawer and could not be used; it now opens on top and Escape closes only the form. (M5)
- **[Analytics]**: A `yyyy-MM-dd` end date now includes the whole store day on calls, agent inventory and reconciliation, checkout form submissions, GL journal entries, WhatsApp messages and financial reports. (COD-15)
- **[Security]**: Public `POST /api/auth/register` removed (it made users with no tenant and a body-chosen role); delivery routes check role and ownership; `GET /api/admin/config` needs a tenant or form slug; `/metrics` and `/health/detailed` need `METRICS_TOKEN`; legacy Paystack webhook route removed. (COD-3)
- **[Security]**: Two-tenant test harness and suites for models, HTTP, sockets, MCP, CAPI and public tracking. Public tracking no longer returns the customer phone, public downloads are limited to 30 per 15 minutes per IP, and an expired, revoked or used-up download token returns 410. (COD-7)
- **[Sockets]**: The tenant owner (`super_admin`) now receives order, finance and team events live. (COD-8)
- **[Database]**: `schema.prisma` aligned with the real database, plus 2 additive `agent_collections` indexes; deploy scripts now stop when `prisma migrate deploy` fails; frontend tests run on Node 25+. (COD-2)
- **[Checkout Forms]**: The header/list "Copy embed snippet" button now copies the Mode A inline widget snippet (`data-codadmin-checkout` + `embed.js`), matching the Embed Snippet panel and Packages tab. It previously handed out the legacy iframe embed, so the two surfaces disagreed on what "embed" meant. (MAN-57)
- **[Auth]**: Session expiry on the Admin Dashboard now shows a single deduped "Your session has expired" toast + redirect to `/login`. Previously, expired refresh tokens leaked `jwt malformed` as a 500 and parallel widget requests stacked 10+ misleading "Server connection lost" toasts (MAN-66)
- **[Security]**: Tenant deletion now fully atomic with parameterized SQL, preventing partial corruption
- **[Security]**: Permissions cache keyed per-tenant to prevent cross-tenant permission leakage
- **[Security]**: Route-level `requireSuperAdmin` guard on DELETE /api/auth/delete-account
- **[Security]**: Zod input validation on platform tenant create/update endpoints
- **[Security]**: Tenant rate limiter moved to run after auth (was a no-op when global)
- **[Platform]**: SystemConfig included in tenant delete cascade, preventing FK violations
- **[Financial]**: Bulk deposit verification self-deadlock from raw SQL FOR UPDATE (MAN-28)
- **[Financial]**: Double-click on verify buttons causing duplicate requests (MAN-28)
- **[Financial]**: Deposit verification timeout by extending API timeouts (MAN-28)

### Changed
- **[Money]**: Money maths in orders, finance, analytics, MCP tools and exports uses `Money` (Decimal) instead of `number`. API money is a 2-decimal string; the frontend parses it once in `utils/money.ts`. Deposit and balance are stored in major units. (COD-6)
- **[CI]**: Jest coverage gate set at the current level (lines 62, branches 49, functions 60, statements 62); backend and frontend suites run on every PR; a docs guard fails on stale UI names or retired KPI wording. M0-wide simplify pass and 22 frontend type errors cleared. (COD-8)
- **[Financial]**: Deposit reference format improved to date-based DEP-YYYYMMDD-XXXX (MAN-28)
- **[Financial]**: "Verify Collections" button renamed to "View Details" in Agent Collections (MAN-28)

## [2.0.0-alpha] - Sprint 2–4 (Multi-Tenant SaaS)

### Added
- **[Multi-Tenancy]**: Tenant model with shared-DB row-level isolation on all business tables (MAN-8)
- **[Multi-Tenancy]**: Prisma extension auto-injects tenantId into every query via AsyncLocalStorage (MAN-9)
- **[Multi-Tenancy]**: Explicit tenantId in all 15+ service-layer methods as defence-in-depth (MAN-10)
- **[Multi-Tenancy]**: Integration test suite proving cross-tenant data contamination is impossible (MAN-11)
- **[Onboarding]**: Public tenant registration with company name, admin setup in one transaction (MAN-12)
- **[Onboarding]**: Multi-step onboarding wizard — country, currency, branding configuration (MAN-12)
- **[Billing]**: Plan model with Free/Starter/Pro tiers, order and user limits (MAN-13)
- **[Billing]**: Subscription management page with plan comparison and usage tracking (MAN-13)
- **[Database]**: Foreign key constraints with CASCADE delete on all 19 tenant_id columns
- **[Database]**: tenantId added to MessageLog model for communication isolation
- **[Security]**: OWASP hardening — input sanitization, CSP headers, improved rate limiting (MAN-15)
- **[Observability]**: Sentry integration for error tracking and performance monitoring (MAN-15)
- **[Testing]**: 832 unit tests passing, 40%+ branch coverage target met (MAN-15)
- **[Testing]**: Playwright E2E tests for tenant onboarding and public checkout flows
- **[Testing]**: Load test harness for 100 concurrent agents + 500 orders

### Fixed
- **[Security]**: Cross-tenant data leak via response cache — cache keys now include tenantId
- **[Security]**: Cross-tenant financial data leak in AgentCollection aggregate queries
- **[Security]**: MessageLog queries returned data from all tenants (model had no tenantId)
- **[Security]**: Tenant registration TOCTOU race — uniqueness checks moved inside transaction with P2002 handling
- **[Security]**: Prisma upsert handler missing tenantId on update branch
- **[Security]**: TENANT_SCOPED_MODELS had wrong model names (GLEntry, AgentInventory, Webhook)
- **[Security]**: delete/deleteMany operations not scoped by tenant in Prisma extension
- **[UI]**: Onboarding wizard navigated to non-existent /dashboard route (changed to /)

## [1.0.0] - 2025-10-08

### Added

#### Core Features
- **Order Management System**
  - Kanban board interface with drag-and-drop functionality
  - Order creation, editing, and deletion
  - Order status tracking with history
  - Bulk order operations (status update, assignment, export)
  - Advanced filtering and search capabilities
  - Order notes and comments system

#### Customer Management
- Customer database with full CRUD operations
- Customer profiles with order history
- Customer analytics (lifetime value, order frequency)
- Customer segmentation with tags
- Multiple shipping addresses per customer

#### Product Management
- Product catalog with inventory tracking
- Product variants support (size, color, etc.)
- Stock level monitoring with low stock alerts
- Product analytics (sales, performance metrics)
- Image management for products

#### User Management
- Role-based access control (RBAC)
  - Admin: Full system access
  - Manager: Team and reporting access
  - Agent: Order processing access
- User authentication with JWT
- Team management and assignment
- Activity logging and audit trails

#### Workflow Automation
- Rule-based workflow engine
- Trigger types:
  - Order events (created, updated, status changed)
  - Customer events (created, order count)
  - Product events (low stock, out of stock)
  - Time-based (scheduled)
- Condition matching with operators
- Actions:
  - Status updates
  - User assignment (specific, round-robin, least-loaded)
  - Email notifications
  - SMS notifications (with provider)
  - Webhook calls
  - Tag management
- Workflow logging and monitoring

#### Webhook Integration
- **Shopify Integration**
  - Automatic order import
  - HMAC signature verification
  - Support for order events
  - Real-time synchronization
- **WooCommerce Integration**
  - WordPress/WooCommerce order import
  - Signature verification
  - Event handling
- **Custom Webhooks**
  - Configurable webhook endpoints
  - Custom event definitions
  - Webhook management API
  - Detailed logging

#### Analytics & Reporting
- Dashboard with key metrics
  - Total orders with trends
  - Revenue tracking
  - Customer counts
  - Average order value
- Order analytics
  - Orders by status distribution
  - Order completion rates
  - Processing time metrics
  - Geographic distribution
- Customer analytics
  - New vs. returning customers
  - Customer lifetime value
  - Retention rates
  - Top customers
- Product analytics
  - Top selling products
  - Revenue by product
  - Stock levels overview
  - Category performance
- Exportable reports (PDF, Excel, CSV)
- Scheduled report delivery

#### API
- RESTful API with 78+ endpoints
- Authentication endpoints (login, register, refresh, logout)
- Order endpoints (CRUD, bulk operations, history)
- Customer endpoints (CRUD, orders by customer)
- Product endpoints (CRUD, stock management)
- User endpoints (CRUD, role management)
- Workflow endpoints (CRUD, execution logs)
- Webhook endpoints (configuration, logs)
- Analytics endpoints (overview, orders, customers, products)
- Settings endpoints (system configuration)
- Comprehensive error handling
- Request validation with Zod
- Rate limiting (100 req/15min general, 5 req/15min auth)
- CORS protection
- Pagination support
- Filtering and sorting

#### Security
- JWT-based authentication
- Password hashing with bcrypt (12 rounds)
- Role-based authorization
- Rate limiting per endpoint
- CORS configuration
- Input validation and sanitization
- SQL injection prevention (Prisma ORM)
- XSS protection
- HTTPS enforcement
- Security headers (Helmet)
- Audit logging
- Webhook signature verification (HMAC)

#### Frontend
- Modern React 18.3+ with TypeScript
- Responsive design (mobile, tablet, desktop)
- Dark mode support (system-aware)
- Drag-and-drop Kanban board (@dnd-kit)
- Form management (React Hook Form + Zod)
- Data fetching and caching (React Query)
- Charts and visualizations (Recharts)
- Toast notifications
- Modal dialogs
- Loading states and skeletons
- Optimistic updates
- Error boundaries

#### Developer Experience
- TypeScript throughout
- Prisma ORM for database
- Comprehensive documentation
- API documentation with examples
- Developer guide
- Deployment guide
- Security guide
- Testing setup
- ESLint and Prettier
- Environment variable templates
- Database seeding scripts

### Technical Stack

#### Backend
- Node.js 18+
- Express.js 4+
- TypeScript 5+
- PostgreSQL 15+
- Prisma 5+
- JWT authentication
- bcrypt password hashing
- Zod validation
- Express rate limit
- CORS middleware
- Helmet security

#### Frontend
- React 18.3+
- TypeScript 5+
- Vite 5+
- Tailwind CSS 3.4+
- React Router 6+
- React Query (TanStack Query)
- @dnd-kit for drag-and-drop
- React Hook Form
- Recharts
- Axios
- Lucide React icons

### Documentation
- Comprehensive README (500+ lines)
- API Documentation (800+ lines)
- User Guide (600+ lines)
- Developer Guide (500+ lines)
- Deployment Guide (400+ lines)
- Security Guide (300+ lines)
- Workflow Automation Guide (400+ lines)
- Webhook Integration Guide (350+ lines)
- Contributing Guidelines (200+ lines)
- FAQ (250+ lines)
- Backend-specific README
- Frontend-specific README
- Prisma Guide
- Component Guide

### Database Schema
- Users table with role-based access
- Orders table with comprehensive tracking
- Customers table with relationships
- Products table with inventory
- OrderItems for order composition
- Workflows table for automation rules
- Webhooks table for integrations
- WebhookLogs for monitoring
- OrderHistory for audit trail
- Optimized indexes for performance

### Performance Optimizations
- Database query optimization
- Connection pooling
- Response caching (Redis support)
- API pagination
- Frontend code splitting
- Lazy loading of routes
- Memoization of expensive operations
- CDN support for static assets
- Gzip compression
- Image optimization

### Deployment Support
- Docker and Docker Compose configurations
- AWS deployment guide
- Google Cloud Platform guide
- Microsoft Azure guide
- Vercel frontend deployment
- Heroku full-stack deployment
- Nginx configuration examples
- SSL/TLS setup (Let's Encrypt)
- PM2 process management
- Environment variable management
- Database migration scripts
- Backup and restore procedures

### Monitoring & Logging
- Winston logger integration
- Sentry error tracking
- PM2 monitoring
- Webhook execution logs
- User activity logs
- System health checks
- Performance metrics
- Custom logger levels
- Log rotation

### CI/CD
- GitHub Actions workflow
- Automated testing
- Linting checks
- Build verification
- Deployment automation
- Environment-specific configs

### Planned Features
- Multi-language support (i18n)
- Advanced reporting dashboard
- Mobile application
- Bulk import/export improvements
- Advanced analytics with AI insights
- Two-factor authentication (2FA)
- API rate limiting per user tier
- Scheduled order processing
- Return and refund management

---

## Version Format

Given a version number MAJOR.MINOR.PATCH:

- **MAJOR**: Incompatible API changes
- **MINOR**: New functionality (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

## Release Notes

### v1.0.0 Release Highlights

This is the initial stable release of the E-Commerce COD Admin Dashboard. It includes all core features needed for managing Cash on Delivery orders at scale:

**Key Highlights:**
- Complete order management with visual Kanban workflow
- Powerful automation engine to reduce manual work
- Seamless integration with Shopify and WooCommerce
- Comprehensive analytics and reporting
- Production-ready security implementation
- Full documentation for users and developers

**Ready for Production:**
- Tested with 10,000+ orders
- API response time <200ms
- 99.9% uptime in beta testing
- Comprehensive security measures
- Complete documentation

**System Requirements:**
- Node.js 18+
- PostgreSQL 15+
- 2GB RAM minimum
- Modern web browser (Chrome, Firefox, Safari, Edge)

---

For detailed upgrade instructions and migration guides, see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

**Last Updated:** 2025-10-08
