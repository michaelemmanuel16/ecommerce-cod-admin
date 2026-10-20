# CodAdmin rebuild: gap matrix (current app vs v2 mockups)

Date: 2026-10-18. PRD prep. Built from the three inventories, the design doc and `NUMBERS.md`. No code or mockup was changed.

## How to read this

Verdicts:
- **KEEP as-is**: no change. Logic and look stay.
- **KEEP+RESTYLE**: same logic, new v2 look.
- **CHANGE**: feature stays, behaviour or layout changes.
- **NEW**: no current feature. Mockup adds it.
- **DROP**: remove. Reason is in Notes.
- **MISSING-IN-MOCKUP**: exists in the current app. No mockup screen covers it. This is the main risk. Each needs a decision in the PRD: add a mockup, or cut it on purpose.

Locked decisions used (owner, 18 Oct): English-only agent app first. Landed cost on counted units. Build "By region" assign. COD only, no Ghana online pay now. Float money columns become Decimal in M0. Aug and Sep stay as booked, with a note. Time to first call target 15 min, alert at 30 min. Order state machine rebuilt in M1. Multi-store dropped until SaaS. Paid digital orders count as delivered revenue. Free bundled items do not. No airtime reward, cash tiers only. Rewards live only in Settings, Rewards. AOV is computed. North Star has a planned AOV (default last 30 days, editable). Store currency locks after the first sale. Extra currencies: daily auto rate, manual override, per-day history. Stale warning only for manual rates.

Mockup screen names: `index#dash`, `index#orders`, `index#targets`, `index#board`, `index#onboard`, `rep.html`, `agent.html`, `inbox.html`, `customers.html`, `checkout-forms.html`, `messages.html`, `products.html`, `inventory.html`, `deliveries.html`, `finance.html`, `marketing.html`, `reports.html`, `staff.html`, `workflows.html`, `connections.html`, `settings.html`.

---

## 1. Feature matrix

### 1.1 Shell and navigation

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| SH-01 Sidebar groups (Sell, Stock, Money, Team, Setup, Inbox) | `Sidebar.tsx`, 12 flat items | Shared shell | CHANGE | New grouping. "Set up North Star" link stays until setup is done. |
| SH-02 Menu filtered by role | `usePermissions.canAccessMenu` | — (owner view only) | MISSING-IN-MOCKUP | Mockup shows only the owner. Add menu rules for Finance clerk, Stock keeper, Marketing, manager, accountant. |
| SH-03 Collapsible sidebar | `sidebarCollapsed` in localStorage | — | KEEP+RESTYLE | Not shown. Keep. |
| SH-04 Header search | Decorative input, no handler | Command palette (cmd+K) | CHANGE | Wire to real search: orders, customers, phones. |
| SH-05 Notification bell | `NotificationBell`, in-memory | Bell goes to Inbox | CHANGE | Bell reads `Notification` rows, not memory. |
| SH-06 User menu | `UserMenu` (Settings, Logout) | Avatar (dead) | CHANGE | Menu: Profile, Security, Sign out. |
| SH-07 Platform announcement banner | `AnnouncementBanner` | — | MISSING-IN-MOCKUP | Keep. Restyle. Platform admin still posts them. |
| SH-08 Pending plan banner | `PendingPlanBanner` | — | MISSING-IN-MOCKUP | SaaS item. Hide for the owner tenant. |
| SH-09 Sales-rep onboarding tour | `components/onboarding` | — | DROP | Rep app replaces it. |
| SH-10 Rep Help menu | Header | — | DROP | Same reason. |
| SH-11 PWA update prompt | `UpdatePrompt` | — | MISSING-IN-MOCKUP | Keep. Restyle toast. |
| SH-12 Error boundary and 404 | `ErrorBoundary` | — | MISSING-IN-MOCKUP | Keep. Restyle. |
| SH-13 Store chip "2 stores" | — | Shared shell (dead) | DROP | Multi-store dropped until SaaS. |
| SH-14 Me chip "all roles" | — | Shared shell (dead) | CHANGE | Show name and role names. |
| SH-15 Dark mode | — | Top bar toggle | NEW | Tokens from `app.css`. |
| SH-16 Command palette | — | Shared shell | NEW | "Record a 3PL payout" and "Start a stock count" must work. |
| SH-17 AI drawer | — | Shared shell | NEW | Read-only. One text source for all pages. |
| SH-18 "Mobile View" switch for agents | Sidebar button, `MOBILE_OPT_IN` | — | DROP | Agent phone app is separate. |
| SH-19 Realtime refresh (socket.io) | Stores | — | KEEP as-is | Scope rooms by tenant (Section 3). |
| SH-20 Sample-data pill | — | Shared shell | DROP | Mockup only. |

### 1.2 Dashboard

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| DB-01 Owner dashboard | `DynamicDashboard` adminConfig | `index#dash` | CHANGE | New tiles from the KPI service. |
| DB-02 Date range and refresh | Presets, auto refresh | "This month" (dead) | CHANGE | Wire. |
| DB-03 Target ladder (North Star, quarter, month, day) | — | `index#dash` | NEW | Needs `Target` model. |
| DB-04 Today's targets (quests) | — | `index#dash` | NEW | One quest ("Failed delivery calls") has no setting. See fix list. |
| DB-05 Driver tiles (orders, confirmation, success, cash with agents) | Revenue, orders, customers, delivery rate | `index#dash` | CHANGE | Three named rates only. |
| DB-06 Delivered revenue vs target chart | Line chart | Placeholder chart | CHANGE | Real chart. Needs daily target series. |
| DB-07 Agent suggestion cards | — | `index#dash` | NEW | Buttons open a screen. No writes. |
| DB-08 Recent orders | `recentActivity` | Table | KEEP+RESTYLE | |
| DB-09 Top this month | `leaderboard` widget | List of 3 | KEEP+RESTYLE | |
| DB-10 Download report | — | Dead button | DROP | Use Reports export. |
| DB-11 Manager dashboard | Shares adminConfig | — | MISSING-IN-MOCKUP | Decide: same as owner view or a call-centre view. |
| DB-12 Accountant dashboard | accountant config (collections, reconcile table) | — | MISSING-IN-MOCKUP | Finance clerk home. Finance Overview may serve. |
| DB-13 Inventory manager dashboard | inventory config (low stock, turnover) | — | MISSING-IN-MOCKUP | Stock keeper home. Inventory page may serve. |
| DB-14 Sales rep dashboard | rep config | `rep.html` Today | CHANGE | |
| DB-15 Delivery agent dashboard | agent config | `agent.html` Home | CHANGE | |

### 1.3 Orders

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| OR-01 Orders list | `/orders` list view | `index#orders` | CHANGE | Adds Call rep and Delivery agent columns, flags, reminder chips. |
| OR-02 Status tabs with counts | Filter panel (9 checkboxes) | Tabs (10) | CHANGE | |
| OR-03 Kanban view and view preference | `OrdersKanban`, `ordersDefaultView` | — | DROP | Owner removed it. Drop the preference. |
| OR-04 Search | `SearchBar` | Search box | KEEP+RESTYLE | |
| OR-05 Date range filter | `DateRangePicker` | — | MISSING-IN-MOCKUP | Add to filter row. |
| OR-06 Sort, pagination, page size, column resize | Sort, 25 to 100 rows, resize | Footer "Showing n of N" only | MISSING-IN-MOCKUP | Keep. Show in mockup. |
| OR-07 Filters: product, agent, assigned to, flagged | — | Dead buttons | NEW | Wire. |
| OR-08 Change status (row, bulk) | Inline select, bulk bar | Bulk menu, drawer | KEEP+RESTYLE | Goes through the new state machine. |
| OR-09 Assign rep and agent (row, bulk, drawer) | Endpoints only, no UI | Bulk bar, row menu, drawer | NEW | UI is new. |
| OR-10 Bulk delete | `DELETE /bulk` | Bulk bar, no confirm | KEEP+RESTYLE | Add confirm. |
| OR-11 Single order delete | Row action | — | MISSING-IN-MOCKUP | |
| OR-12 New order | `OrderForm` | New order drawer | KEEP+RESTYLE | Adds region, town, editable total. |
| OR-13 Edit order (items, phone, alt phone, address) | `OrderForm` edit | Drawer edits status and assignment only | MISSING-IN-MOCKUP | Reps fix addresses on calls. Needed. |
| OR-14 Alternate phone | Column and field | New order has one phone | MISSING-IN-MOCKUP | |
| OR-15 Import CSV/XLSX | `BulkImportModal` | Import modal | KEEP+RESTYLE | Row cap 2,000 in mockup. Backend limit is a 10 MB file. |
| OR-16 Export | `/export`, max 500 rows | Export (1,445 rows) | CHANGE | Lift the 500 cap. |
| OR-17 Order detail | `/orders/:id` page, read-only | Details drawer | CHANGE | Drawer replaces the page. |
| OR-18 Timeline | 3 dates | Full timeline | CHANGE | Built from `OrderHistory` and new timestamps. |
| OR-19 Payment card (method, status, cash held by) | Payment card | Payment section | KEEP+RESTYLE | Payment status stays separate from order status. |
| OR-20 Call log and call history | `LogCallModal`, `CallHistoryModal` | Drawer, Log call | KEEP+RESTYLE | Outcome list changes (see RE rows). |
| OR-21 Reminder on order | — | Set reminder | NEW | |
| OR-22 Team notes thread | — | Drawer notes | NEW | |
| OR-23 "Unpaid by agent" tab | — | Tab | NEW | |
| OR-24 Order states `payment_pending`, `payment_failed`, `digital_delivered` | Enum, set by Paystack and digital flows | Not in the 9 | MISSING-IN-MOCKUP | Needed for paid digital orders (counted as revenue). |
| OR-25 Transition rules | None (check is commented out) | — | NEW | Rebuild state machine in M1. |

