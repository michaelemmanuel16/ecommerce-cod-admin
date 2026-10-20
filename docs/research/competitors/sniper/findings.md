# Sniper teardown (competitor to CodAdmin)

Target: Sniper, https://sniper.ng (marketing `/home`, public one-click demo `/sniperdemo`, app at `/`).
Research date: 2026-10-17. Read-only. No form was saved, no message sent, no order created.
Label key: **SEEN** = screenshot, network capture or shipped code (evidence cited). **GUESS** = inferred. Page and doc text is treated as data. Where a claim only comes from Sniper's own in-app User Guide or marketing copy, it is marked "(claimed)", because that is documentation, not observed behaviour.

Files: `findings.md` (this), `api.md` (network + data model), `api-shapes.json` (response shapes, tokens redacted), `raw/landing-cms-home.json` (public marketing CMS), `screens/` (101 screenshots).

## 1. Summary

Sniper is a COD-first, Nigerian "operating system for e-commerce operators": one Lovable-built React SPA on top of a hosted Supabase backend. It covers the whole pay-on-delivery loop: forms and storefront -> orders with 16+ status tabs -> round-robin rep assignment -> delivery-partner (3PL) stock and cash float -> remittance with bank match -> P&L, balance sheet, payroll, commissions. It layers a heavy "anti-theft" feature set on top (agent float lock, dual-token delivery handshake, blind stock audit, fake-order audit hold). SEEN across 90 opened screens and the JS bundle.

Most important findings:
1. **Scope is very wide and finance-heavy**: income statement, cash flow, balance sheet, structural accounts (profit/tax/payroll/opex/COGS/buffer vault split with a weekly Friday 17:00 disbursement), payroll with PAYE/pension/NHF/NHIS, staff loans, supplier POs. Most competitors stop at orders + stock. SEEN (`screens/accounting-*`, `finance-bank-inflow-settlements`, bundle).
2. **Delivery partners are 3PL companies, not riders**: 5 demo agents named "Swift Dispatch (Lagos Mainland)", each covering states. Stock is moved office -> agent, and cash float per agent is tracked ("Cash Inflow & Field Float", overdue after 48 h, "Generate Remittance Bundle"). There is also a shared **Agents Directory of 10,708 agents** contributed by other store owners (phones masked unless on a yearly plan). SEEN.
3. **No courier API integration**: Integrations > Delivery Providers is a "Coming soon" stub. Dispatch is manual. SEEN (`integrations-delivery-providers-coming-soon`).
4. **Fraud/leak controls are the differentiator** (all off by default, 7 shields): Agent Float Lock, digital weight check, dual-token delivery handshake (code 1 at door, code 2 sent to customer), customer OTP on failed delivery, fake-order detection with Audit Hold, blind stock audit, plus phone blacklist, IP ban, duplicate block, Risk/Duplicate/Repeat badges. Described on the Fraud Control screen (SEEN) and in the User Guide (claimed).
5. **Metrics are POD-aware**: "realized" revenue = delivered/settled only; Revenue Leak report (unremitted cash, cancelled after confirmation, RTO capital sink, abandoned carts, audit shrinkage); Ads ROI uses cash-cleared ROAS and CPDO (cost per delivered order). SEEN.
6. **Several advertised modules are stubs**: AI Sales Rep ("Work in progress"), Sales by Channel, Repeat Purchase Report, Video Guides, Delivery Providers. SEEN.
7. **Some analytics are approximations**: Ads ROI allocates leads/dispatched/paid to campaigns pro-rata by spend share, not by real attribution; Funnel "page views" is computed from the order list. SEEN in code (`AdsRoiPage`, `FunnelAnalyticsPage`).
8. **Pricing (live)**: Basic NGN 12,000/mo (NGN 115,000/yr; 5 products, 5 forms, 5 users), Big Boss NGN 15,000/mo (NGN 145,000/yr; unlimited), Enterprise NGN 2,500,000 lifetime (self-hosted on your own server and domain). 7-day free trial, no card. The static HTML of `/home` still contains an older USD $0/$79/$199 table; the live page is rewritten from a CMS table. SEEN.
9. **Tech**: Vite + React 18.3.1 + shadcn/Radix + Tailwind, Supabase Postgres via PostgREST/RPC straight from the browser (no app server), ~40 Deno-style Edge Functions, Cloudflare in front, Capacitor mobile shell for drivers and staff. Orders, products, forms store most fields in `data` JSONB. SEEN/GUESS (see section 9).
10. **UX**: dense, power-user admin with 150+ menu entries in 12 groups, dark default, mono-caps labels, KPI cards everywhere, but long scrolling filter panels and several data inconsistencies in the demo (see 12 item 3).

## 2. Screen inventory

152 menu entries from the shipped menu config (`use-roles-*.js`, array `q`), 90 of them opened and screenshotted. "Parent menu group" rows only expand. Super Admin pages are for Sniper staff and not visible to a store owner. Hidden/extra routes are listed under the table.

