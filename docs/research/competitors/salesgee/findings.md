I couldn't save `findings.md`. The file-write tool refused it with "Subagents should return findings as text, not write report files". I didn't work around that block, so the full report is in this message. `api.md` saved fine. Everything is under `/Users/mac/work/codadmin/docs/research/competitors/salesgee/`. Two caveats up front:

- **The demo makes no API calls.** It is a fake in-browser app with seeded data, so there are no live API responses to capture. I read the API calls and data shapes from the shipped code instead.
- **The REA body-level network capture failed.** My REA bodies attempt (`capture_browser_scenario` with request/response bodies) failed 4 times: 2 `target_not_allowed` errors and 2 hangs of 30 minutes each. I stopped after that.

## Summary of findings

1. **What it is.** SalesGee is a COD-style order CRM for African sellers. The loop is: Sales Forms capture orders, round-robin assigns them to reps, 13 call-center statuses track them, delivery agents hold stock, a manifest records remittance, then reports and staff earnings. It also has a storefront, a Paystack wallet and SMS/email marketing. WhatsApp automation is shown as "Coming soon". (SEEN)
2. **Stack.** It is a WordPress plugin (`salesgee-crm` v1.0.410) with a React 18 single-file app loaded from unpkg. Calls go to `/wp-admin/admin-ajax.php` as `action=sgcrm_*` with a nonce and an admin token. There is no URL router, so you cannot deep-link a screen. (SEEN)
3. **Storage.** The browser holds whole collections and autosaves them as JSON blobs (`sgcrm_save {key,data}`, 800 ms debounce). Orders load up to 2,000 at a time. That is a scaling and overwrite-race risk. The code has an "allow empty overwrite" guard and 5 manual Restore Points to cope. (SEEN; the overwrite-race risk is my inference.)
4. **The demo is mock data.** It has 130,000 identical Delivered orders at ₦30,000, 5 staff, 4 agents and 3 forms. Payments, SMS, Woo and CSV import are disabled, so KPIs read 100%. (SEEN)
5. **Statuses.** Pending, In Transit, Rescheduled, Not Available, Call Back, Rejected, Number Busy, Switched Off, Not Answering, Not Ready, Cancelled, Delivered, Follow Up, plus custom ones. (SEEN)
6. **Stock model.** Office stock plus agent stock plus in-transit. Stock reaches an agent only when a Waybill is marked Delivered. Agent stock = waybills in − delivered orders − waybills out − faulty. Combo products have no stock of their own. (SEEN)
7. **Remittance is manual per order.** The Order Manifest asks for a delivery charge, then "Remit" posts an income row (amount − charge) and a Logistics expense row. Undo reverses both. There is no agent cash ledger and no bank/MoMo reconciliation. (SEEN)
8. **Fraud control.** The only control is a "prevent same-day duplicate orders" switch (same phone or email, same day). I found no scoring, blacklist or address check. (SEEN)
9. **Roles.** There are 8 locked system roles plus custom roles. Permissions are per page and per sub-page, with None/View/Edit/Delete and extra flags for assign, import/export and switch business. Staff pay is salary plus role-based target rewards paid from the wallet, and there is a leaderboard. (SEEN)
10. **KPI formulas** (all SEEN, in `findings` section 4 below):
    - Delivery Rate = delivered ÷ total.
    - Net Profit = sales revenue + other income − expenses.
    - Cancel Rate = (Cancelled + Rejected) ÷ total.
    - Agent rate = delivered ÷ attempts.
    - Low stock = office stock ≤ 10.
    - The dashboard Delivery Rate divides delivered-today by created-today, which mixes cohorts.
11. **Pricing disagrees across sources.** The marketing page shows Scale ₦55k, Platinum ₦90k and Elite ₦180k per 6 months. The app's embedded license shows Scale ₦12.5k/mo (₦95k/yr), Platinum ₦20k/mo (₦150k/yr) and Enterprise ₦1.5M/yr. `/Enterprise` says "from ₦950k". There is no free plan or trial. The affiliate program pays 40%.
12. **Gaps CodAdmin can beat.**
    - No courier or 3PL API, rider app or tracking.
    - No per-state delivery fee table.
    - No call logging or telephony.
    - No Meta Pixel/CAPI per form.
    - No AI features.
    - Ghana is in the country list but the order states are Nigerian.
    - The marketing site claims Product Hunt reselling, Team Chat, Cart Abandonment Recovery and a Sales Page Builder. I saw none of them in the app.