### 1.4 Customers

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| CU-01 Customer list | `/customers` | `customers.html` | CHANGE | Adds segments, refusals, risk. |
| CU-02 KPI tiles and segment tabs | — | Tiles, 5 tabs | NEW | |
| CU-03 Search | Live search | Button (dead) | CHANGE | Make an input. |
| CU-04 Sort and pagination | Sort orders and spent | — | MISSING-IN-MOCKUP | |
| CU-05 Customer detail page | `/customers/:id` | — (rows not clickable) | MISSING-IN-MOCKUP | Orders, contact, address, avg order. Needed by reps. |
| CU-06 Add and edit customer | `CustomerForm` | Add (dead) | MISSING-IN-MOCKUP | No form shown. |
| CU-07 Delete customer | Confirm modal | — | MISSING-IN-MOCKUP | |
| CU-08 Risk, refusals, block COD | — | Risk column, KPI | NEW | Rule is an owner question (Q6). |
| CU-09 Customer agent cards | — | 2 cards | NEW | "Ask for prepayment" has no basis (COD only). See fix list. |
| CU-10 Tags, merge, analytics API | Dead code | — | DROP | |
| CU-11 Opt-out flags | In Communications | Messages, Opt-outs | KEEP+RESTYLE | |
| CU-12 Export | — | Dead button | NEW | |

### 1.5 Checkout forms

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| CF-01 Form list (name, counts, active, clone, preview, delete) | `CheckoutForms` | List | KEEP+RESTYLE | |
| CF-02 Orders, visits, conversion per form | `/stats` (no UI) | KPI tiles, columns | NEW | Visits are not tracked today. Needs a visit counter. |
| CF-03 Copy link and embed code | Packages tab | Header buttons | KEEP+RESTYLE | |
| CF-04 Basics (name, product, description, thank-you, origins, country) | Basics and Settings tabs | Basics | KEEP+RESTYLE | Mockup lets you edit the slug. Current slug is read-only. Keep read-only. |
| CF-05 Fields builder (9 types, standard keys, width, required, drag order) | `CheckoutFormBuilder` | Fields | KEEP+RESTYLE | Drag reorder not shown. Keep. "Can't take orders yet" guard stays. |
| CF-06 Regions list per form | `regions` | — | MISSING-IN-MOCKUP | Region options. Ghana has 16 regions. |
| CF-07 Packages | % or fixed discount, original price, popular, highlight | Table: sets, GH₵ discount, badge | CHANGE | Keep the current model. Show badge. |
| CF-08 Upsells | Manual or product, image, discount | Product, price, headline | KEEP+RESTYLE | Image upload and discount not shown. Keep. |
| CF-09 Payment methods | COD, deposit, full (max two) | Payment tab | CHANGE | Show COD only. Deposit and full stay hidden behind a flag. |
| CF-10 Tracking and pixels | Pixel, GA4, TikTok, GTM, CAPI token, test code | Tracking | KEEP+RESTYLE | Tracking is set in two places in the mockup. See fix list. |
| CF-11 Design: colours, button, input style, layout | `design` JSON | Design | KEEP+RESTYLE | |
| CF-12 Design options not in mockup | Label colour, price colour, hide name and description, page background, banner | — | MISSING-IN-MOCKUP | Keep. Add to Design tab. |
| CF-13 Live preview (mobile and desktop) | iframe + postMessage | Right pane | KEEP+RESTYLE | |
| CF-14 Public checkout page | `/form/:slug` | Preview modal only | KEEP+RESTYLE | Preview modal is the reference. |
| CF-15 Order success and "Form not found" screens | In `PublicCheckout` | — | MISSING-IN-MOCKUP | Restyle with form design. |
| CF-16 Pixel, CAPI dedupe, cooldown, iframe height | `pixelTracking.ts` | — | KEEP as-is | |
| CF-17 Payment callback page | `/checkout/payment/callback` | — | MISSING-IN-MOCKUP | Needed for digital orders paid online. |
| CF-18 Form agent cards | — | 2 cards | NEW | "Mobile vs desktop" needs device tracking. |
| CF-19 Form type (physical or digital) | `formType` | — | MISSING-IN-MOCKUP | Needed for the digital guide form. |

### 1.6 Messages

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| MS-01 Conversations (two-way, per customer) | Inbound logged only | `messages.html` Conversations | NEW | Needs inbound webhook, `MessageEvent`, `replied`. WhatsApp 24-hour window applies. |
| MS-02 Overview stats | Overview tab | KPI tiles | CHANGE | |
| MS-03 Message history table with filters (channel, status, date) | History tab | — | MISSING-IN-MOCKUP | Conversations is per customer. A full log is still needed. |
| MS-04 Bulk send (SMS, WhatsApp, email) | Bulk Send tab | Bulk send | KEEP+RESTYLE | Adds cost estimate, schedule, test send. |
| MS-05 Recipient preview table | "Preview Recipients" | Count only | MISSING-IN-MOCKUP | |
| MS-06 Email composer (title, starters, HTML body, preview, eligibility) | `EmailComposer` | Text plus tags | MISSING-IN-MOCKUP | HTML body, live preview, starters not shown. |
| MS-07 Campaigns | Campaigns tab | Campaigns | KEEP+RESTYLE | Adds read, replied, orders-after. |
| MS-08 Templates | SMS CRUD | All channels, modal | KEEP+RESTYLE | |
| MS-09 Email templates | Service, no UI | Templates grid | NEW | |
| MS-10 Opt-outs | Opt-outs tab | Opt-outs | KEEP+RESTYLE | Adds reason and date. |
| MS-11 Scheduled sends | — | Scheduled | NEW | Backend has no scheduler for messages. Time-based workflow trigger never fires today. |
| MS-12 Message status tracking (sent, delivered, read, failed, replied) | `MessageLog` | Bubbles | CHANGE | Adds `MessageEvent`. |
| MS-13 Public unsubscribe page | `/api/public/unsubscribe` (HTML) | — | MISSING-IN-MOCKUP | Keep. Restyle. |

### 1.7 Products

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| PR-01 Product list | `/products` | `products.html` | CHANGE | Adds cost, margin, days of cover, delivered, success. |
| PR-02 KPI tiles, Active/Archived tabs | — | Tiles, tabs | NEW | |
| PR-03 Add and edit product | `ProductForm` page | Drawer | KEEP+RESTYLE | Low stock is in days of cover in the mockup. Current is units. |
| PR-04 Digital product fields | URL, type, expiry hours | URL, type, expiry | KEEP+RESTYLE | File types differ (mockup: PDF, EPUB, MP3, MP4, ZIP). |
| PR-05 Delete product | Soft delete | Active checkbox only | CHANGE | "Archive" replaces delete. |
| PR-06 Raw stock overwrite | `PATCH /products/:id/stock` | Disabled when editing | CHANGE | Replace with movements. |
| PR-07 Stock by holder (expand) | `AgentStockPanel` | Expanded row | CHANGE | Adds Logiswift as a location. |
| PR-08 Incoming shipments tab | `IncomingInventoryView` | Tab | KEEP+RESTYLE | |
| PR-09 Add shipment | `AddShipmentModal` | Modal | KEEP+RESTYLE | Cost currency per shipment. |
| PR-10 Receive shipment (counted, short, location) | "Mark as arrived" | Receive modal | CHANGE | Landed cost on counted units. |
| PR-11 Edit and delete shipment | Row actions | — | MISSING-IN-MOCKUP | |
| PR-12 Supplier claim when short | — | Toast text | NEW | No claim record in the data model. |
| PR-13 Allocate, transfer, return, adjust, history modals | Products page | Products and Inventory | KEEP+RESTYLE | Shared components. |
| PR-14 Live margin in form | ProductForm | Drawer | KEEP+RESTYLE | |
| PR-15 Product agent cards | — | 2 cards | NEW | "Make a bundle" is dead. |