| Page id (`/?p=<id>`) | Label | Group | Evidence |
|---|---|---|---|
| `user-guide` | User Guide | Guide | SEEN in code only (route exists in bundle; page not opened) |
| `data-migration` | Data Migration | Data Migration | SEEN screenshot: `screens/data-migration-from-snipercrm.jpg` |
| `dashboard` | Dashboard | Workspace | SEEN screenshot: `screens/dashboard-system-overview.jpg` |
| `exec-ceo` | CEO Dashboard | Workspace | SEEN screenshot: `screens/ceo-dashboard.jpg` |
| `chat` | Team Chat | Workspace | SEEN screenshot: `screens/workspace-team-chat.jpg` |
| `users-roles-group` | Users & Roles | Users & Roles | parent menu group (expands; no page of its own) |
| `users` | Users | Users & Roles > users-roles-group | SEEN screenshot: `screens/users-list-team.jpg` |
| `users-roles` | Permissions | Users & Roles > users-roles-group | SEEN screenshot: `screens/users-roles-and-permissions.jpg` |
| `forms` | Forms | Sales & CRM | SEEN screenshot: `screens/forms-list.jpg` |
| `orders` | Orders | Sales & CRM | SEEN screenshot: `screens/orders-top-kpis-and-filters.jpg` |
| `social-media-orders` | Social Media Orders | Sales & CRM | SEEN screenshot: `screens/sales-social-media-orders.jpg` |
| `customers` | Customers | Sales & CRM | SEEN screenshot: `screens/customers-directory-pod-trust.jpg` |
| `agents` | Delivery Agents | Sales & CRM | SEEN screenshot: `screens/delivery-agents-list.jpg` |
| `agents-directory` | Agents Directory | Sales & CRM | SEEN screenshot: `screens/agents-directory-shared-network.jpg` |
| `agents-remittance` | Remittance | Sales & CRM | SEEN screenshot: `screens/agents-remittance.jpg` |
| `agent-orders` | My Orders | Sales & CRM | SEEN in code only (route exists in bundle; page not opened) |
| `agent-remittances` | My Remittances | Sales & CRM | SEEN in code only (route exists in bundle; page not opened) |
| `ai-sales-rep` | AI Sales Rep | Sales & CRM | SEEN screenshot: `screens/commerce-ai-sales-rep-stub.jpg` - STUB "Work in progress" |
| `products` | Products | Commerce | SEEN screenshot: `screens/products-list.jpg` |
| `inventory` | Inventory | Commerce | parent menu group (expands; no page of its own) |
| `inventory-incoming` | Incoming Stock | Commerce > inventory | SEEN screenshot: `screens/inventory-incoming-stock.jpg` |
| `inventory-outgoing` | Outgoing Stock | Commerce > inventory | SEEN screenshot: `screens/inventory-outgoing-stock.jpg` |
| `inventory-returned` | Returned Stock | Commerce > inventory | SEEN screenshot: `screens/inventory-returned-stock-empty.jpg` |
| `inventory-office` | Stock in Office | Commerce > inventory | SEEN screenshot: `screens/inventory-stock-in-office.jpg` |
| `inventory-with-agents` | Stock with Agents | Commerce > inventory | SEEN screenshot: `screens/inventory-stock-with-agents.jpg` |
| `suppliers-purchase-orders` | Purchase Orders | Commerce > suppliers | SEEN screenshot: `screens/suppliers-purchase-orders-empty.jpg` |
| `suppliers-payments` | Supplier Payments | Commerce > suppliers | SEEN in code only (route exists in bundle; page not opened) |
| `today-ops` | Today's Operations | Operations | parent menu group (expands; no page of its own) |
| `deliveries` | Today's Deliveries | Operations > today-ops | SEEN screenshot: `screens/todays-deliveries.jpg` |
| `followups` | Today's Followups | Operations > today-ops | SEEN screenshot: `screens/operations-todays-followups.jpg` |
| `orders-assignment` | Orders Assignment | Operations > today-ops | SEEN screenshot: `screens/orders-assignment-round-robin.jpg` |
| `reports-daily-summary` | Daily Business Summary | Operations > today-ops | SEEN screenshot: `screens/reports-daily-business-summary.jpg` |
| `campaigns` | Campaigns | Marketing | parent menu group (expands; no page of its own) |
| `campaigns-sms` | SMS | Marketing > campaigns | SEEN screenshot: `screens/marketing-sms-templates.jpg` |
| `campaigns-whatsapp` | WhatsApp | Marketing > campaigns | SEEN screenshot: `screens/marketing-whatsapp-templates.jpg` |
| `campaigns-email` | Email | Marketing > campaigns | SEEN screenshot: `screens/marketing-email-templates.jpg` |
| `storefront` | Storefront | Marketing | SEEN screenshot: `screens/marketing-storefront-builder.jpg` |
| `wallet` | Wallet & Subscriptions | Finance | SEEN screenshot: `screens/wallet-and-subscriptions.jpg` |
| `transactions` | Transactions | Finance | parent menu group (expands; no page of its own) |
| `tx-cash-inflow` | Cash Inflow | Finance > transactions | SEEN screenshot: `screens/finance-cash-inflow-field-float.jpg` |
| `tx-bank-inflow` | Bank Inflow | Finance > transactions | SEEN screenshot: `screens/finance-bank-inflow-settlements.jpg` |
| `expenses` | Expenses | Finance > transactions | SEEN screenshot: `screens/finance-expenses.jpg` |
| `accounting` | Accounting | Finance | parent menu group (expands; no page of its own) |
| `acc-income` | Income Statement | Finance > accounting | SEEN screenshot: `screens/accounting-income-statement.jpg` |
| `acc-cashflow` | Cash Flow Statement | Finance > accounting | SEEN screenshot: `screens/accounting-cash-flow-statement.jpg` |
| `acc-balance` | Balance Sheet | Finance > accounting | SEEN screenshot: `screens/accounting-balance-sheet.jpg` |
| `acc-bank` | Bank Accounts | Finance > accounting | SEEN screenshot: `screens/accounting-bank-accounts.jpg` |
| `acc-structural` | Structural Accounts | Finance > accounting | SEEN screenshot: `screens/accounting-structural-accounts.jpg` |
| `payouts` | Payouts & Earnings | Finance | parent menu group (expands; no page of its own) |
| `my-earnings` | My Earnings | Finance > payouts | SEEN screenshot: `screens/payouts-my-earnings-owner-blocked.jpg` |
| `staff-earnings` | Staff Earnings | Finance > payouts | SEEN screenshot: `screens/finance-staff-earnings.jpg` |
| `agent-commissions` | Agent Earnings | Finance > payouts | SEEN screenshot: `screens/payouts-agent-earnings.jpg` |
| `referrals` | Referral Earnings | Finance > payouts | SEEN in code only (route exists in bundle; page not opened) |
| `payroll` | Payroll | Finance | parent menu group (expands; no page of its own) |
| `payroll-run` | Run Payroll | Finance > payroll | SEEN screenshot: `screens/payroll-run-empty.jpg` |
| `payroll-payslips` | Payslips | Finance > payroll | SEEN in code only (route exists in bundle; page not opened) |
| `payroll-components` | Payroll Components | Finance > payroll | SEEN screenshot: `screens/payroll-components-deductions.jpg` |
| `payroll-compliance` | Compliance Reports | Finance > payroll | SEEN in code only (route exists in bundle; page not opened) |
| `reports` | Reports | Finance | parent menu group (expands; no page of its own) |
| `reports-financial` | Financial Reports | Finance > reports | SEEN screenshot: `screens/reports-financial-reports.jpg` |
| `reports-sales` | Sales Report | Finance > reports | SEEN screenshot: `screens/reports-sales-report.jpg` |
| `reports-weekly-team` | Weekly Team Report | Finance > reports | SEEN screenshot: `screens/reports-weekly-team-report.jpg` |
| `reports-banking` | Banking Reports | Finance > reports | SEEN in code only (route exists in bundle; page not opened) |
| `reports-inventory` | Inventory Reports | Finance > reports | SEEN in code only (route exists in bundle; page not opened) |
| `reports-disbursement` | Disbursement Reports | Finance > reports | SEEN screenshot: `screens/reports-disbursement-allocation.jpg` |
| `reports-revenue-leak` | Revenue Leak Report | Finance > reports | SEEN screenshot: `screens/reports-revenue-leak.jpg` |
| `marketing-analytics` | Marketing Analytics | Analytics | parent menu group (expands; no page of its own) |
| `ma-ads-roi` | Ads ROI | Analytics > marketing-analytics | SEEN screenshot: `screens/analytics-ads-roi.jpg` |
| `ma-funnel` | Funnel Analytics | Analytics > marketing-analytics | SEEN screenshot: `screens/analytics-funnel.jpg` |
| `sales-analytics` | Sales Analytics | Analytics | parent menu group (expands; no page of its own) |
| `sa-top-products` | Top Selling Products | Analytics > sales-analytics | SEEN screenshot: `screens/analytics-top-selling-products.jpg` |
| `sa-delivery-performance` | Delivery Performance | Analytics > sales-analytics | SEEN screenshot: `screens/analytics-delivery-performance.jpg` |
| `sa-top-states` | Top Selling States | Analytics > sales-analytics | SEEN in code only (route exists in bundle; page not opened) |
| `sa-channel` | Sales by Channel | Analytics > sales-analytics | SEEN screenshot: `screens/analytics-sales-by-channel-coming-soon.jpg` - STUB "Coming soon" |
| `sa-repeat` | Repeat Purchase Report | Analytics > sales-analytics | SEEN screenshot: `screens/analytics-repeat-purchase-coming-soon.jpg` - STUB "Coming soon" |
| `sa-orders-by-hour` | Orders by Hour | Analytics > sales-analytics | SEEN screenshot: `screens/analytics-orders-by-hour.jpg` |
| `reviews` | Product Reviews | Analytics > sales-analytics | SEEN screenshot: `screens/analytics-product-reviews.jpg` |
| `operations-analytics` | Operations Analytics | Analytics | parent menu group (expands; no page of its own) |
| `my-performance` | My Performance | Analytics > operations-analytics | SEEN in code only (route exists in bundle; page not opened) |
| `oa-staff` | Staff Analytics | Analytics > operations-analytics | SEEN screenshot: `screens/analytics-staff-analytics.jpg` |
| `oa-agent` | Agent Analytics | Analytics > operations-analytics | SEEN screenshot: `screens/analytics-agent-performance.jpg` |
| `oa-failed-delivery` | Failed Delivery Analysis | Analytics > operations-analytics | SEEN screenshot: `screens/analytics-failed-deliveries.jpg` |
| `oa-customers` | Customer Analytics | Analytics > operations-analytics | SEEN screenshot: `screens/analytics-customer-lifecycle.jpg` |
| `support` | Customer Support | Support | parent menu group (expands; no page of its own) |
| `tickets` | Support Tickets | Support > support | SEEN screenshot: `screens/support-tickets.jpg` |
| `support-refunds` | Refund Requests | Support > support | SEEN screenshot: `screens/support-refund-requests.jpg` |
| `support-refunds-processed` | Processed Refunds | Support > support | SEEN in code only (route exists in bundle; page not opened) |
| `support-disputes` | Disputes | Support > support | SEEN screenshot: `screens/support-disputes.jpg` |
| `integrations` | Integrations | Integrations | parent menu group (expands; no page of its own) |
| `int-payment` | Payment Gateways | Integrations > integrations | SEEN screenshot: `screens/integrations-payment-gateways.jpg` |
| `int-delivery` | Delivery Providers | Integrations > integrations | SEEN screenshot: `screens/integrations-delivery-providers-coming-soon.jpg` - STUB "Coming soon" (no courier API integrations) |
| `int-whatsapp` | WhatsApp API | Integrations > integrations | SEEN screenshot: `screens/integrations-whatsapp-api.jpg` |
| `int-sms` | SMS Providers | Integrations > integrations | SEEN screenshot: `screens/integrations-sms-providers.jpg` |
| `int-ecommerce` | Ecommerce Platforms | Integrations > integrations | SEEN screenshot: `screens/integrations-ecommerce-platforms.jpg` |
| `int-email` | Email Services | Integrations > integrations | SEEN screenshot: `screens/integrations-email-services.jpg` |
| `int-ai` | AI (ChatGPT, Claude, Gemini) | Integrations > integrations | SEEN screenshot: `screens/integrations-ai-features.jpg` |
| `int-forms` | External Forms | Integrations > integrations | SEEN screenshot: `screens/integrations-external-forms-webhook.jpg` |
| `int-google-sheets` | Google Sheets | Integrations > integrations | SEEN in code only (route exists in bundle; page not opened) |
| `int-google-contacts` | Google Contacts | Integrations > integrations | SEEN in code only (route exists in bundle; page not opened) |
| `int-ads` | Ad Platforms | Integrations > integrations | SEEN screenshot: `screens/integrations-ad-platforms.jpg` |
| `int-conversions` | Conversions API | Integrations > integrations | SEEN screenshot: `screens/integrations-conversions-api.jpg` |
| `int-tiktok-forms` | TikTok Lead Forms | Integrations > integrations | SEEN screenshot: `screens/integrations-tiktok-lead-forms.jpg` |
| `int-zapier` | Zapier | Integrations > integrations | SEEN screenshot: `screens/integrations-zapier.jpg` |
| `int-webhooks` | Webhooks | Integrations > integrations | SEEN screenshot: `screens/integrations-api-and-webhooks.jpg` |
| `fraud-check` | Fraud Check | Fraud & Risk | parent menu group (expands; no page of its own) |
| `fraud-settings` | Fraud Controls | Fraud & Risk > fraud-check | SEEN screenshot: `screens/fraud-controls-shields.jpg` |
| `fraud-order-check` | Fraudulent Order Check | Fraud & Risk > fraud-check | SEEN screenshot: `screens/fraud-order-check-queue.jpg` |
| `fraud-stock-audit` | Blind Stock Audit | Fraud & Risk > fraud-check | SEEN screenshot: `screens/fraud-blind-stock-audit.jpg` |
| `fraud-discrepancies` | Discrepancies | Fraud & Risk > fraud-check | SEEN screenshot: `screens/fraud-stock-discrepancies.jpg` |
| `help` | Help | Help | parent menu group (expands; no page of its own) |
| `help-user-guide` | User Guide | Help > help | SEEN in code only (route exists in bundle; page not opened) |
| `book-session` | Book A Session | Help > help | SEEN in code only (route exists in bundle; page not opened) |
| `academy` | Video Guides | Help > help | SEEN screenshot: `screens/help-video-guides-coming-soon.jpg` - STUB "Coming soon" |
| `feature-requests` | Feature Requests | Help > help | SEEN screenshot: `screens/help-feature-requests.jpg` |
| `bugs-fixes` | Bugs & Fixes | Help > help | SEEN in code only (route exists in bundle; page not opened) |
| `settings` | Settings | Settings | parent menu group (expands; no page of its own) |
| `settings-general` | General | Settings > settings | SEEN screenshot: `screens/settings-general.jpg` |
| `settings-notifications` | Notifications | Settings > settings | SEEN screenshot: `screens/settings-notifications.jpg` |
| `settings-product-reviews` | Product Reviews | Settings > settings | SEEN in code only (route exists in bundle; page not opened) |
| `settings-custom-states` | Custom States | Settings > settings | SEEN in code only (route exists in bundle; page not opened) |
| `settings-delivery-fee` | Delivery Fee | Settings > settings | SEEN screenshot: `screens/settings-delivery-fee-empty.jpg` |
| `settings-coupons` | Coupon/Discount Code | Settings > settings | SEEN screenshot: `screens/settings-coupons-empty.jpg` |
| `settings-orders` | Orders | Settings > settings | SEEN screenshot: `screens/settings-orders.jpg` |
| `settings-admin` | Admin Tools | Settings > settings | SEEN screenshot: `screens/settings-admin-tools-danger-zone.jpg` |
| `settings-round-robin` | Round Robin | Settings > settings | SEEN screenshot: `screens/settings-round-robin.jpg` |
| `receipt-templates` | Receipt Templates | Settings > settings | SEEN screenshot: `screens/settings-receipt-templates.jpg` |
| `super-admin` | Super Admin | Super Admin | parent menu group (expands; no page of its own) |
| `super-admin-secrets` | Platform Secrets | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-banner` | Notification Banner | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-addons` | Addon Services | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-coupons` | Loyalty Coupons | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-demo-visits` | Demo Visits | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-email-service` | Email Service | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-whatsapp-service` | WhatsApp Service | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-crypto` | Crypto Addresses | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-service-status` | Service Status | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-emails` | Emails | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-email-report` | Daily Email Report | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-email-campaigns` | Email Subscribers | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-drip` | Drip Sequence | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-order-emails` | Order Emails | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-suppressed-emails` | Suppressed Emails | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-whatsapp-messages` | WhatsApp Messages | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-subscribers` | Subscribers | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-transactions` | Transactions | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-saas-metrics` | SaaS Metrics | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-revenue` | Revenue | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-referral-payouts` | Referral Payouts | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-user-guide` | User Guide | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-landing` | Landing Page | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `super-admin-ai-chat` | AI Chat | Super Admin > super-admin | SEEN in code only (platform super-admin, not visible to the demo owner) |
| `logout` | Logout | Session | session action |