## Screen inventory

The app has 14 sidebar items and no per-screen URLs. All screenshots are in `screens/`.

| Menu | Sub-pages | Notes |
|---|---|---|
| Dashboard | none | 4 KPI cards, trend, status chart, recent orders, top products, low stock, top staff. Staff users get a personal version. |
| My Store | Storefront, Products, Checkout | Storefront has identity/theme/homepage/footer/commerce settings. Checkout has Paystack and COD. |
| Orders | tabs: All, Today, Yesterday, Due Today, Upsells, Trash | Filters, bulk select, row menu (View, Copy, Edit, Add Upsell, Assign Staff, Call, WhatsApp, Invoice, Trash), New Order dialog. |
| Inventory & Stock | Products, Product Analytics, Buy Stock, Stock Record, Agent Stock, Waybill, Faulty Stock | Add Product asks Simple vs Combo. |
| Agents | Agent List, Agent Performance | |
| Finance | Income, Expenses, Order Manifest, Stock Worth | |
| Wallet | none | Paystack fund/withdraw; withdrawal needs a PIN and admin approval. |
| Staff Earnings | none | Hidden under Staff Management for non-admins. |
| Marketing | Campaign Tracking, Email Marketing, WhatsApp Automation (coming soon), SMS Automation | Email has a drag-block builder. |
| Staff Management | Staff List, Roles & Permissions, Staff Performance | Set Target dialog on Staff Performance. |
| Reports | none | |
| Connections | Sales Forms, WooCommerce, Elementor Form | The form editor is a hidden sub-screen (Basic / Fields / Design tabs, live preview). |
| Customer Service | Customers, Follow-ups | |
| Settings | none (one long page) | Assignment, statuses, notifications, Restore Points, danger zone. |
| Hidden header menu | Leadership Board, Productivity, Billing, Documentation, Support ticket | Documentation has 40+ articles. |

Marketing site routes (from REA): `/`, `/Register`, `/ForgotPassword`, `/Contact`, `/Affiliate`, `/Articles`, `/Articles/:slug`, `/Pricing`, `/Solutions`, `/Enterprise`, `/Checkout` and `/checkout/summary|details|verify|done`, `/privacy-policy`, `/terms-of-use`. The vendor's own admin sits at `/admin` with `blog`, `pricing`, `onboarding`, `bulk-email`, `finance`, `meta-pixels`, `tiktok-pixels` and `affiliates`; I did not open it. The marketing site is built on Base44 and uses Paystack, Flutterwave, Meta Pixel and TikTok Pixel.

## Features and how they work

- **Orders.** Sources are manual entry, Sales Form, WooCommerce, Elementor and CSV import. Row badges show UPSELL, WOO and COMBO.
  - Bulk status change and bulk assign exist. Setting Delivered stamps the delivery date and asks which stock source to deduct from.
  - Free gifts, upsells, comments, Copy Order and Trash with Restore are supported.
- **Assignment.** Round-robin over staff of a chosen role, with optional per-product override rules. (SEEN)
- **Sales forms.** A form is a product plus offer tiers, a marketer, fields and design.
  - Output is a hosted page at `/?sgcrm_embed=<id>`, a share link or embed code. Optional Paystack payment goes to the owner's SalesGee wallet.
  - It is not a page builder.
- **Storefront.** `/shop` with a cart and `/shop/checkout`, no customer login. Card or COD. A setting decides who pays the gateway fee.
- **Call center.** There is no softphone or call log. Call-center states are order statuses. Customer Service has follow-up buckets (Overdue, Today, Tomorrow, This Week, Completed). "Call" is probably a `tel:` link (GUESS).
- **Logistics.** An agent is a stock holder per state. There is no courier API or tracking.
- **SMS.** Central gateway with credits and an approved sender name. Bulk campaigns filter by status and product; workflows trigger on New order, Confirmed, In Transit, Delivered, Cancelled and Failed Delivery. 160-character limit.
- **Email.** Credits plus a block builder.
- **Customers.** Derived from orders by phone. Statuses are Active, VIP, Lapsed and New.
- **Staff.** Salary plus targets by role. A reward only unlocks when the goal is fully met.
- **Integrations.** WooCommerce (REST keys, webhook, status mapping, product pull, activity log), Elementor webhook, Paystack, and a SalesGee admin connector (Scale and above).
- **Plan gating.** Feature flags and limits by plan, including multi-business only on Platinum and above.