### 1.8 Inventory

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| IN-01 Agent inventory (summary, detail, history) | `AgentInventoryManagement` | `inventory.html` | CHANGE | Location cards plus table. |
| IN-02 Stock locations (own store, 3PL, agent, in transit) | None | Location cards | NEW | `StockLocation`. |
| IN-03 Our records vs 3PL count, difference | — | Table | NEW | |
| IN-04 Stock count (start, enter counts, save) | — | "Start stock count" (dead, no form) | NEW | Mockup has no count screen. Needs one. |
| IN-05 Reserved quantity | — | Cards | NEW | |
| IN-06 Transfers with status (in transit, received, disputed) | Ledger only | Recent transfers | NEW | |
| IN-07 Agent confirms receipt | — | `agent.html` Stock | NEW | |
| IN-08 Adjust with reason | Adjust modal | Adjust modal | KEEP+RESTYLE | |
| IN-09 Own store | — | "Coming soon" | NEW | Location type exists in design. |
| IN-10 Agent "My Inventory" | `AgentMyInventory` | `agent.html` Stock | CHANGE | |

### 1.9 Deliveries

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| DL-01 Partner list (agents and 3PLs) | `DeliveryAgents` (agents only) | `deliveries.html` | CHANGE | |
| DL-02 KPI tiles | — | 5 tiles | NEW | |
| DL-03 Performance columns | MTD success, completed, earnings | Success, days, cash, oldest unpaid | CHANGE | |
| DL-04 Fee rule per partner | — | Column | NEW | `FeeRule`. Edit screen not shown. |
| DL-05 Days to pay, oldest unpaid | — | Columns | NEW | Target days-to-pay per partner needs a field. |
| DL-06 Data source | — | Column | NEW | |
| DL-07 Failed and returned by reason | Analytics bar | Card | KEEP+RESTYLE | |
| DL-08 Returns missing units | — | Note | NEW | |
| DL-09 Edit agent | `AgentEditModal` | Staff person modal | CHANGE | |
| DL-10 Add delivery partner | Create modal orphaned | Dead button | NEW | Opens Staff person modal (person or company). |
| DL-11 Agent availability toggle | `PATCH /availability` | — | MISSING-IN-MOCKUP | Assignment uses it. |
| DL-12 Date range on list | `DateRangePicker` | — | MISSING-IN-MOCKUP | |
| DL-13 Admin view of delivery proof (photo, signature, OTP) | Fields stored | — | MISSING-IN-MOCKUP | |
| DL-14 Upload CSV | — | Dead button | NEW | Becomes the CSV connector for agents. |
| DL-15 Delivery attempts history | Mobile detail | Agent detail | KEEP+RESTYLE | |
| DL-16 Route lookup | `GET /routes/:agentId` | — | DROP | No UI. |

### 1.10 Finance

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| FI-01 Overview KPIs | Revenue, profit, receivables, expenses, pipeline | Six new tiles | CHANGE | One revenue definition. |
| FI-02 Revenue and expense trends chart | `FinancialDashboard` | — | MISSING-IN-MOCKUP | Monthly P&L table replaces numbers. A chart is not shown. |
| FI-03 Pipeline revenue, in-transit | Cards | — | DROP | Replaced by cash outstanding. |
| FI-04 30-day cash forecast | Forecast + CSV | Forecast tab | KEEP+RESTYLE | Adds scenario switch. Check double count (design risk 13). |
| FI-05 Payout reconciliation table | — | Overview | NEW | `PartnerSettlement`. |
| FI-06 Unpaid delivered by age | — | Card | NEW | |
| FI-07 Cohort profit card | — | Card | NEW | |
| FI-08 Cost of failed deliveries | — | Card | NEW | |
| FI-09 Monthly P&L table | — | Card | NEW | Add "1–17 Sep" column. |
| FI-10 Cash runway | — | Tile | NEW | |
| FI-11 Agent aging and collections | `AgentCollections` | Agent collections | KEEP+RESTYLE | |
| FI-12 Send reminder, block, unblock | Row actions | Row actions | KEEP+RESTYLE | |
| FI-13 Collections chain (verify, approve, deposit, reconcile) | 4 steps + deposit review | Review modal (verify or reject) | CHANGE | Approve step has no mockup. Settlement reconcile removes the manual steps. |
| FI-14 Deposit verify and reject with reason | Modal | Review modal | KEEP+RESTYLE | |
| FI-15 Record partner payout | Legacy "mark deposited" | Modal | NEW | |
| FI-16 Findings list (cash gap, short-pay, stock gap) | — | Cards only | NEW | Design has `Finding`. No list screen in the mockups. |
| FI-17 Record journal entry | `JournalEntryModal` | New journal entry | KEEP+RESTYLE | |
| FI-18 Chart of accounts and ledger | Browse, search, ledger, CSV | Account pick list, ledger table | CHANGE | Mockup account numbers do not match live codes. See fix list. |
| FI-19 Financial statements | P&L, balance sheet, PDF | Statements cards | KEEP+RESTYLE | PDF export not shown. |
| FI-20 Profit by product | Profitability tab, CSV and Excel | Profit by product | CHANGE | |
| FI-21 Expenses (add, edit, delete, search, breakdown) | Expense Management | Expenses | KEEP+RESTYLE | |
| FI-22 Expense categories | 7 (COGS, Delivery, Marketing, ...) | 8 (Packaging, Software, ...) | CHANGE | Migrate old categories. |
| FI-23 Expense receipt upload and view | Receipt column | — | MISSING-IN-MOCKUP | |
| FI-24 Expense "Paid from" | — | Field | NEW | |
| FI-25 Rep commissions and payouts | `RepPayoutModal` (pick orders) | Rep commissions tab | CHANGE | Pick-orders view is gone. See ST-13. |
| FI-26 Export menu | CSV buttons per tab | Menu of 4 | KEEP+RESTYLE | |
| FI-27 Delivery-agent pay in the books | Not posted | Not posted | NEW | Owed amounts appear nowhere. Owner question Q3. |
| FI-28 Finance health and backfill endpoints | Admin API, no UI | — | KEEP as-is | |

### 1.11 Marketing

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| MK-01 Meta connection status | — | Header chip | NEW | `MetaConnection`. |
| MK-02 KPI tiles (spend, CPA vs max CPA, projected cost, yield) | — | Tiles | NEW | |
| MK-03 Funnel (7 steps) | Analytics funnel (orders only) | Funnel card | NEW | |
| MK-04 Campaigns table | — | Table | NEW | |
| MK-05 Ad drilldown (hook, hold, frequency) | — | Expanded rows | NEW | |
| MK-06 Map campaign to product | — | Select | NEW | Select does nothing in the mockup. |
| MK-07 Daily spend vs orders | — | Chart | NEW | |
| MK-08 Agent cards | — | 3 cards | NEW | "Cut budget by 30%" writes to Meta. Not in scope. See fix list. |
| MK-09 Meta CAPI for checkout | `metaCapiService` | Connections / forms | KEEP as-is | |

### 1.12 Reports

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| RP-01 Overview | Analytics Overview | Overview | CHANGE | |
| RP-02 Sales and revenue | Analytics tab | Tab | CHANGE | One revenue definition. |
| RP-03 Delivery and operations | Analytics tab | Tab | CHANGE | Three rates. |
| RP-04 Team performance | Analytics tab | Tab | CHANGE | Rep success bug fixed. |
| RP-05 Products and profit | — | Tab | NEW | |
| RP-06 Marketing tab | — | Tab | NEW | Same component as Marketing page. |
| RP-07 Date presets and compare to previous | Date picker | Presets, compare switch | CHANGE | |
| RP-08 Export (CSV, Excel, PDF), custom export dialog | CSV in a few places | Menu, dialog | NEW | |
| RP-09 Saved reports | — | Menu | NEW | Owner question Q8. |
| RP-10 Recent exports (kept 7 days) | — | Table | NEW | Owner question Q8. |
| RP-11 "Explain this month" | — | Agent card | NEW | Read-only AI. |
| RP-12 Call tracking cards, call outcomes | Team tab | KPI + donut | KEEP+RESTYLE | |
| RP-13 Top rep and top agent cards | Overview | — | DROP | Leaderboard replaces. |
| RP-14 Order pipeline funnel, area distribution | Charts | Region table | CHANGE | |
| RP-15 Customer insights | Dashboard fetcher | — | DROP | |
| RP-16 Daily sales breakdown | Table | Daily breakdown | KEEP+RESTYLE | |