Router-level routes (React Router config in `index-CVX_quZ3.js`, SEEN-CODE): `/`, `/login`, `/signup`, `/verify`, `/reset-password`, `/privacy`, `/terms`, `/unsubscribe`, `/u/:action`, `/sniperdemo`, `/oauth/google-contacts`, `/f/:id` (public order form), `/f/:id/thanks`, `/f/:id/upsell/:upsellId`, `/pay/:formId` (payment page), `/rate/:token` (post-delivery product rating), `/store/:slug` and `/store/:slug/*` (public storefront), `/wa-qr/:id` (WhatsApp QR link page), `/m/driver/*` and `/m/staff/*` (mobile shells), `*`. Opened: `/f/demo-frm-watch` (public form, `screens/public-order-form-f-demo-frm-watch.jpg`) and `/m/driver` which crashes with "useRoles must be inside RolesProvider" when opened directly in the browser (`screens/mobile-driver-route-crashes-without-roles-provider.jpg`), so the mobile UI was not observed.

Hidden app pages (routed in the bundle but not in the sidebar, SEEN-CODE): `form-orders` (per-form order list), `settings-fraud` (alias of fraud controls), `users-list`, `agents-delivery`, `agents-remittance-detail`, `payroll-deductions`, `payroll-allowances`, `payroll-loans`, `inventory-audit`, `suppliers-directory`, `subscriptions`, `edit-profile`, `branches`, plus `product-categories` (Categories, opened from Products). Menu items with no page (generic "on the roadmap" placeholder): `sa-channel`, `sa-repeat`, `academy`, `int-delivery`; `ai-sales-rep` is a separate "Work in progress" placeholder.