## KPI list

The formulas below are read from client code. The campaign ROI, CPC and Leadership Board score formulas were not read.

- **Dashboard:** Today's Orders, Today's Revenue (Delivered orders with delivered date today), Pending Orders (all-time Pending), Delivery Rate (delivered today ÷ created today × 100), vs-yesterday deltas, Order Status counts, Top Products (7d, by units), Low Stock (office stock ≤ 10), Top Staff (7d).
- **Orders page:** Delivered Today, In Transit Now, Pending Orders, Today's Order Worth.
- **Reports:**
  - Total Orders, Delivered, Pending/Undelivered (= total − delivered), Delivery Rate.
  - Total Revenue, Avg Order Value (revenue ÷ delivered), Net Profit (revenue + other income − expenses), Cancel Rate ((Cancelled + Rejected) ÷ total).
  - Unique Customers, Repeat Rate (repeat ÷ unique), Total Expenses, Other Income.
  - Revenue Trend, Financial Summary, Expenses by Category, Status Distribution, Top States, Top Products (units and revenue), Staff Performance, Top Delivery Agents (rate = delivered ÷ attempts), Top Customers.
- **Agent Performance:** Total Deliveries, Delivered, Revenue, Delivery Rate, Top Agent. Per agent: Assigned, Delivered, In Transit, Cancelled.
- **Staff Performance:** Total Orders, Delivered, Team Revenue, Team Rate, Top Performer.
- **Finance:** Income and Expenses (this month, all-time, average, largest, by category), Stock Worth (selling value, cost value, potential profit, margin), Awaiting Remit, Pending Settlement.
- **Campaigns:** Budget, Generated, Delivered, Revenue, CPC, ROI.
- **Customer Service:** Total, Active, VIP, Pending Follow-ups.
- **Wallet:** Available Balance, Total In, Total Out.

## Data model

Full field lists are in `api.md`. The main entities are:

- **Order:** has `items[]`, `upsells[]`, `comments[]`, a source, `assignedTo`, `deliveryAgent`, `deliveredDate`, and remittance fields.
- **Product:** simple or combo, with offer tiers and gifts.
- **Others:** Agent, Staff, Waybill, StockPurchase, FaultLog, Income, Expense, Form, Campaign, Business, StoreSettings, CustomerProfile (keyed by phone), FollowUp, Payout, RoleTargets, CustomRole, Productivity, Snapshot.

Links between records use names or id strings that are not enforced, and the code has fuzzy product-name matching as a fallback. Renaming a product or staff member can break the match. (SEEN)

## Roles

- **System roles:** Manager, Operations Manager, HR, Marketer, Sales Rep, Accountant, Customer Care and Inventory Manager, all locked, plus Admin with `*`.
- **Custom roles:** supported.
- **Permission keys:** `orders`, `sub:inventory:Waybill`, plus `:edit` and `:delete` suffixes.
- **Staff invites:** staff get an email with their login details.
- **Passwords:** the demo seed shows staff passwords in plain text in the data. Whether the real server hashes them is unknown.

## Integrations

WooCommerce, Elementor, Paystack, the SalesGee SMS gateway and the vendor's admin connector. Meta and TikTok pixels exist only on the vendor's own site.

## Pricing

See point 11 above. The marketing Monthly and Yearly toggle values were not seen because my scripted click did not switch tabs.

## Tech stack

See point 2 above. Also: React 18.3.1 UMD from unpkg, inline styles, Inter font, brand teal `#007e8e`, and a PWA with polling for presence and new orders. The Settings screen says "V1.0.2" while the build is 1.0.410.

## UX notes

**Good:**
- Big KPI tiles and distinct status colours.
- Collapsible sidebar, Ctrl+K search, dark mode, installable PWA.
- Short New Order dialog with free gifts built in.
- Sales form editor with live preview.
- In-app docs and Restore Points.