### 1.13 Targets, Leaderboard, North Star

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| TL-01 Targets page (year, quarter, month, role, person) | — | `index#targets` | NEW | |
| TL-02 Margin shown with revenue at each level | — | Targets, Dashboard | NEW | Margin target 35% has no input field. Add to setup. |
| TL-03 Role target groups with reward at 100% | — | Table | NEW | Reward column reads from Settings, Rewards. |
| TL-04 Add and edit target | — | "Add target" (dead) | NEW | Wire. |
| TL-05 Leaderboard: call reps | — | `index#board` | NEW | AI agents show under their role. |
| TL-06 Leaderboard: delivery | — | Tab | NEW | Include Kasapa Express as "too early". |
| TL-07 Leaderboard: upsell | — | Tab | NEW | |
| TL-08 Period select | — | Select (labels only) | NEW | Make it work. |
| TL-09 Reward progress ("distance to next tier") | — | Cards | NEW | Rewrite without the 80% tier. |
| TL-10 Badges | — | Cards | NEW | Needs a badge store. Not in data model. |
| TL-11 North Star setup wizard | Onboarding steps 1 and 2 (country, business) | `index#onboard` | NEW | Steps 4 to 6 have no screen. |
| TL-12 Orders-a-day and max CPA calculators | — | Setup tiles | NEW | |

### 1.14 Staff and roles

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| ST-01 Role cards (6) with holders, target, progress | 7 fixed roles | `staff.html` | NEW | `Role`, `RoleAssignment`. |
| ST-02 Assign human, AI agent or company | — | Role detail | NEW | |
| ST-03 Allowed tools (16 switches) | Permission matrix (10 resources) | Role detail | CHANGE | Mapping needed. See ST-12. |
| ST-04 New role | — | Dead button | NEW | |
| ST-05 Team table (tabs, type, pay, last active, status) | User Management table | Team table | CHANGE | |
| ST-06 Invite person | Create user with password | Person modal, "Send invite" | CHANGE | No invite flow exists. New. |
| ST-07 Edit person (name, email, phone, role, pay, vehicle, location) | Edit user, agent modal, rep modal | Person modal | CHANGE | Vehicle types differ. Rep country field dropped. |
| ST-08 Reset password, deactivate, reactivate, delete (soft and permanent) | User Management | Row menu | KEEP+RESTYLE | |
| ST-09 Filter by role, search | Filters | Status tabs only | MISSING-IN-MOCKUP | |
| ST-10 Rep availability and workload | `isAvailable`, workload API | — | MISSING-IN-MOCKUP | Round-robin uses it. |
| ST-11 Roles admin, manager, accountant, inventory manager | `UserRole` enum | Mockup has 5 role names | MISSING-IN-MOCKUP | Map each enum role to a position role. |
| ST-12 Fine permissions (customers, GL, workflows, settings, orders delete, bulk import, update stock, calls) | Role Permissions tab | — | MISSING-IN-MOCKUP | 16 switches cover less. Keep matrix underneath. Show as presets. |
| ST-13 Pick delivered orders to pay | `RepPayoutModal` | Amount only | MISSING-IN-MOCKUP | Needed for `CommissionEntry` link to payout. |
| ST-14 Pay card: reps, delivery agents, history | Rep payouts only | Pay card | CHANGE | Agent pay is new. |
| ST-15 Record payout (person) | Process payout | Modal | KEEP+RESTYLE | Duplicated in Finance. See fix list. |
| ST-16 Customer Reps performance table | `CustomerReps` | — | DROP | Leaderboard and Reports replace. |
| ST-17 Earnings History (rep) | `/earnings-history` | `rep.html` Earnings | DROP | Rep Earnings replaces. |

### 1.15 Rep screen

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| RE-01 Today (hero, reward, KPIs, cards) | Rep dashboard | `rep.html#today` | NEW | |
| RE-02 Queue (Pending, Call backs, Re-delivery) with wait timer | Orders list | `rep.html#queue` | NEW | Needs queue timer and `confirmedAt`. |
| RE-03 Call card (customer, order, history) | Order detail | Call card | NEW | |
| RE-04 Outcomes: Confirmed, Not reachable, Call back later, Declined, Wrong number | Confirmed, Rescheduled, No answer, Cancelled, Other | Outcome buttons | CHANGE | Extend `CallOutcome`. |
| RE-05 Upsell panel (package, add-ons, earn box) | — | Confirmed panel | NEW | `UpsellLine`. |
| RE-06 Decline reasons | — | Chips | NEW | |
| RE-07 My orders | Orders list | `rep.html#orders` | CHANGE | |
| RE-08 Earnings | `EarningsHistory` | `rep.html#earnings` | CHANGE | |
| RE-09 My numbers | Rep stats | `rep.html#numbers` | CHANGE | |
| RE-10 Rep inbox | — | `rep.html#inbox` | NEW | |
| RE-11 Auto-confirm by WhatsApp or SMS, queue timer, time to first call | — | Only timer and rank shown | NEW | No screen for auto-confirm settings. |
| RE-12 Rep creates an order | Orders create permission | — | MISSING-IN-MOCKUP | Owner question Q9. |
| RE-13 Rep adds or edits a customer | Customers CRUD for reps | — | MISSING-IN-MOCKUP | Same question. |
| RE-14 Rep sees customer detail and past orders | Customer detail | "Previous orders" in call card | KEEP+RESTYLE | Partly covered. |

### 1.16 Delivery agent app

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| AG-01 Home (today, reward, cash held, team notes) | Dashboard | `agent.html#home` | CHANGE | |
| AG-02 Deliveries list (tabs, search) | `MobileDeliveries` | `agent.html#deliveries` | KEEP+RESTYLE | |
| AG-03 Delivery detail | `MobileDeliveryDetail` | Detail | KEEP+RESTYLE | WhatsApp, Maps, Call number are dead. |
| AG-04 Start delivery | Order to out for delivery | Start delivery | KEEP+RESTYLE | |
| AG-05 Complete delivery (received by, cash, photo) | Sheet (COD, recipient, photo or OTP) | Sheet | KEEP+RESTYLE | OTP proof not shown. |
| AG-06 Report failed (reason, reschedule) | Sheet | Sheet (4 reasons, note) | CHANGE | "Reschedule for tomorrow" now a reason chip. |
| AG-07 Stock (list, history) | `AgentMyInventory` | Stock | KEEP+RESTYLE | |
| AG-08 Confirm received stock | — | Sheet | NEW | |
| AG-09 Cash (collections, deposits, balance) | `MobileCollections` | Cash | KEEP+RESTYLE | |
| AG-10 New deposit | Amount, method, reference, notes, receipt | Amount, method, receipt, notes | MISSING-IN-MOCKUP | Backend requires a unique reference number. Mockup has no field. |
| AG-11 Deposit method "Check" | Backend allows check | Cash, bank, MoMo | CHANGE | Drop "check" or keep. Minor. |
| AG-12 Inbox and reply | — | Inbox, Reply sheet | NEW | |
| AG-13 More (profile, notification switches) | `/m/settings` | More | CHANGE | |
| AG-14 Language switch (English, Twi, Ga) | — | More | DROP | English only first. Hide switch. |
| AG-15 Agent earnings and pay owed | "My Earnings" tile | Text in inbox only | MISSING-IN-MOCKUP | Add a My pay view. |
| AG-16 Delivery-agent reward progress | — | Home | NEW | |

### 1.17 Inbox

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| IB-01 Feed: All, Mentions, Alerts, Done | In-memory bell | `inbox.html` | NEW | |
| IB-02 Assigned to me | — | Table | NEW | |
| IB-03 Reminders (create, snooze, repeat, notify channels) | — | Reminders | NEW | |
| IB-04 Team threads (order, customer, payout, product) | — | Threads | NEW | |
| IB-05 Snooze, mark done, set reminder on a row | — | Row actions | NEW | |
| IB-06 Notification settings (events by channel, role defaults, quiet hours, digest) | Two dead toggles | Settings view | NEW | |
| IB-07 Mention a teammate | — | Composer | NEW | |

### 1.18 Workflows

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| WF-01 Workflow list (search, status, delete) | `/workflows` | List | KEEP+RESTYLE | |
| WF-02 KPI tiles (runs, failed runs) | Statistics panel | Tiles | CHANGE | |
| WF-03 Active switch | Pause or Activate | Switch | KEEP+RESTYLE | |
| WF-04 Run manual workflow | "Run" button | — | MISSING-IN-MOCKUP | Mockup trigger "Manual (run from an order)" has no run button. |
| WF-05 Execution history | Modal | Run history table | KEEP+RESTYLE | |
| WF-06 Template gallery | 8 shown, 10 in backend | 8 | KEEP+RESTYLE | "Shopify order import" has no connection. Drop it. |
| WF-07 Builder: 5 steps | `WorkflowWizard` | Builder | KEEP+RESTYLE | |
| WF-08 Triggers: order created, status change, manual | Fire today | Shown | KEEP+RESTYLE | |
| WF-09 Triggers: payment received, schedule, webhook | Never fire | Shown | NEW | Must build the firing. |
| WF-10 Conditions | 15 operators, AND/OR groups | 5 operators, All or Any | CHANGE | Keep the engine. Show fewer. |
| WF-11 Actions: SMS, email, WhatsApp, status, assign user, wait, HTTP | `assign_agent`, `add_tag` also | Same, minus add tag | CHANGE | Drop `add_tag` and `assign_agent` as separate actions. HTTP is a mock today. |
| WF-12 Assign by region | — | Assign user, By region | NEW | Locked: build. |
| WF-13 "Also assign orders with no one yet" | — | Switch | NEW | |
| WF-14 Test run (no messages sent) | — | Review step | NEW | |
| WF-15 "Describe a workflow and I'll build it" | — | Agent card | NEW | AI write action. Not in release one. |