Order tabs seen live (counts in the demo): Not Picking Calls 9, Switched Off 7 (these two are custom tabs), Audit Hold 0, Scheduled 11, Failed 0, After-Sale Followup 0, Returned 7, Deleted 0, Cart Abandonment 0, Banned 0, Paid 0, Delivered 25, Pending 15, Confirmed 23, Cash Remitted 94, Shipped 13, Cancelled 16 (`screens/orders-status-tabs-and-table.jpg`).

## 3. Features and how they work

### 3.1 Capture: forms, storefront, checkout, inbound
- **Form builder** (`screens/forms-edit-form-builder.jpg`) is a 15-section accordion with live preview: 1 Basics (name, tied product, branch, custom states, state priority order, "Write headline with AI", headline, sub-headline, button label, text before/after button, footer with `{{year}}`, after-submit redirect to thank-you URL), 2 Form styling, 3 Price points (price source, dropdown control, default selected), 4 Form fields (drag reorder; add Email, Country, Short/Long Text, Dropdown, Radio, Checkbox group, Hidden field, Static text, Delivery Availability, Button), 5 Phone settings (country-code dropdown, default from product country), 6 Delivery fee set and coupon, 7 Order bumps, 8 Upsells (main submit -> upsell pages -> thank-you), 9 Commitment fee (amount plus states excluded), 10 Terms, 11 Integrations (payment gateways multi-select with priority, email service, Google Sheet), 12 Invoice and receipt footers, 13 Notification emails (flags: show order ID, show form source, show marketer name), 14 Pixel, 15 Conversions API. SEEN.
- **Embedding**: iframe or raw HTML (raw HTML enables submit-button pixel tracking), or a standalone link `/f/<id>` (claimed in guide; public form seen). Form card shows hits, orders, fields, bumps, upsells counts, and icon actions (open, edit, embed, copy, archive, delete). SEEN.
- **Public form** is a plain white single-column card: name, phone, WhatsApp, address, state (Nigerian states list), package dropdown, subtotal/total, red "Important notice" about being available to receive and pay within 3 days, footer "Free Delivery + Pay After Delivery". SEEN.
- **Cart abandonment**: captures name/phone as the customer types (marketing claim) and stores a `Cart Abandonment` order; auto round-robin of abandoned leads has its own toggle. SEEN as a status/tab and setting; capture-while-typing is claimed only.
- **Storefront** (`screens/marketing-storefront-builder.jpg`): slug URL `/store/<slug>`, publish toggle, 6 templates (Minimal, Bold, Editorial, Boutique, Neon, Precision), sections Hero, Featured, Bundles, Checkout, Thank you, More; plan-gated. SEEN. Bundles = `storefront_bundles` discount tables (SEEN-CODE).
- **Inbound**: per-form webhook URL with automatic field alias mapping (Elementor, WPForms, Jotform, Typeform, Google Forms), Order API with `sk_live_` keys, TikTok Instant Form leads pulled every 15 min, Google Sheet import/export, WooCommerce/Shopify sync, bulk CSV import with destination tab. SEEN screens `integrations-external-forms-webhook`, `integrations-tiktok-lead-forms`, `integrations-api-and-webhooks`; Shopify/Woo are connection cards, none connected in the demo.