**Bad:**
- No URL per screen, so no back button or bookmarks.
- Settings is one very long page.
- Staff Earnings moves between menus depending on who is logged in.
- The status list is inconsistent: SMS targeting adds Confirmed, Processing, Packed, Shipped, Returned and Failed Delivery to the 13 in Settings.
- The Income pagination shows absurd totals ("1 / 156000000"), a demo-data bug.

## Strengths

- One product covers the full COD loop.
- Round-robin assignment with role filter and per-product rules, plus the duplicate-order switch.
- Agent-held stock with waybills, faulty stock and stock worth matches Nigerian COD logistics.
- Staff targets and a leaderboard.
- Many countries and currencies in Settings.
- Cheap entry price and a 40% affiliate program.

## Unknowns

- The real server: live JSON, database schema, auth hardening and password hashing.
- Any real tenant: no login was offered, so I did not try. Note the demo page config says `adminConfigured:false, setupAllowed:true`. That is an admin-setup path, and I did not touch it.
- The vendor `/admin`, the public `/shop` and public form pages, the staff login screen.
- Campaign ROI/CPC and Leadership Board score formulas, and the exact stock-deduction code on Delivered.
- Business picker, notification bell and Ctrl+K results (no screenshots), and the Invoice output.
- The Faulty Stock dialog: my click did not open it, so its fields (`product, source, qty, date, reason`) come from code only.
- Article bodies and the legal pages on the marketing site.
- I read the 1.2 MB bundle through targeted greps, not line by line.

## REA evidence IDs (for the Method section of `findings.md`)

These ran as REA tools:
- `capture_browser_scenario` on the demo load (network events, screenshot): `ev_de1dca81f3adea67b4cfbc20b42f6d80f0cd403939cdfcb47d4059a69b5cb43c`. It showed only static GETs and no XHR.
- `analyze_web_bundle` on the demo: `ev_b043a91d37a2da267d32be99c9a085fa9725e4869875ebbe1621097bc6d8672c`. It found no routes because the app has no router, and the endpoint candidates were false positives.
- `inspect_web_page` with script sources: `ev_92c0f5be13d24eed41e088dfa37dfdd4f86f0287c4d786f9abc7122ad17061d9`.
- `export_web_scripts`: `ev_67e706cd5e2917d290bad0026ae36658be0f941f5ad9c4e33c8bd07d03e5842c`.
- `analyze_javascript_application` summary: `ev_d88643ba46a96a208c6628b3408ce93668138eb4f9d615004b98c70a9af488b0` (parent `ev_656c543818b2cbe9d7e608a2782ec78e5223d0df54cb857c757cb5031be3c0b0`). It parsed 296,800 AST nodes and recovered 0 fetch calls because the calls are wrapped.
- `analyze_web_bundle` on the marketing site: `ev_201976c6dce9e5f038ca873cf7417f6e5c6d23a1bc7447d66a08532bc9355e19`. It recovered the full router (24 route entries).

The rest used fallbacks:
- **Screenshots and per-screen text:** my own Node scripts over the Chrome DevTools Protocol. REA returns screenshots as inline base64, so clicking through 40+ screens was too costly.
- **API and data model:** `curl` plus `prettier` plus `grep` on the bundle, because the code contains what the network would have shown.

## Files saved

All paths are under `/Users/mac/work/codadmin/docs/research/competitors/salesgee/`.
- `api.md`: transport, the ~90 `sgcrm_*` actions, response shapes, data model, and the marketing site's backend.
- `screens/`: 76 PNGs, covering every nav screen and sub-page, the form editor, modals, the hidden header-menu pages and the marketing pages.
- `evidence/ui-text/`: page text for each screen.
- `evidence/app.1.0.410.pretty.js`: the formatted bundle (3.2 MB). Line numbers I cited point into it.
- `evidence/shot.mjs` and `evidence/site.mjs`: the CDP scripts I used.
- **Not saved:** `findings.md`, for the reason above. If you want the file, say so and I'll look for another way to save it.

## What I could not access

- The real backend and any logged-in tenant, because the demo is offline.
- The vendor `/admin`, public `/shop`, public sales-form pages, and the staff login page.
- Live network JSON through REA. The scripted tab clicks that switch the pricing toggle did not work.
- The scripted click for the Faulty Stock dialog did not open it.
- The demo order data is degenerate (everything Delivered), so real behaviour of the other statuses is only documented in code, docs and settings.