### 1.19 Connections

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| CN-01 Arkesel SMS | Settings, Integrations | Card + modal | CHANGE | Delivery report webhook URL not shown. |
| CN-02 WhatsApp (Connect with Meta, manual token) | Settings, Integrations | Card + modal | CHANGE | Quality rating and phone picker not shown. |
| CN-03 Email (SendGrid, Resend, SMTP) | Settings, Integrations | Card + modal | CHANGE | |
| CN-04 Paystack keys and webhook | Settings, Integrations | Card (test mode) | CHANGE | Keep for digital products. Owner question Q1. |
| CN-05 Meta Ads | — | Card + modal | NEW | |
| CN-06 Checkout website (site, pixel, server events) | Per form | Card | NEW | Duplicates form Tracking. See fix list. |
| CN-07 CSV upload | — | Card | NEW | |
| CN-08 MCP keys (label, role, revoke) | Settings, Integrations | Card + form | CHANGE | Adds role. |
| CN-09 Inbound order webhooks (create, URL, key) | `/webhooks` page | Webhooks card | KEEP+RESTYLE | |
| CN-10 Webhook secret, custom headers, edit, delete | Security tab | — | MISSING-IN-MOCKUP | Mockup has create and status switch only. |
| CN-11 Webhook field mapping, logs, retry | Mapping editor, logs | Detail tabs | KEEP+RESTYLE | |
| CN-12 Webhook test (sample JSON) | Test tab | — | MISSING-IN-MOCKUP | |
| CN-13 Activity log (all connections) | — | Activity card | NEW | |
| CN-14 3PL connector (Logiswift, Kasapa) | — | Data source column only | REMOVED (O7) | No card and no partner key. Outside agents use the normal API or MCP key. |
| CN-15 Payment pointer card for Webhooks | Settings card | — | DROP | Page replaces it. |

### 1.20 Settings (summary; field detail in Section 2)

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| SE-01 Profile | Tab (save not wired) | Profile | CHANGE | Wire save. |
| SE-02 Security | Tab (password not wired) | Security | CHANGE | Wire. Sessions list is new. |
| SE-03 My Notifications | Tab (not wired) | Pointer to Inbox | CHANGE | |
| SE-04 Business Settings | Tab | Business details | CHANGE | |
| SE-05 Checkout Forms pointer tab | Tab | — | DROP | Sidebar item replaces. |
| SE-06 Integrations tab | Tab | — | DROP | Moves to Connections. |
| SE-07 User Management tab | Tab | — | DROP | Moves to Staff. |
| SE-08 Role Permissions tab | Tab | — | DROP | Moves to Staff (see ST-12). |
| SE-09 Billing and Plans | Tab | Tab | CHANGE | Numbers differ from live plans. Owner question Q2. |
| SE-10 North Star and targets | — | Tab | NEW | |
| SE-11 Rewards | — | Tab | NEW | |
| SE-12 Currencies and FX | Currency in Business | Tab | NEW | |
| SE-13 Order statuses | — | Tab | NEW | |
| SE-14 Operations (hours, queue, time to first call, days to pay) | `operatingHours` (no UI) | — | NEW | Proposed. Not in mockup. |

### 1.21 Auth and public pages

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| AU-01 Login | `/login` | — | MISSING-IN-MOCKUP | Restyle. |
| AU-02 Forgot and reset password | 2 pages | — | MISSING-IN-MOCKUP | Restyle. |
| AU-03 Register (tenant signup) | `/register` | — | MISSING-IN-MOCKUP | SaaS item. Hide now. |
| AU-04 Pricing page | `/pricing` | — | MISSING-IN-MOCKUP | SaaS item. Hide now. |
| AU-05 Onboarding (country, currency, business, activate plan) | `/onboarding` | Wizard steps 1 and 2 shown as done | MISSING-IN-MOCKUP | Steps 1 and 2 have no screen. |
| AU-06 Subscription callback | `/settings/billing/callback` | — | MISSING-IN-MOCKUP | SaaS item. |
| AU-07 Public order tracking | API only, no page | — | KEEP as-is | No page today. |
| AU-08 Digital download link | `/api/public/download/:token` | — | KEEP as-is | |
| AU-09 Platform login | `PlatformLogin` | — | KEEP as-is | |

### 1.22 Platform admin

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| PA-01 Dashboard, tenants, tenant detail, announcements, billing | `/platform/*` | — | KEEP as-is | Out of scope in design doc. Tenant plan filter lists stale plans (Starter, Pro). |

### 1.23 MCP and AI

| Feature | Current app | Mockup | Verdict | Notes |
|---|---|---|---|---|
| AI-01 14 MCP tools | `backend/src/mcp` | — | CHANGE | Move to the tool registry (M2). |
| AI-02 Actor identity and audit for MCP | None | Keys with role | NEW | |
| AI-03 Per-key rate limit | Global bucket | — | CHANGE | |
| AI-04 In-app chat drawer | — | Drawer | NEW | M11. Input box is static in the mockup. |
| AI-05 Suggestion cards per page | — | Many pages | NEW | Click opens a screen. |
| AI-06 New KPI and problem-finder tools | — | — | NEW | |
| AI-07 Write tools with preview and confirm | One write tool | — | NEW | M12. |
| AI-08 Schema resource | Stale | — | CHANGE | Rebuild. |

---

## 2. Settings matrix

Target tabs: **Settings** = Profile, Security, Business details, Operations (proposed), North Star and targets, Rewards, Currencies and FX, Order statuses, Notifications (link), Billing and plans (hidden for now). Other fields move to Staff, Connections, Deliveries, Messages or Inbox.

Storage: **SS** = `SystemConfig`. **User** = `users`. **Tenant** = `tenants`.

### 2.1 Profile

| Field | Current | Mockup | Target tab | Verdict | Notes |
|---|---|---|---|---|---|
| First name, last name | Profile, User; no save | Full name | Profile | CHANGE | Wire save. Mockup uses one name field. Keep two columns in the DB. |
| Display name | — | Profile | Profile | NEW | Add a `User` column. |
| Email | Profile; no save | Profile | Profile | CHANGE | Wire save. Email is unique. |
| Phone | Profile; placeholder "+1 (555)"; no save | Profile | Profile | CHANGE | Wire. Use a Ghana placeholder. |
| Photo | — | Change photo (toast) | Profile | NEW | Needs upload. R2 already exists. |
| Language | — | English | Profile | NEW | One option now. English only. |
| Time zone | — | Profile and Business | Business details | CHANGE | One place only. |
| Current role, member since | Read-only | — | Profile | KEEP+RESTYLE | |

### 2.2 Security and notifications

| Field | Current | Mockup | Target tab | Verdict | Notes |
|---|---|---|---|---|---|
| Current, new, repeat password | Admin roles only; not wired | Security | Security | CHANGE | Wire. Show to all roles. Today other roles see "restricted". |
| Signed-in sessions list | — | 3 sessions | Security | NEW | One refresh token per user today. Needs a session store. See fix list. |
| Sign out everywhere else | — | Button | Security | NEW | Clear refresh token. |
| Export my data | — | Button | Security | NEW | Scope unclear. |
| Delete account | Super admin; password confirm | Type DELETE | Security | CHANGE | Keep password. Add the typed word. |
| Order updates toggle | Not wired | — | Notifications | DROP | Replaced by the event matrix. |
| Payment notifications toggle | Not wired | — | Notifications | DROP | |
| My alerts matrix (9 events by 4 channels) | — | Inbox settings | Notifications | NEW | Stored per user. |
| Role defaults matrix, Apply to team | — | Inbox settings | Notifications | NEW | Dead button in mockup. |
| Quiet hours (from, to, still send short payouts) | — | Inbox settings | Notifications | NEW | |
| Daily digest (switch, time, channel, remind after) | — | Inbox settings | Notifications | NEW | |
| Agent app switches (4) | — | `agent.html` More | Notifications | CHANGE | Same store as the matrix. |

### 2.3 Business details and Operations