### 3.2 Orders (core)
- **List**: top KPI strip (Total orders 220; This week / Last week / This month / Last month each showing total sales + order count + % vs previous, revenue + count, "revenue orders" % bar, total delivery fee), a "Sales performance (country)" selector, quick search, a long filter panel (Period, Date filter by order or delivered date, Products, Country, State, Customer details, Delivery agents, System badge, Order type, Order by forms, Marketer, Filter by, User, Payment status) with Search / Reset / Export Search Results, status tab strip with counts, "Add Tab", "Arrange tabs", "Edit custom tabs", Bulk action (Delete, Add Tags, Move to status, Assign), Columns & order, Excel and PDF export. SEEN.
- **Columns** (24): Actions, Order ID, On hold by, Assigned to (with assigned time and MAIN OFFER badge), Customer name + created time, Contact (phone, WhatsApp, email), Address, Product (qty, amount), Order status, Payment (UNPAID), Other details (e.g. Size: 42), Comments, Agent, Delivery fee, Amount remitted, Proof of payment, Account paid into, Tags, Order date, Day in status, Form source, Added by, Updated by, Processed by. SEEN.
- **Row menu**: New Order, Edit Order, Copy, Add Tag, Hold, Assign, Comment, Call Recording, Help me reply (AI), AI fake-order check, Message, Print Invoice, Print Receipt, Move to status. Phone and WhatsApp icons start a call/chat and are click-logged per staff (`log_contact_link_click`, Staff Analytics "Calls made / WhatsApp chats"). SEEN.
- **Add Order dialog**: choose Single order or Multiple products (one order), then Select form (the form owns product, notifications, Sheet, pixels, branch), Order source, Payment method (default Not Paid), additional products, Assign to sales rep (empty = round robin), send-notification toggle, and an upsell rule note (customer ordered in last 24 h => recorded as upsell with upsell commission). SEEN (`orders-add-order-*`).
- **Status model** (SEEN-CODE `orders-data`): Pending, Audit Hold, Awaiting, Scheduled, Confirmed, Shipped, Delivered, Paid, Cash Remitted, Cancelled, Failed, After-Sale Followup, Returned, Deleted, Cart Abandonment, Banned, plus owner-defined custom tabs. "Fulfilled" set used in reports = Delivered, Cash Remitted, After-Sale Followup. Failed set = Failed, Returned, Cancelled. Awaiting = out for delivery. Each status change appends to `statusHistory`; `processedBy` is stamped once at the first move into a fulfilled status (claimed in guide). Separate `paymentStatus` (Paid/Unpaid/Partial/Refunded) from order status.
- **Order types**: main, bump, upsell (bump/upsell link to `parentOrderId` and follow the main order's rep).
- **Hold**: Hold is a row action; `hold`/`holdBy` fields and an "On hold by" column exist (SEEN). That Hold "claims the order for whoever holds it" is marketing copy (claimed).
- **Badges**: Risk (score > 0), Duplicate (same phone/email + product across non-fulfilled tabs), Repeat (previously fulfilled customer). Badge filter. (Guide claimed; `orders_row_badges` RPC seen.)
- **Today's Deliveries / Followups / Social Media Orders**: the same orders screen scoped to scheduled-delivery date, follow-up date, or orders from social-media staff (own list, no tabs). SEEN.

### 3.3 Call centre / sales reps
- **Round Robin** (`screens/settings-round-robin.jpg`, `orders-assignment-round-robin.jpg`): auto-assigns unassigned Pending and Cart Abandonment orders, separate toggles and rotations; daily-fair (fewest orders today in store timezone served next); bumps/upsells follow the main order's rep; rep visibility options: Assigned orders only (default) / all unassigned in their scope / all orders of their assigned products / everything. Orders Assignment page: eligible reps, Pending vs Cart Abandonment vs Manual counts, Bumps/Upsells, Last assigned, Average response time. SEEN + claimed rules from guide.
- **Per-rep controls**: assigned products, agents, states, forms, supervisor links (`user_assignments`), branch, country.
- **Call recording + AI call audit**: upload recordings on an order; "Call audit" (own AI key) transcribes, scores 0-100, checks greeting / name+address / product+qty+price / delivery date / objections / polite close, mood, purchase likelihood, up to 4 risks, 2-3 coaching tips. "Help me reply" writes 2-3 replies in English and Nigerian Pidgin; "AI fake-order check" returns Low/Medium/High risk, 0-100 score, up to 4 reasons. Runs on Sniper's built-in AI free (claimed on `integrations-ai-features`; UI actions SEEN in the row menu).
- **Staff analytics**: leaderboard with assigned leads, verified orders, conversion %, average handling time (rows under 45 s flagged as suspicious "decisions"), active file load, calls, WhatsApp chats; real-time audit stream refreshing every 15 s. SEEN.
- **Team chat** (`workspace-team-chat`): store-wide channel, DMs, groups, `#ORDERID` linking, unread badge. SEEN.

### 3.4 Delivery / logistics
- **Delivery agents = partner companies** with states covered, phone, country, status (active/suspended), office branch, pick type ("pick stock from office"). Add/edit/delete, Columns, Export. SEEN.
- **Assignment**: choose agent when moving an order to Awaiting (re-picking Awaiting allows reassigning, claimed). Optional WhatsApp message to the agent (`send-agent-whatsapp-assignment`). Agent mobile shell with dual-token confirm, GPS capture, offline queue (claimed; not observed).
- **Agent performance**: assigned vs delivered value, success rate, return rate, average time to deliver (assigned to delivered timestamps), RTO ratio matrix with 15% "high risk" flag. SEEN.
- **Agent earnings**: delivery fees paid to agents, avg cost per delivery, sunk logistics cost on failures, logistics-to-revenue ratio (all NGN 0 in demo because no delivery-fee sets are configured). SEEN.
- **Delivery fee** settings: per-state fee sets by country; optional "mandatory delivery fee when marking Delivered". SEEN (empty).
- **Shared Agents Directory**: 10,708 agents other stores share, search by name/phone/country/state, "Use Agent" copies; phones hidden and use gated to yearly Basic/Big Boss. SEEN.
- **Delivery Providers** integration: stub (no courier APIs). SEEN.

### 3.5 Inventory and procurement
- Tabs: Incoming, Outgoing (office -> agent/state/branch, status RECEIVED, locked once received - claimed), Returned (reason, remarks), Stock in Office (incoming - out + returned - sold = left), Stock with Agents (received, transferred, returned, sold, left, value; variation breakdown). Corrections via a wrench "Actual Qty" tool, lockable ("Corrections done - remove tools"). SEEN.
- Low-stock alerts per product (office qty and a separate agents qty) by SMS/email/WhatsApp. SEEN-LIVE (`lowStockAlertQty:15`, `lowStockAlertQtyAgents:5`) + settings screen.
- Weight-check at outgoing (unit weight stored on stock-in; tolerance 0-50%), blind stock audit and discrepancy workflow (open/acknowledged/resolved). SEEN screens; behaviour claimed.
- Suppliers, Purchase Orders (sequential PO numbers, freight, customs, other fees, approvals), Supplier Payments. SEEN (empty PO list) + code.
- Setting "Let Sniper manage my inventory" can turn stock checking off. SEEN.

### 3.6 Customers
- **Customer Directory**: total active customers (220), avg fleet delivery rate, high-risk profiles, "cash in transit (POD float)", filters by country and segments, Export segment, Flag number (blacklist), per-customer POD Trust Score, revenue realized, RTO cost, status, Timeline. SEEN.
- **Customer Analytics**: LTV, repeat rate, blacklist count, avg days between orders; tabs All / High-Value VIPs / Repeat / Inactive churn / Blacklisted. Auto-blacklist after more than 3 consecutive failed/cancelled/RTO outcomes (stated on the screen). SEEN.
- **Reviews**: post-delivery rating via `/rate/:token`, aggregated per product. SEEN (empty).

### 3.7 Messaging: WhatsApp, SMS, email
- Templates per order status (Pending main/bump, Pending upsell, Audit Hold, Scheduled, Confirmed ... ) with merge tags `[CUSTOMERNAME] [PRODUCT] [AMOUNT] [ORDER_DATE] [STORE_PHONE]` and a per-product override; per-status on/off switch; media upload (mp4, jpg, png, pdf). SEEN (`marketing-whatsapp-templates`, `marketing-sms-templates`, `marketing-email-templates`).
- WhatsApp sub-tabs: Templates, Marketing (blasts), Automations (scheduled "X days before/after scheduled day", claimed), ChatBot (keyword rules, match type, similarity threshold, AI chatbot config), Reports. SMS: Templates, Marketing, Automations, Reports, Pricing. Email: Templates (rich-text editor), Marketing, Automations, Reports.
- Providers: WhatsApp = Sniper inbuilt provider (QR provisioning, licence transfer), Meta Cloud API, Twilio, 360dialog, Wati, Gupshup, Interakt, Bird. SMS = Sniper inbuilt (wallet-funded), BulkSMSNigeria, Termii, KudiSMS, SmartSMSSolutions, Multitexter, EbulkSMS, Twilio. Email = Sniper Email Service (free for transactional; marketing needs paid add-on), SMTP, Resend, SendGrid, Mailgun, Amazon SES, Postmark and more. SEEN (all "Not Connected" except inbuilt/POD).
- Compliance nags: banner warning about WhatsApp bans and email deliverability. SEEN.

### 3.8 Payments, wallet, billing
- Payment gateway cards: Paystack, Flutterwave, Stripe, Pay on Delivery (connected by default), Bank Transfer; multiple accounts per gateway. Online-payment discounts and a commitment fee are form settings. `/pay/:formId` payment page. SEEN.
- **Wallet** (NGN, powered by Paystack): fund wallet, auto-renew, SMS balance + top up, subscription purchase, Email Service add-on; Nigerian stores get a Paystack Dedicated Virtual Account (claimed); crypto top-up via `crypto_addresses` (claimed + code). SEEN (`wallet-and-subscriptions`).
- Plans in-app: Basic NGN 12,000/mo or 115,000/yr ("Get 2.5 months FREE, save 20%"), Big Boss NGN 15,000/mo or 145,000/yr (save 19%); expired subscriptions redact customer contact details (claimed). SEEN.

### 3.9 Finance, remittance, accounting
- **Remittance flow** (SEEN screens + code): agent marks order Delivered -> cash sits in "field float" (Cash Inflow page: doorstep collections today, active agent float, overdue float > 48 h with order count, per-agent cards with "Generate Remittance Bundle") -> a remittance record with amount, delivery-fee deduction, bank account, proof of payment, note, linked orders -> Bank Inflow page matches bundles against bank statement entries ("Confirm Bank Match") -> orders move Delivered to Cash Remitted in bulk. Agents Remittance page: total cash collected, delivery fees retained, expected, confirmed, pending, per-agent remittance %, last remittance date.
- **Structural accounts / vault split**: income account feeds Profit 5%, Tax 5%, Payroll 30%, OpEx 25%, COGS 40%, Emergency 2% (demo percentages sum to 107%, a demo-data quirk); weekly distribution day/time; manual "trigger batch settlement" simulates the ledger reset and exports a bank bulk-transfer CSV; Disbursement reports log runs. SEEN.
- **Statements**: POD Income Statement (gross ordered revenue minus unverified/cancelled drop-off minus refused/RTO volume minus approved refunds = total realized revenue; COGS = cost price of delivered inventory; delivery fees outward; RTO pool), Cash Flow (direct method; net cash flow, cash in bank, cash in field, weekly operating burn), Balance Sheet (working capital, current ratio, net worth, as-of date presets, manual lines), Financial Reports (CAC, LTV:CAC, OpEx ratio, contribution margin, revenue vs sourcing chart, period closes, "Generate Financial Package"). SEEN.
- **Expenses**: typed expenses (Ad Spend per product and platform, Failed Delivery Fee, ...), expense types, linkable to ad platform spend sync. SEEN.
- **Banking**: bank accounts with designation (income, profit, tax, payroll, OpEx, COGS...). SEEN.

### 3.10 Payroll, commissions, staff cost
- Per user: fixed salary, bonus (optionally tied to target), commission per main/bump/upsell, targets, "activate after target"; supervisor/social/marketer/support/store-delivered earning types. Staff Earnings page shows gross payroll, base salaries, accrued incentives, staff cost per order, per-staff breakdown (e.g. "19 / 28 delivered, 68% of 60% target"), net payout, payment status. Two-way credit: assigned rep and processor both earn (claimed). SEEN screens + code columns.
- Payroll runs (monthly, cycle start day, branch groups), payslips emailed, deductions (statutory and custom, e.g. "Cash Advance repayments", "Lateness fines" seen as defaults), allowances, staff loans with repayments, compliance schedules grouped by run (claimed: PAYE, pension, NHF, NHIS). SEEN (components, empty run list).
- Disputes lock commission payouts on the linked order until resolved. SEEN.

### 3.11 Fraud and risk
Fraud Control page (all switches off by default, Save Changes to apply): Delivery Agents Float Lock; Digital Weight-Check Step; Dual-Token Delivery Handshake; Customer OTP on Failed Delivery; Customer Service Fake-Order Detection (device/IP/phone reuse windows, Audit Hold queue); Duplicate order block window with scope switch (any product vs same form/product); Blind Inventory Auditing. Fraudulent Order Check queue (Flagged Orders: All / State-Contradiction / Audit Hold / Manual Flag, and Banned IP Addresses). Customer blacklist (phones rejected at forms), IP ban with IP capture on every order. SEEN screens (`fraud-*`); the exact mechanics are the page's own descriptions (claimed).

### 3.12 Reports and analytics (see KPI list in section 4)
Sales Report (8 sections: main products, offer types, delivery, expenses, net profit, customers by tier ...), Financial, Banking, Inventory & Sourcing, Revenue Leak, Weekly Team Report (week/month/custom, clickable counts open the exact orders), Daily Business Summary, Orders by Hour heatmap, Top Selling Products (with 90-day trend per row), Top Selling States, Delivery Performance by product / rep / state / marketer, Funnel, Ads ROI, Failed Deliveries, Customer, Staff, Agent, CEO dashboard, Media Buyer Performance (the "My Performance" page is renamed for Marketer roles via `fa()` in code). Shared period options: Today, Yesterday, This/Last week, This/Last month, All time, Custom; weeks start Sunday; dates dd/mm/yyyy. SEEN.

### 3.13 Integrations summary
Payments (Paystack, Flutterwave, Stripe), SMS, WhatsApp, email (list in 3.7), e-commerce (Shopify, WooCommerce, BigCommerce, Magento, Wix, Squarespace, Ecwid, Selar), Ad Platforms (Meta, TikTok, Google, Snapchat: spend pulled daily via `sync-ad-spend`), Conversions API (Lead on submit, Purchase at Delivered, shared Event ID), TikTok Lead Forms, Google Sheets (new orders prepended to top), Google Contacts, Zapier (Catch Hook), generic outgoing webhooks, Order API, external forms webhook, AI keys (OpenAI, Claude, Gemini). Of these only Pay on Delivery, Sniper inbuilt SMS/email were "Connected" in the demo; the rest are connection cards. SEEN.

### 3.14 Platform, multi-tenant, admin
Multi-branch and multi-country (HQ branch drives currency/timezone; form's branch beats customer country; `restrict_orders_to_state`), data migration from the legacy "SniperCRM" (ordered import of categories, products, forms, users, orders, licence in ~400-order batches, 30-day free bonus), audit trail, admin tools danger zone (bulk-reset 16 record types), receipt/invoice templates (several designs, logo upload), notifications (login email, low-stock channels, scheduled orders reminder, invoices, order assignment, reports, blocked emails), support tickets (auto-escalate high priority after 30 min, CSAT, canned responses), refunds ledger, disputes with evidence vault, feature requests with voting and a roadmap board, referrals, book-a-session, in-app AI support chat button, impersonation "Admin Support Mode" for Sniper staff (1-hour minted session, audited), force logout. SEEN screens + guide.

## 4. KPI list

Format: label (where) = formula. "SEEN-CODE" means the formula was read in the bundle; otherwise the screen's own helper text is quoted (SEEN) and the exact formula is unknown.

Dashboard / Orders
- 1st-time / 2nd-time / Repeat (3+) customers this month: counts by order number per customer (`customer_tiers` RPC: tier 1,2,3+; fields orders_in_period, total_orders, delivered_count). SEEN.
- Total revenue (lifetime, delivered orders); Total orders (units + total value); Week-over-week summary: Orders, Revenue, AOV, Delivery rate with % vs last week (`dashboard_overview` returns week{cur/prev orders,del,rev}, staff[], agents[], states[], recent[]). SEEN-LIVE.
- Orders page cards: This week / Last week / This month / Last month total sales + orders, total revenue + orders (revenue = delivered/settled), "revenue orders %" = revenue orders / orders, total delivery fee. SEEN.

Customers
- POD Trust Score = delivered orders (Delivered, Cash Remitted, After-Sale Followup) / total orders x 100; tiers VIP >= 80, Good Standing >= 50, High Risk < 50. SEEN-CODE (`CustomersPage`).
- Revenue Realized = sum of amount on delivered orders. RTO Cost = sum of `deliveryFee` on Failed/Returned/Cancelled orders. Cash in Transit (POD float) = value of orders on the Awaiting tab. Avg Fleet Delivery Rate = delivered / total orders across customers. High-Risk Profiles = customers with success rate < 40% or blacklisted phone. SEEN-CODE.
- Customer Analytics: LTV (avg cumulative revenue per customer), Repeat Purchase Rate, System Blacklist Count, Avg Days Between Orders. Formula: not extracted.

Financial Reports (SEEN-CODE `ReportsPages`)
- CAC = marketing spend / new customers. LTV = settled revenue / new customers. LTV:CAC = LTV / CAC. OpEx Ratio = OpEx / realized revenue x 100. Contribution Margin = (realized - (COGS + shipping + RTO waste)) / realized x 100. Net Margin = retained profit / realized x 100.

Sales Report / Delivery Performance / Top Products / Income Statement
- Total Delivered, Total Orders, Delivery rate (e.g. 51/93 = 54.8%), Total Expenses = cost + delivery + opex, Net Profit and margin (e.g. NGN 329,113 = 25.9%); per product: orders, units, amount, delivered orders/units/amount, delivered %, cancelled # / amount / %, cost. SEEN.
- Top Selling Products: Global Contribution Margin, Most Demanded Category, RTO Capital Sink (capital lost to rejections), Average Order Value; per SKU: delivery success, RTO units, COGS, realized revenue, Net SKU profit. SEEN.
- Income Statement: Realized Net Revenue, COGS, Logistical Waste (RTO pool), Net Profit Margin = net retained profit / realized revenue. SEEN.

Marketing
- Ads ROI: Realized ROAS = realized net revenue / ad spend; CPDO = ad spend / delivered orders; Ad Spend Burn Exhaustion = spend in period / lifetime logged spend; Marketing Drag Rate = ad spend as % of gross revenue; per campaign CPL, dispatched, delivered/paid, CPDO, realized revenue, ROAS, with leads/dispatched/paid allocated by spend share (SEEN-CODE) and a "Shutdown ROAS <" threshold input (default 2). 
- Funnel: Landing page -> Order (submissions / page views; computed from the order list, so shows 100% in the demo), Order Confirmation (verified orders / submitted), Delivery Agents Success (paid deliveries / packages handed to agents), Global Funnel Efficiency (settled / page views = 41.7% demo); stages Page Views, Form Submitted, Verified Orders, Dispatched Packages, Delivered & Settled with "dropped here" % and leakage total. SEEN-CODE (`FunnelAnalyticsPage`).

Operations
- Agent Performance: Active Agents, Avg Success Rate = delivered / assigned (incl. Cash Remitted + After-Sale Followup), Avg Return Rate = returned / assigned, Avg Time to Deliver (assigned timestamp to delivered timestamp). SEEN.
- Failed Deliveries: Total RTO volume, Blended Delivery Success Rate, Total Sunk Logistics Capital, root-cause distribution, Agents Efficiency Matrix (RTO ratio, flag > 15%). SEEN.
- Staff Analytics: Active Operational Headcount, Global Verification Conversion Rate (verified / inbound assigned), Blended Handling Time (AHT); per staff conversion %, avg handling time, active file load, calls, WhatsApp chats. SEEN.
- Weekly Team Report: Orders received, Assignments this week, Orders delivered, Revenue delivered; per member: received, assigned in period, in period, processed, delivered, delivery rate, units, revenue. SEEN.
- Staff Earnings: Gross Payroll, Base Salaries, Accrued Incentives, Staff Cost per Order = internal payroll / processed orders, performance to target. SEEN.
- Daily Business Summary: Gross Revenue, Cash Settled, Net Burn = expenses - settled, New/Confirmed/Delivered/RTO orders vs prior day, 1st/2nd/Repeat customers, Verification Rate (new orders progressed past Pending), Delivery Success (delivered / resolved), Remittance Batches confirmed today, Top 5 Products, Top 5 States, Anomalies & Alerts. SEEN.

Finance / executive
- CEO Dashboard: Bank-cleared cash, Field Float (delivered, not yet remitted), Office Cash Drawer (remitted, not banked), Total Working Capital = bank + float + drawer, Settled vs Pipeline capital (30/90/365 d), Structural Vault Allocation, Runway, Realized ROAS (30 d), Fulfillment Velocity, Delivery Success (e.g. 119/142 dispatched), Burn vs Inflow pulse; draggable widgets with "Customize widgets". SEEN.
- Cash Inflow: Doorstep collections today, Active Agent Float, Overdue Field Float (> 48 h). Agents Remittance: Total Cash Collected, Delivery Fees Retained, Expected, Confirmed, Pending. Cash Flow: Net Cash Flow, Cash in Bank, Cash in Field, Operating Cash Burn (avg weekly outflow). Balance Sheet: Working Capital, Current Ratio, Total Net Worth. Bank Inflow: Pending verifications, Confirmed income pool, next distribution countdown. SEEN.
- Revenue Leak: Total leakage, Recoverable, Sunk, Leak % of revenue (43.3% in demo); categories: Unremitted cash (delivered, not in batch), Cancelled after confirmation, Refund/returned value, RTO capital sink, Unconfirmed remittances, Audit shrinkage (off-book stock), Abandoned carts. SEEN.

## 5. Data model (summary; full field lists in `api.md`)
Document-in-JSONB style: `orders`, `products`, `forms`, `product_categories`, `app_settings`, `message_templates` store most fields in a `data` JSONB column keyed by `owner_id` (+ `branch_id`), with a few relational columns (`order_id`, `row_id`, `created_at`, `updated_at`). Relational tables hold the rest: `agents`, `agent_remittances` (+ `agent_remittance_orders`), `incoming_stock` / `outgoing_stock` / `returned_stock` / `stock_audits`, `suppliers` / `purchase_orders` / `supplier_payments`, `expenses` / `expense_types`, `bank_accounts` / `structural_accounts` / `bank_statement_entries` / `disbursement_reports`, `app_users` (commission and salary fields) / `user_assignments` / `app_user_branches` / `roles` JSON, `payroll_runs` / `payslips` / `deductions` / `allowances` / `staff_loans`, `branches`, `customer_blacklist` / `ip_blacklist` / `order_fraud_flags`, `whatsapp*` / `sms_provider_instances` / `payment_gateway_instances` / `ecommerce_platform_instances` / `drip_*` / `email_*`, `api_keys` / `outgoing_webhooks` / `webhook_deliveries`, `support_tickets` / `refund_requests` / `disputes` / `feature_requests`, `wallets` / `wallet_transactions` / `subscriptions`, `audit_log`. Central entity relations: order -> form -> product/price point (+ bump/upsell parent), order -> assignedTo (app_user) and processedBy, order -> agent -> remittance bundle -> bank statement entry, outgoing stock -> agent -> sold (derived from delivered orders). SEEN.
Customers have no table: they are derived on the fly from orders (grouped by phone, fallback email+name; `customer_tiers` RPC). SEEN-CODE (`CustomersPage`).

## 6. Roles and permissions
- 9 system roles (SEEN-CODE and `screens/users-roles-and-permissions.jpg`): Administrator, Supervisor, Sales Rep, Inventory Manager, Social Media Staff, Accountant, Marketer/Media Buyer, Customer Support, Delivery Agent. Plus owner (store owner is not a role). Custom roles are cloned from a system role (`baseRole`); roles can be renamed, deleted if custom.
- Permission grid: per menu item and per order tab, each with View / Add / Edit / Export / Delete. Delivery Agent default = only `agent-orders`, `agent-remittances`, `logout`.
- Capability flags per role: canAddTab, canManageTabs, canAssignOrders, canRevertOrders, canBanIp, canBulkMoveOrders, canAddTag, canViewSalesPerformance, canCorrectInventory, canViewProductCostPrice, addFollowUpRole; defaults on for Administrator and Supervisor only (e.g. revert, ban IP, view cost price).
- Data protection toggles per role: protectCustomers, protectFinancial, protectCustomersOrders, protectFinancialOrders (values masked as asterisks). Default OFF.
- Scoping: sales reps see assigned orders only by default; supervisors see their reps' orders; product, agent, state, form, user assignments gate what is visible; branch sharing applies.
- Users screen: name, email (+ "Email status" with BLOCKED/Re-enable), role, phone, WhatsApp, country, branch, status, last login, assigned products/agents/users, salary, bonus, targets (M/B/U), commission, Add user, Add new role, duplicate user, force logout. Global unique email across all stores (claimed).

## 7. Integrations
See 3.13 and api.md section 6. Notable: no delivery/courier API, no accounting export (CSV/Excel/PDF only), no native Meta Ads creation or audience sync beyond spend pull and CAPI. SEEN.

## 8. Pricing
- Live (marketing CMS `raw/landing-cms-home.json` and wallet screen, SEEN): **Basic** NGN 12,000/mo or NGN 115,000/yr (badge "You save NGN 29,000 a year, 21% off"): 5 products, 5 forms, 5 users, email notification system, inventory management, cart abandonment. **Big Boss** NGN 15,000/mo or NGN 145,000/yr: unlimited products/forms/users, everything in Basic, priority support, Delivery Agents Directory (listed in the CMS features). **Enterprise** NGN 2,500,000 lifetime: Sniper software on your own server and domain, dedicated success manager; contact via WhatsApp.
- 7-day free trial, no card (`/signup`). Migrated SniperCRM users get a 30-day bonus (claimed).
- Pay-as-you-go extras: SMS credits (wallet), WhatsApp service licence per number, Email Service add-on, WhatsApp "Basic: 200 messages/day, Premium: unlimited" appears in the stale static HTML only.
- The stale static HTML at `/home` (curl) lists Free $0 / Basic $79 / Big Boss $199; the live page overrides it from the CMS. Treat the static values as outdated. GUESS: leftovers from an earlier template.

## 9. Tech stack
- Frontend: Vite build (hashed `/assets/index-<hash>.js`, 225 lazy chunks), React 18.3.1, React Router, shadcn/ui on Radix primitives, Tailwind, lucide-react icons, Inter + IBM Plex Mono fonts, PWA manifest + Capacitor mention (mobile shell). SEEN-CODE.
- Generated with **Lovable** (og:image on `gpt-engineer-file-uploads`, `/__l5e/events` script, `lovable.dev` string, project id in a context token). SEEN.
- Backend: Supabase (Postgres + PostgREST + Auth + Edge Functions). No Node/Express app server. SEEN. RLS per `owner_id` claimed. Heavy logic lives in SQL RPCs (over 100 named functions) and edge functions (about 40). SEEN-CODE.
- Hosting/edge: Cloudflare (`server: cloudflare`, `__cf_bm` cookie), HSTS. SEEN.
- Payments: Paystack inline JS, Flutterwave v3 JS, Stripe; analytics: Facebook pixel loader, TikTok pixel events, ipify for IP, CoinGecko for crypto rates. SEEN-CODE.
- API style: PostgREST queries + RPC, JWT bearer from Supabase auth; no versioned public API except the Order API/webhooks.
- Data-in-browser: "No app data kept in browser storage" (claimed); preferences stored server-side (`bootstrap_session.prefs`). SEEN.

## 10. UX notes
Good:
- One left sidebar with group headers, filterable, pinnable items, global command search (Ctrl/Cmd K), per-user theme (Light / Semi / Dark), text-size control, branch switcher, fullscreen, notifications. SEEN.
- Every report page has the same period selector + help tip; KPI cards carry a one-line definition ("Total delivered / settled revenue ..."), which teaches the metric.
- Orders table is a real work surface: sticky actions, copy ID, call and WhatsApp icons, "day in status", Excel/PDF export, column chooser with drag order, custom tabs.
- Opinionated POD vocabulary (float, remittance, RTO, "not picking calls") that matches the market.
- Risky features are opt-in and each has a plain-English explanation.

Bad / friction:
- 150+ menu items; the owner sees mostly empty modules. Long orders filter panel pushes the table far below the fold (the status tabs and table start about 900 px down).
- Mixed UI languages: some pages use plain labels, others dramatic naming ("Executive Control Room", "Structural Vault").
- Several empty-state pages show NGN 0 because prerequisites (delivery fee sets, ad spend sync, bank accounts) are not configured; there is no setup checklist beyond onboarding.
- Dense mono-caps micro labels at small sizes; dark theme is default.
- The mobile routes crash when opened without the app shell (`useRoles must be inside RolesProvider`).
- Demo data inconsistencies (see 12 item 3) reduce trust in numbers.
- Tool-tip level documentation duplicated in a huge in-app User Guide (editable by super admins).

## 11. Strengths
1. End-to-end POD accounting: float, remittance, bank match, structural vault split, three statements. Nothing else in the Nigerian COD tooling market that we saw does this.
2. Anti-fraud suite aimed at the real losses (agent cash holding, stock swapping, fake commission orders).
3. Fair order distribution with auditable assignment page, commission tied to delivered outcomes, two-way credit.
4. Wide integration surface (30+ named providers) and an open Order API + webhooks.
5. Shared delivery-agent directory creates a network effect (10.7k agents).
6. Fast iteration: Lovable + Supabase lets a small team ship 150 screens; an in-app roadmap with voting.
7. Self-hosted enterprise option (NGN 2.5M lifetime) as a lock-in release valve.

## 12. Weaknesses and gaps (our opportunities)
1. **No courier integrations**: Delivery Providers is a stub; no tracking links, label printing, status sync from 3PL, or auto-dispatch. For COD sellers using Gigl/Kwik/Jumia-style partners this is a manual loop. (SEEN stub.)
2. **AI Sales Rep, Sales by Channel, Repeat Purchase, Video Guides are vapor** in the menu. (SEEN.)
3. **Approximate analytics**: ad-to-lead attribution is pro-rated by spend, funnel page views derived from orders. Also negative "left" quantities on variations in Stock with Agents (-4, -1, -2 ...), office stock "Sold 0" despite delivered orders, structural account percentages summing to 107%, funnel at 100% landing-to-order. (SEEN in demo; demo data may be synthetic, so partly GUESS that production behaves the same.)
4. **Architecture risk**: business logic and authorisation in client-callable RPCs, purge-on-load DELETE from the browser, client-side API-key generation, assignment sweep triggered from the browser. SEEN-CODE. Correctness of RLS not tested (GUESS risk).
5. **Cart-abandonment and "page views"** are inferred from orders rather than real session tracking (SEEN-CODE for page views).
6. **UI weight**: dense, enterprise-style, owner-centric; the mobile experience for owners/reps is unverified (mobile shell is driver/staff only, and crashed when opened directly).
7. **Pricing gating**: 5 users / 5 products on Basic is restrictive for call-centre teams; Agents Directory and some features gated behind yearly plans.
8. **Generic onboarding**: demo owner lands on empty modules; zero guided setup for the 7+ prerequisites.
9. **Duplicate/overlapping surfaces**: "Customers" + "Customer Analytics" + "Users"; "Agents" + "Agents Directory" + "Agent Performance" + "Agent Earnings" + "Agents Remittance" - discoverability cost.
10. **Documentation sprawl**: guide text and screen help overlap and contradict static marketing pricing.

## 13. Ideas for CodAdmin (derived, GUESS-level prioritisation)
- Match the POD loop (float ageing, remittance bundle, bank match) but make it one screen with a daily "who owes me cash" list.
- Ship courier/3PL status sync and tracking (Sniper's biggest hole).
- Use real session/page-view tracking for funnel; compute ROAS from real campaign-order attribution.
- Keep fraud controls but default-on lightweight ones (duplicate phone window, blacklist) rather than all-off.
- Offer variation-level stock that cannot go negative, with agent stock reconciliation.
- Provide an owner mobile view.

## 14. Unknowns (not accessed)
- Any logged-in non-owner experience (rep, delivery agent, accountant). The public demo only gives the Demo Owner; mobile routes `/m/driver` and `/m/staff` could not be opened standalone.
- Super Admin pages (subscribers, SaaS metrics, revenue, secrets): code only.
- Real production data volumes, performance, uptime.
- Actual behaviour of the fraud shields, dual-token flow, AI features, WhatsApp provisioning, Paystack DVA: described in UI/guide, not triggered (no writes allowed).
- Response bodies over 64 KiB (orders list, customers tiers), websocket traffic, storage.
- Pages not opened in the browser (marked "SEEN in code only" in the table): User Guide, My Orders, My Remittances, Supplier Payments, Referrals, Payslips, Compliance, Banking Reports, Inventory Reports, Top Selling States, My Performance, Processed Refunds, Google Sheets, Google Contacts, Book a Session, Bugs & Fixes, Product Reviews settings, Custom States.
- RLS correctness, rate limits, and security posture (out of scope, not tested).
- Whether the static `$0/$79/$199` pricing was ever live.

## 15. Method (REA tools vs fallback)
REA tools actually run (Evidence IDs):
| Tool | Evidence ID | What it gave |
|---|---|---|
| `capture_browser_scenario` (launch headless Chrome, network + request bodies) | `ev_a15d42461e8dd0ae638c9c0d7bfe38f4ad52bbf695e8868a7ac1b17db76a32b7` | Demo-entry flow, 338 requests, decoded RPC request shapes (orders_page_rows, dashboard_overview, customer_tiers...), console output |
| `capture_browser_scenario` (same, plus response bodies, 8 pages) | `ev_addadcd9f408cef94d9654664584a08116972f5354c89461a6aa31c468379a61` | 43 distinct endpoints with JSON response shapes and live rows -> `api.md`, `api-shapes.json` |
| `analyze_javascript_application` (summary) over the 225 downloaded chunks | `ev_439ef6c82cc0371b9904c11b29c3052795e4fb4f593baa52631f12d3c5623f4d` (parent `ev_1bf785651f9d2a647a7166fa5c30d359755c9b27313e837e563fd69204a09be0`) | Inventory of 225 files, 5.7 MB, 12,314 findings; coverage partial because of result-budget limits |
| `trace_application_feature` (route seed) | `ev_4d565304337cfa897b76535fbe27206c76fe25e91037113fb9849fed9a64a3af` | No match: REA's graph does not represent React Router, so the route list and menu config were extracted by direct text search of the same files |

Fallback tools and why:
- `claude-in-chrome` (a real Chrome tab) for all 101 screenshots and live DOM text: REA's `capture_web_screenshot` needs an already-open CDP page target, and `capture_browser_scenario` returns everything as inline JSON (one 8-page run was about 2.3 million characters, saved to a file by the harness), so an interactive tab was simpler for ~100 screenshots. The demo session in that tab came from the public `/sniperdemo` link (no credentials). I clicked only navigation items, one row action menu, one bulk-action dropdown, the Add Order dialog (closed with Escape), the form editor (left without saving) and read-only accordions.
- `curl` to download the public JS chunks and the marketing CMS JSON (needed because `export_web_scripts` requires a saved `inspect_web_page` capture, which needs a loopback CDP endpoint that I did not open).
- Not used: `analyze_web_bundle`, `export_web_scripts`, `inspect_web_page`, `observe_web_session` (all need a loopback CDP endpoint of an already-running Chrome); `inspect_web_network_capture` (needs a HAR/SAZ file; REA's own capture JSON was parsed with jq/python instead).
- One thing to note about my own traffic: the headless REA captures each entered the demo store through the public demo flow, so two extra demo sessions exist; the page issued its own purge `DELETE` on soft-deleted forms (204) as part of loading, I did not issue it.