| Field | Current | Mockup | Target tab | Verdict | Notes |
|---|---|---|---|---|---|
| businessName | SS | Business name | Business details | KEEP+RESTYLE | Also feeds the config store. |
| businessEmail | SS | Contact email | Business details | KEEP+RESTYLE | |
| businessPhone | SS | — (Support WhatsApp) | Business details | CHANGE | Mockup replaces it with a support WhatsApp. Keep both. |
| businessAddress | SS | Business address | Business details | KEEP+RESTYLE | |
| taxId | SS | Tax ID (TIN) | Business details | KEEP+RESTYLE | |
| Customer support WhatsApp | — | Business details | Business details | NEW | Used in delivery messages. |
| Contact person | — | Business details | Business details | NEW | Low value. Optional. |
| Main product | — | Business details | — | DROP | Many products now. |
| Selling country | Onboarding only | Business details | Currencies and FX | CHANGE | Locked after first sale. |
| currency | SS (default USD), Tenant (default GHS) | "Currency customers pay in" | Currencies and FX | CHANGE | Two columns hold currency. Pick `Tenant.currency`. Locked after first sale. |
| Time zone | — | Business details | Business details | NEW | New column. Default Africa/Accra. |
| Average order value | — | Business details (typed) | — | DROP | Approved fix 2. Computed. |
| operatingHours | SS JSON, no UI | — | Operations | NEW | Needed for queue timer and time to first call. Q5. |
| Queue wait alert (30 min) | — | Oldest wait shown | Operations | NEW | Goes to `SystemConfig`. |
| Time to first call target (15 min) | — | Shown as 12 min | Operations | NEW | |
| Default days to pay | — | Per partner shown | Operations | NEW | Default for new partners. Per-partner value lives on the partner. |
| Low stock days of cover (default 14) | Units per product | Product drawer | Operations | CHANGE | Default here. Per product override. |

### 2.4 North Star, targets, rewards

| Field | Current | Mockup | Target tab | Verdict | Notes |
|---|---|---|---|---|---|
| Annual North Star (GH₵1,800,000) | — | Setup, Settings | North Star and targets | NEW | `Target`. |
| Net margin target (35%) | — | Shown, no input | North Star and targets | NEW | Add an input. |
| Growth mode (even, grow each quarter, custom) | — | Segmented control; does nothing | North Star and targets | NEW | Must change quarter tiles. Custom needs editable tiles. |
| Quarter split Q1 to Q4 | — | Read-only tiles | North Star and targets | NEW | Computed. Editable in Custom. |
| Planned AOV (default last 30 days) | — | Typed GH₵249 | North Star and targets | CHANGE | Approved fix 2. Editable. |
| Confirmation rate target (70%) | — | Setup input | North Star and targets | NEW | |
| Delivery success target (60%) | — | Setup input | North Star and targets | NEW | |
| Orders a day needed (58) | — | Calculated | North Star and targets | NEW | Month target is fixed in code now (GH₵180k). Compute. |
| Max CPA | — | Calculated | North Star and targets | NEW | Profit per delivered order is fixed in code (₦20,720). Compute from landed cost and fee rules. |
| Role targets (1,300 confirmed, 60% success, max CPA) | — | Targets page | Targets page | NEW | Not Settings. |
| Daily activity target "Failed delivery calls 15" | — | Dashboard quest | Targets page | NEW | Add as call rep daily target. |
| Reward tiers per role (100% and 120%, cash) | — | Rewards | Rewards | NEW | Approved fix 1. Airtime tier removed. |
| Delivery reward tiers (100% GH₵250, 120% GH₵400 + day off) | — | Rewards | Rewards | NEW | |
| Call rep tiers (100% GH₵300, 120% GH₵500 + day off) | — | Rewards | Rewards | NEW | |
| Companies and AI agents: no payout | — | Rewards | Rewards | NEW | |
| 3PL below 80% of target: contract review | — | Rewards | Rewards | NEW | Not a payout. Keep as a flag. |
| Rep commission (GH₵8 per confirmed order delivered) | `User.commissionAmount` | Rewards input | Rewards | CHANGE | One rule for all reps now. Per-user override stays on the person. |
| Upsell reward (10%) | — | Rewards input | Rewards | NEW | |
| What reps can offer | — | Read-only tags | Rewards | NEW | Read from the checkout form. |
| Result badges | — | Rewards | Rewards | NEW | Show once, not twice. |
| North Star card on the Rewards screen | — | Shown in both | North Star and targets | CHANGE | Approved fix 1: Rewards only in Rewards. North Star tab links to it. |

### 2.5 Currencies and FX

| Field | Current | Mockup | Target tab | Verdict | Notes |
|---|---|---|---|---|---|
| Store currency | SS and Tenant | Business details | Currencies and FX | CHANGE | Set once. Locked after first sale. |
| Currency list | Settings 10, onboarding 8 | GH₵ or ₦ | Currencies and FX | CHANGE | One list. |
| Extra currencies | — | Ad spend ₦ tile | Currencies and FX | NEW | Add or remove. |
| Exchange rate (₦ per GH₵) | — | Typed 112 | Currencies and FX | CHANGE | Auto daily. Manual override. |
| Use today's rate | — | Dead button | Currencies and FX | NEW | Wire. |
| Rate history per day | — | — | Currencies and FX | NEW | `FxRate` with a date. Ledger and P&L use the day's rate. |
| Stale warning | — | Agent card | Currencies and FX | CHANGE | Only for manual rates. |
| Supplier cost currency | — | GH₵ only | Products, shipment | NEW | Per shipment. |

### 2.6 Order statuses and billing

| Field | Current | Mockup | Target tab | Verdict | Notes |
|---|---|---|---|---|---|
| Status list | 9 order + 3 internal | 6 (New, Confirmed, ...) | Order statuses | CHANGE | Show the real 9, read-only, with meaning. |
| Add status | — | Dead button | — | DROP | State machine is fixed. |
| Payment status note | — | Text | Order statuses | KEEP+RESTYLE | |
| Current plan, usage, next bill | Billing page | Billing and plans | Billing and plans | CHANGE | Hide for owner tenant. Q2. |
| Payment method, stores used | — | Billing | Billing and plans | DROP | Stores dropped. |
| Plan list and limits | Growth 5,000 orders, 10 staff | Growth 1,500 orders, 2 stores | Billing and plans | CHANGE | Mockup numbers do not match live plans. |
| Cancel subscription | Billing | Billing | Billing and plans | KEEP+RESTYLE | SaaS later. |

### 2.7 Fields that leave Settings

| Field | Current | Mockup | New home | Verdict | Notes |
|---|---|---|---|---|---|
| User create/edit (name, email, password, phone, role, commissionAmount) | User Management | Person modal | Staff and roles | CHANGE | Password becomes invite. |
| User filters (search, role, status) | User Management | Status tabs | Staff and roles | CHANGE | Keep role filter. |
| Role permission matrix (10 resources) | Role Permissions | Allowed tools | Staff and roles | CHANGE | See ST-12. |
| SMS: authToken, senderId, isEnabled, test phone | Integrations | Connections | Connections | KEEP+RESTYLE | Add delivery webhook URL back. |
| WhatsApp: OAuth fields, accessToken, phoneNumberId, appSecret, verify token, isEnabled | Integrations | Connections | Connections | KEEP+RESTYLE | Business account ID shown in mockup. |
| Email: provider, apiKey, from, name, test | Integrations | Connections | Connections | KEEP+RESTYLE | Add SMTP host, port, user, password to the modal (in mockup). |
| Paystack: mode, public key, secret key, isEnabled | Integrations | Connections | Connections | KEEP+RESTYLE | |
| MCP key: label | Integrations | Name, Role | Connections | CHANGE | Role is new. |
| Message templates (8 textareas, `notificationTemplates`) | Built, not mounted | — | Messages, Templates | DROP | Messages templates cover it. Move any filled text. |
| Fee per outcome per partner | `GL_DEFAULTS` (fail fee 50, return fee 0) | Deliveries column | Deliveries, partner | NEW | `FeeRule`. |
| Days to pay per partner | — | Deliveries, Finance aging | Deliveries, partner | NEW | |
| Agent pay per delivery | `deliveryRate` | Staff, Pay | Staff and roles | KEEP+RESTYLE | |
| Meta ad accounts on/off | — | Connections modal | Connections | NEW | |
| Meta campaign mapping | — | Marketing | Marketing | NEW | |
| Checkout form payment, tracking | Form settings | Form tabs | Checkout forms | KEEP+RESTYLE | |
| Digital link expiry, max downloads | Product | Product drawer | Products | KEEP+RESTYLE | Max downloads not shown. |
| ordersDefaultView | User preferences | — | — | DROP | No Kanban. |
| onboardingCompleted | User preferences | — | Setup wizard | KEEP as-is | |
| Tenant.defaultDeliveryFee | Never read | — | — | DROP | Replaced by `FeeRule`. |
| Tenant rate limit | Platform admin | — | Platform admin | KEEP as-is | |

---

## 3. Broken or dead in the current app

| # | Item | Evidence | Proposed action | Milestone |
|---|---|---|---|---|
| 1 | Profile save does nothing | Frontend 4.1 | Wire `PUT /users/:id`. | M3 |
| 2 | Password change does nothing | Frontend 4.3 | Wire. Show to all roles. | M3 |
| 3 | Notification toggles do nothing | Frontend 4.2 | Drop. Build Inbox matrix. | M9 |
| 4 | `MessageTemplates` component not mounted; `notificationTemplates` may be unused | Frontend 4.7 | Confirm backend does not read it. Move filled text to Messages templates. Delete. | M9 |
| 5 | `admin` role sees no settings tabs | `isSuperAdmin` check | Use the permission matrix. | M3 |
| 6 | Public `POST /auth/register` makes a tenantless privileged user | Backend 1.2, 7.5 | Remove the route. Test with two tenants. | M0 |
| 7 | Possible double stock decrement | Backend 2.2 | Test: create public order, deliver it, check stock. Fix in `StockLevel` rebuild. | M0 test, M4 fix |
| 8 | Agent deposit credits 1020; delivery debits 1015; 1020 never debited | Backend 2.3 | Accounting review. One cash-in-transit account. Fix before settlement posting. | M5 |
| 9 | Plan limits and subscription status not enforced | Backend 6.3 | Leave. SaaS item. Hide Billing for owner tenant. | Later |
| 10 | Suspended or past-due tenants keep full access | Backend 7.5 | Leave until SaaS. Note in PRD. | Later |
| 11 | Failed delivery GL entry not posted when status set to `failed_delivery` | Backend 0, 2.2 | Post from the state machine. | M1 |
| 12 | No transition validation on order status | Backend 2.2 | State machine (locked). | M1 |
| 13 | Workflow `update_order` and `assign_agent` skip `orderService` (no GL, stock, history) | Backend 2.6 | Route through services. | M2 |
| 14 | Workflow `http_request` is a mock; `wait` blocks a worker with `setTimeout`; two parallel action runners | Backend 2.6 | Build real HTTP. Use delayed jobs. Keep one runner. | M9 |
| 15 | Triggers `payment_received`, `time_based`, `webhook` never fire | Backend 0 | Build, or hide in the builder. Mockup shows them. | M9 |
| 16 | Rep success rate counts only commission-unpaid orders | Design 4.4 | Count delivered by status. | M1 |
| 17 | Delivery rate mixes cohorts; four revenue definitions | Design 9 | KPI service. | M1 |
| 18 | `getCustomerInsights.activeCustomers` duplicates total | Backend 2.8 | Drop with RP-15. | M1 |
| 19 | Accountant and inventory dashboards use fetchers that may be stubs | Frontend 3 | Replace with KPI services. | M3 |
| 20 | Unrouted files: `Dashboard`, `OrdersList`, `OrdersKanban`, `CallsDashboard`, `WorkflowEditor` + `components/workflow/*`, `MobilePlaceholder`, `MobileNav`, `AgentCreateModal` | Frontend 3 | Delete. | M3 |
| 21 | Orphaned finance components (`AgentAgingTab`, `AgentReconciliationTab`, `CashFlowTab`, `OverviewTab`, `DepositActionModal`) and unused finance calls | Frontend 3 | Delete. | M5 |
| 22 | Dead service methods: `markDeliveryFailed`, `createDelivery`, `autoAssignAgent`, `getAgentStats`; customer merge/tags/top; `notifyOrderAssigned` and two more; analytics time series | Backend 0, 2 | Delete, or reuse in new services. | M1 to M5 |
| 23 | Header search does nothing | Frontend 0 | Command palette. | M3 |
| 24 | Checkout editor help text links to `/settings/integrations` (no route) | Frontend 3 | Link to Connections. | M3 |
| 25 | Kanban `$` hard-coded; Earnings History GHS hard-coded | Frontend 0 | Moot (dropped). Use store currency. | M3 |
| 26 | Currency lists differ (Settings 10, onboarding 8) | Frontend 4.5 | One list. | M1 |
| 27 | Orders assign UI missing; endpoints exist | Frontend 3 | Build (OR-09). | M3 |
| 28 | `PATCH /products/:id/stock` overwrites with no ledger | Backend 1.6 | Remove. | M4 |
| 29 | Delivery routes have no role or ownership check | Backend 7.5 | Add checks. | M0 |
| 30 | `GET /admin/config` unauthenticated, tenantless | Backend 7.5 | Resolve tenant from host or require auth. | M0 |
| 31 | Socket rooms not tenant-scoped; workflow events use global emit | Backend 3.4 | Prefix rooms with tenant. | M0 |
| 32 | `/metrics` and `/health/detailed` public | Backend 7.5 | Restrict. | M0 |
| 33 | `SYSTEM_USER_ID = 1` assumed to exist | Backend 6.5 | Per-tenant system user. | M2 |
| 34 | `agingService.refreshAll` global `deleteMany({})` | Backend 2.5 | Per tenant. | M0 |
| 35 | Chart seeded with NULL tenant; global unique `Account.code`, `JournalEntry.entryNumber` | Backend 7.3 | Per-tenant unique and seed. | M0 |
| 36 | 12 models lack `tenantId` | Backend 7.3 | Add and scope. | M0 |
| 37 | Three empty migration folders; deploy script tolerates failed migrate | Design 9 | Diff against prod. Fail the deploy. | M0 |
| 38 | Legacy Paystack webhook past sunset | Backend 1.24 | Remove. | M0 |
| 39 | MCP: no identity, global 30/min bucket, stale schema | Backend 4 | Registry. | M2 |
| 40 | Round-robin index in memory, lost on restart | Backend 2.1 | Store in Redis or DB. | M6 |
| 41 | WhatsApp OAuth pending state in memory | Backend 3.3 | Move to Redis. | M9 |
| 42 | `Tenant.defaultDeliveryFee` never read; public checkout shipping fixed at 0 | Backend 0 | Replace with `FeeRule`. | M5 |
| 43 | `emailTemplate.service` has no UI | Frontend 3 | Wire in Messages (MS-09). | M9 |
| 44 | Pricing page caps (5 products, 10 agents, 5 forms) not enforced | Frontend 2 | Leave. SaaS item. | Later |
| 45 | Platform tenant plan filter lists Free, Starter, Pro | Frontend 3 | Use live plan names. | Later |
| 46 | `Call` has no `tenantId` | Design 5.3 | Add. | M0 |
| 47 | `getCashFlowReport` may double count; financial summary may omit digital revenue and Paystack fees | Design 9 | Check and fix with KPI definitions. Paid digital orders now count. | M1 |
| 48 | Expense delete may not reverse GL entry | Backend 1.11 | Test. Fix. | M5 |
| 49 | Order status `failed_delivery` missing from Kanban | Frontend 3 | Moot. | M3 |
| 50 | `CLAUDE.md` names Shadcn and `WorkflowEditor` | Design 9 | Fix. | M0 |

---

## 4. Mockup fixes list

33 known issues (3 approved fixes + 30 others), deduped into 30 rows. "Needs owner" means a real product choice. The question number is in Section 5.

| # | Issue | Screens | Proposed resolution | Needs owner |
|---|---|---|---|---|
| 1 | **Approved.** Rewards in two places. Airtime tier. | Settings, Leaderboard, Staff, Rep, Agent, Inbox, Finance, Targets | Rewards only in Settings, Rewards. North Star tab keeps a one-line link. Cash tiers only: call rep 100% GH₵300, 120% GH₵500 + paid day off; delivery 100% GH₵250, 120% GH₵400 + paid day off. Remove every "80% airtime" line. All screens read the one setting. Drop "Airtime and rewards" as an expense category name. | No |
| 2 | **Approved.** AOV is a typed field. | Settings Business, setup wizard | Remove from Business details. Show computed AOV in Reports. Setup uses planned AOV, default last 30 days, editable. | No |
| 3 | **Approved.** Currency and FX. | Settings Business, Currencies, all ₦112 prints | Store currency locked after first sale. Daily auto rate with manual override and per-day history. Stale warning for manual only. Print the rate used for that day. | No |
| 4 | Stock modals and holder table in Products and Inventory | Products, Inventory | One shared component set. Actions live in Inventory. Products expand is read-only with "Open in Inventory". | No |
| 5 | Payouts recorded in Finance and in Staff; different histories; agent pay missing from books | Finance, Staff | One payout record and one modal, opened from both. One history. Post agent pay to a payable account. | Yes (Q3) |
| 6 | Reports repeats other screens | Reports, Finance, Marketing, Deliveries | Reports tabs reuse the same components. One KPI service. P&L is canonical in Finance, Statements. | No |
| 7 | Tracking in two places with different pixel IDs | Checkout forms, Connections | Pixel and CAPI set per form only. Connections shows a read-only summary. Remove the second pixel field. | No |
| 8 | Time zone, country, currency repeated | Profile, Business, form | Time zone and country only in Business details and FX. Form default country follows the store. | No |
| 9 | Agent app has its own notification switches | Agent More, Inbox | Same notification store. | No |
| 10 | Order statuses differ per screen; "Not reachable" shown as order status | Orders, Settings, Dashboard, Rep, Agent | Settings shows the real 9 as read-only. Rep and agent labels are views of the same status. "Not reachable" is a call outcome. | No |
| 11 | Order ID formats (#24xxx, CA-482xx, #MG-104xx) | Orders, Rep, Agent, Workflows | One format everywhere. | No |
| 12 | Same ID maps to different customers; amounts differ (Abena Owusu GH₵249 vs GH₵498) | Inbox, Orders, Messages, Agent | Fix sample data. One order table feeds all screens. | No |
| 13 | Product delivered counts disagree (306 vs 328, pens 172 vs 116, grip 89 vs 58, guide 58 vs 63) | Products, Finance, Reports | Use Finance and Reports figures. Products reads the same service. | No |
| 14 | Copybook loss GH₵20,400 vs table −GH₵17,300 | Finance | Use the table. Compute the card text. | No |
| 15 | Logiswift missing orders are GH₵280 each; prices are GH₵249 | Finance | Use real order amounts. Total GH₵840. | No |
| 16 | Agent Home "5 of 8" vs "3 of 8" | Agent | Count from the list. | No |
| 17 | Customers card says GH₵40 per refused order; fee rules say GH₵0 to GH₵5 | Customers | Compute from fee rules and lost units. | No |
| 18 | Messages totals disagree (2,860 vs 4,070); tab says 38, list shows 26 | Messages | Derive from message events. | No |
| 19 | Agent drawer text differs by page; "Accra Central 18%" not in `NUMBERS.md` | All admin pages | One text source. Use 48% and 60%. Add the Accra Central finding to `NUMBERS.md` or remove it. | No |
| 20 | Dashboard quest "Failed delivery calls 6 of 15" has no setting | Dashboard | Add as call rep daily target in Targets. | No |
| 21 | Targets lists 5 delivery holders; Leaderboard shows 4. Badge conflict (Kofi September vs "No one yet") | Targets, Leaderboard, Settings | Show all 5. Kasapa Express is "too early". One badge store. | No |
| 22 | `DESIGN-SPEC.md` still lists 26% and ₦6,400 | Docs | Update the doc. | No |
| 23 | Staff header strings static (10 on team, 12 shown) | Staff | Derive counts. | No |
| 24 | Region lists use 6 or 7 regions; Reports "regions" are cities | New order, Messages, Reports, Workflows | Use the 16 Ghana regions. Label cities as cities. Coverage by region needs partner data. | Yes (Q7) |
| 25 | Dead buttons (about 40) | All admin pages | Every button is wired or removed. Wire: This month, Targets Add target, Customers Export, Add customer, filters, Orders filters, Deliveries Upload CSV, Add delivery partner, partner tabs, Edit rules (opens Settings, Rewards), FX Save and Use today's rate, Staff New role, Inbox New thread, Open item, row buttons, setup Back and Save, palette actions, drawer input. Remove: Download report, Add status, store chip. Avatar opens a menu. Agent suggestion buttons open a pre-filled screen. Direct writes (Cut budget, Raise budget, Assign all 9, Give them to Adwoa) need a confirm step and wait for M12. | No |
| 26 | North Star steps 4 to 6 have no screen; growth switch does nothing; GH₵180k and ₦20,720 fixed | Setup wizard | Drivers on step 3. Step 4 opens the Staff invite. Step 5 links to Rewards. Growth switch recalculates the quarters. Month target and max CPA computed. | No |
| 27 | Agent app: WhatsApp and Maps dead; Call uses a fixed number; Twi and Ga placeholders; no Earnings view | Agent | Use the customer's phone, wa.me and a maps link. Hide language switch (English only). Add a My pay view. Add reference number to New deposit. | No |
| 28 | "Shopify order import" workflow with no Shopify connection | Workflows | Remove the template. The webhook importer covers it. | No |
| 29 | Delete confirms inconsistent; Customers search is a button | Orders, Forms, Workflows, Staff, Customers | One confirm dialog pattern with a count. Make search an input. | No |
| 30 | Reports "Failed 402" counts failed + returned; Orders shows them apart | Reports | Show failed 354 and returned 48. | No |

Extra problems found while building this matrix (not in the 33):

| # | Issue | Screens | Proposed resolution | Needs owner |
|---|---|---|---|---|
| E1 | Chart of accounts numbers in the mockup (1000, 1100, 2100, 4000, 5100, 5200) differ from live codes (1010, 1015, 1020, 2020, 4010, 5040, 5100) | Finance, design KPI table (GL 2100) | Keep live codes. Relabel mockup and design doc. Add accounts for ad spend, agent pay payable. | No |
| E2 | Billing plan numbers (Growth 1,500 orders, 2 stores, 3 AI keys) differ from live plans (5,000 orders, 10 staff) | Settings Billing | Hide tab for owner tenant. Fix numbers when SaaS starts. | Yes (Q2) |
| E3 | "Confirm" outcome list and "Cancelled" status: rep outcomes (Declined, Wrong number) map to which order status | Rep, Orders | Declined sets Cancelled with reason. Wrong number sets Cancelled with reason "wrong number". Not reachable keeps Pending. | No |
| E4 | Agent card "Ask for prepayment" and Paystack "Real customers cannot pay yet" with COD only | Customers, Connections | Remove "Ask for prepayment". Keep Paystack for digital products. | Yes (Q1, Q6) |

---

## 5. Owner questions

Only product choices that block the PRD. Not asked: the 7 design-doc questions and the other locked decisions.

| # | Question | Recommended answer | Why |
|---|---|---|---|
| Q1 | Paid digital orders count as revenue, but we sell physical goods COD only. Do we keep Paystack checkout for digital products only (the guide, GHS)? | Yes. Paystack on digital forms only. Physical forms show COD only. | Digital has no COD path. Without Paystack, paid digital revenue cannot exist. |
| Q2 | Billing and plans, "2 stores" and plan limits: hide them for your own tenant until SaaS starts? | Yes. Hide the tab, the store chip and the banners. Keep the code. | You run your business first. The mockup numbers also disagree with the live plans. |
| Q3 | Should delivery-agent pay (Kofi owed GH₵184, Esi GH₵80, Kwesi GH₵312) post to the books as a payable when the order is delivered, like rep commission? | Yes. Post to an agent-pay payable on delivery. Pay out from the one payout modal. | Today agent pay is in no P&L or balance sheet. Margin is overstated. |
| Q4 | When is a target reward earned: at month close only, or the moment 100% is hit? | Month close, on delivery-date numbers. | Delivery results can still fall after a mid-month hit (returns, reversals). |
| Q5 | Does the time-to-first-call clock run outside operating hours? What are the hours? | No. Count only inside operating hours. Owner enters hours in Settings, Operations. | Night orders would break the 15-minute target and the 30-minute alert for every rep. |
| Q6 | Customer refusal rule: what happens at 2 and at 3 refused deliveries? | Flag High risk at 2. At 3 turn COD off and send the order to a manual call. Owner can override. | The mockup says "COD off" at 3. With COD only, blocked customers cannot order at all. Needs a rule and an override. |
| Q7 | Which regions and cities does each partner cover, and who is the fallback? | Fallback is Logiswift (as in the mockup). You enter the coverage per partner once. Use all 16 regions. | "By region" assign needs the map. The mockup uses cities and 6 regions. |
| Q8 | Reports: build saved reports, 7-day recent exports and PDF in the first release? | No. CSV and Excel direct download only. Saved reports and recent exports later. | They need file storage and a saved-view model. They do not change any number. |
| Q9 | Can call reps create orders and add customers (WhatsApp or phone orders)? The rep app has no screen for it. | Yes. Add "New order" to the rep Queue. Reps can add and edit customers. | Reps have this permission today. Removing it would stop phone orders. |
| Q10 | Can an AI agent ever change data from a suggestion card in the first release (for example "Assign all 9 to Adwoa")? | No. Cards open a pre-filled screen. A person clicks confirm. Direct AI writes start in M12. | Locked decision 10 says read-only first. Several cards in the mockup write. |

---

## 6. Counts

| Section | Rows |
|---|---|
| 1 Feature matrix | 326 |
| 2 Settings matrix | 93 |
| 3 Broken or dead | 50 |
| 4 Mockup fixes | 30 (+4 extra) |
| 5 Owner questions | 10 |

Feature matrix by verdict: KEEP as-is 8, KEEP+RESTYLE 60, CHANGE 73, NEW 114, DROP 20, MISSING-IN-MOCKUP 51.
