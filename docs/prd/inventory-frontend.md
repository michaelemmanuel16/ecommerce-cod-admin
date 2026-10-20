# CodAdmin frontend inventory (as built, 2026-10-18)

Source of truth: `frontend/src/App.tsx` router. GUESS = inferred, not confirmed in code. File paths are relative to `frontend/src`.
Roles: `super_admin`, `admin`, `manager`, `sales_rep`, `inventory_manager`, `delivery_agent`, `accountant`. Plus the `isPlatformAdmin` flag (platform operators, no tenant store).
Permissions come from `SystemConfig.rolePermissions` (see 4.8). `super_admin` bypasses every `can()` check.

## 0. Global shell and cross-cutting behaviour
- Router has two trees, chosen by `isPlatformDomain()` (`VITE_PLATFORM_DOMAIN`): platform subdomain vs main tenant domain.
- `ProtectedRoute`: not authenticated -> `/login`. `needsOnboarding()` (role `super_admin`, `preferences.onboardingCompleted` false, not platform admin) -> `/onboarding`.
- `RoleGuard allowedRoles`: wrong role -> redirect `/`.
- `MobileRedirect`: delivery_agent on a mobile viewport with localStorage `MOBILE_OPT_IN=true` and no `DESKTOP_FLAG` -> `/m/`.
- `DashboardIndex`: platform admin on `/` -> `/platform`; everyone else gets DynamicDashboard.
- App boot: `fetchConfig()` (`GET /api/admin/config/me` if signed in, else `GET /api/admin/config`) fills `configStore` (businessName, currency). Also `refreshPermissions()` and `initSocket()` (socket.io, `VITE_WS_URL`).
- Desktop `Layout`: collapsible Sidebar (localStorage `sidebarCollapsed`), Header, `AnnouncementBanner` (`GET /api/platform/announcements/active`; types info/warning/maintenance), `PendingPlanBanner` (tenant `subscriptionStatus=pending`; button to Paystack checkout), page outlet.
- Header: search input "Search orders, customers..." (no handler, GUESS decorative). `NotificationBell` (in-memory `notificationsStore`, fed by socket `order:created`, `order:updated`, `order:status_changed`; Mark all as read; click marks read). Help menu for `sales_rep` only (Take Tour Again; View Full Guide -> `/docs/guides/CUSTOMER_REP_ONBOARDING.html`). `UserMenu` (Settings, Logout).
- Sales-rep onboarding tour (`components/onboarding`: `CustomerRepOnboarding`, `OnboardingWelcomeModal`, `tourSteps.tsx`), about 11 steps: dashboard earnings card, pending orders, stats cards, Orders link, New Order button, orders table header, search bar, Customers link, Add Customer button.
- `UpdatePrompt` (PWA update toast), `ErrorBoundary`, `Toast` (react-hot-toast).
- Socket events consumed by stores: `order:created/updated/assigned/status_changed`, `orders:created/updated/deleted`, `delivery:completed/updated/assigned`, `bulk_import_completed`, `call:logged`, `rep:updated`, `rep:availability_changed`, `rep:workload_changed`, `agent:updated`, `agent:availability_changed`, `permissions:updated`, `transaction:created/updated/deposited/reconciled`, `cod:collected`, `expense:created/updated/deleted`, `payment:received`, `product:updated`, `product:stock_changed`.
- Order status enum (9): `pending_confirmation`, `confirmed`, `preparing`, `ready_for_pickup`, `out_for_delivery`, `delivered`, `cancelled`, `returned`, `failed_delivery`. Payment status enum (3): `pending`, `collected`, `reconciled`. These are separate fields (memory rule).
- User preferences: `GET/PUT /api/users/preferences` -> `{ordersDefaultView: 'kanban'|'list', onboardingCompleted, onboardingCompletedAt}`.
- Env vars: `VITE_API_URL`, `VITE_WS_URL`, `VITE_PLATFORM_DOMAIN`, `VITE_SENTRY_DSN`.
- Currency formatting uses `configStore.currency` (`utils/format.ts`); some pages hard-code GHS or `$` (see Earnings History, kanban OrderCard).

## 1. Sidebar / nav as it is today
Desktop sidebar (`components/layout/Sidebar.tsx`), items filtered by `usePermissions().canAccessMenu(key)`:

| Label | Path | Visible when |
|---|---|---|
| Dashboard | `/` | all roles |
| Orders | `/orders` | `can(orders,view)` |
| Customers | `/customers` | `can(customers,view)` |
| Products | `/products` | `can(products,view)` and role is not sales_rep / delivery_agent |
| Delivery Agents | `/delivery-agents` | manager, admin, super_admin |
| Customer Reps | `/customer-reps` | manager, admin, super_admin |
| Financial | `/financial` | `can(financial,view)` |
| Earnings History | `/earnings-history` | sales_rep only |
| Analytics | `/analytics` | manager+ or accountant |
| Workflows | `/workflows` | `can(workflows,view)` |
| Communications | `/communications` | manager+ |
| Settings | `/settings` | all |

- Routed but NOT in the sidebar: Agent Inventory `/agent-inventory` (menu key exists in `canAccessMenu`, no sidebar item), Checkout Forms `/checkout-forms` (reached from Settings tab), Webhooks `/webhooks` (from Settings > Integrations), Billing `/settings/billing`.
- Platform Admin block (top of sidebar, `isPlatformAdmin` only): Platform `/platform`, Tenants `/platform/tenants`, Billing `/platform/billing`, Announcements `/platform/announcements`. Tenant menu is hidden for platform admins and on `/platform*`.
- delivery_agent extra button at the bottom: "Mobile View" (clears DESKTOP_FLAG, sets MOBILE_OPT_IN, goes to `/m/`).
- Sidebar title "COD Admin / E-commerce Dashboard", collapsed shows "COD".
- Platform subdomain `PlatformLayout`: own sidebar (Dashboard `/`, Tenants, Announcements, Billing), collapse key `platformSidebarCollapsed`, header "Platform Admin" + UserMenu.
- Mobile agent bottom tabs (`MobileLayout`): Dashboard `/m/`, Deliveries `/m/deliveries`, Inventory `/m/inventory`; "More" sheet: Collections, Settings, Switch to Desktop, Logout.
- `components/layout/MobileNav.tsx` (hamburger with Dashboard/Orders) is unused.

## 2. Feature flags and plan gating
- Plans (table `plans`: name, displayName, maxOrders, maxUsers, priceGHS, priceNGN, paystackPlanCode, features JSON, isActive):
  - `free`: admin-granted only, unlimited, never billed.
  - `growth`: NGN 10,000/mo. Per Pricing page: 5,000 orders/mo, 10 staff, 5 products, 10 delivery agents, 5 checkout forms.
  - `scale`: NGN 20,000/mo, unlimited.
  - `enterprise`: contact sales@codadmin.app.
- Cap enforcement: backend `billingController` only reports `maxOrders` and `ordersThisMonth`. I found no cap enforcement in backend src (GUESS: display only; product, agent, form, staff caps on the Pricing page are not enforced).
- `billingEnabled` from `GET /api/billing/subscription` (`isPlatformBillingConfigured()`). When false the Billing page shows "Billing is being set up" and hides subscribe actions.
- Subscription states used in UI: `active`, `pending`, `past_due`, `cancelled`, `suspended`, trial (`trialEndsAt`). `past_due` and `pending` show banners with "Update payment method" / "Complete payment".
- Tenant rate limit: `rateLimitEnabled` + `rateLimitConfig {requestsPer15Min, burstPerSec}`, set by platform admin. `tenantRateLimiter` is wired on communication routes (GUESS: elsewhere too).
- Tenant `freeAccessExpiresAt` set by platform "Grant Free Plan".
- WhatsApp OAuth flag: `GET /api/whatsapp/oauth/enabled` (needs server `META_APP_ID` and `META_APP_SECRET`); otherwise only Manual Setup.
- Email composer shows "Email provider not configured" when no email provider.
- Checkout payment methods: "Nigeria only" copy, max two of three enabled; Paystack methods need tenant Paystack keys.
- Hard-coded role guards: `/analytics` (super_admin, admin, manager, accountant), `/communications` (super_admin, admin, manager), `/webhooks` (super_admin, admin), `/agent-inventory` (super_admin, admin, manager, inventory_manager, delivery_agent), `/earnings-history` (sales_rep), `/m/*` (delivery_agent), `/platform*` (isPlatformAdmin).
- Inconsistency: Settings admin tabs check `isSuperAdmin` only (`visibleTabs = tabs.filter(!adminOnly || isSuperAdmin)`), so the `admin` role sees none of them even though default permissions give admin `users` CRUD.

## 3. Pages (53 route entries, 41 distinct page components)

### Auth and public (tenant domain)

## `/login` - Login (`pages/Login.tsx`)
- Public. Zod: email valid, password min 6. Links: "Forgot password?" `/forgot-password`, "Sign up" `/register`.
- Data: `authService.login` -> `POST /api/auth/login`; `authStore`.

## `/register` - Register (`pages/Register.tsx`)
- Public. Fields: companyName (min 2), adminName (min 2), adminEmail, adminPassword (min 8, upper+lower+number+special). Query `?plan=growth|scale` required; bare `/register` or `plan=enterprise` redirects to `/pricing`. Link to sign in.
- Data: `POST /api/auth/register-tenant` with `planName`. Plan payment happens in onboarding.

## `/forgot-password` - ForgotPassword
- Field: email. Success text "If an account exists with that email, we've sent a reset link"; link expires in 15 minutes. Back to login. `POST /api/auth/forgot-password`.

## `/reset-password` - ResetPassword
- Query `token`. Fields: password, confirmPassword (must match). Invalid/expired state with "Request a new reset link". `POST /api/auth/reset-password`.

## `/platform/login` - PlatformLogin (main domain; same component at `/login` on platform subdomain)
- Fields: email (placeholder platform@codadminpro.com), password. Redirects into platform tree when `isPlatformAdmin`. `POST /api/auth/login`.

## `/pricing` - Pricing (`pages/Pricing.tsx`, public, static)
- Tiers: Growth NGN 10,000 ("Most popular"), Scale NGN 20,000, Enterprise "Let's talk".
- Cap table rows (Growth / Scale / Enterprise): Orders per month 5,000 / Unlimited / Unlimited; Staff accounts 10 / Unl / Unl; Products 5 / Unl / Unl; Delivery agents 10 / Unl / Unl; Checkout forms 5 / Unl / Unl; All feature modules Included; Custom integrations, manager, SLA Enterprise only.
- "Every plan includes": Orders & COD, CRM, Inventory, Delivery agents + app, Cart recovery, Paystack + COD, Email + SMS alerts, Finance & accounting, Reps & commissions, Workflows, Bulk WhatsApp + SMS, Meta pixel / CAPI, API access, Advanced reports + CSV, Priority support.
- CTAs: `/register?plan=growth|scale`, mailto:sales@codadmin.app. Log in link. Table stacks to cards under md.

## `/onboarding` - Onboarding (`pages/Onboarding.tsx`)
- Guard: ProtectedRoute with skipOnboardingCheck; meaningful for `super_admin` only.
- Step 1 Country & Currency: country select (Ghana, Nigeria, Kenya, South Africa, Uganda, Tanzania, Rwanda, Ethiopia, Zambia, Zimbabwe), currency (auto from country; options GHS, NGN, KES, ZAR, UGX, TZS, RWF, ETB; default GHS).
- Step 2 Business Details (all optional): businessEmail, businessPhone, businessAddress, taxId. Buttons Back, Skip, Save & Continue.
- Step 3 Done: if subscription is `pending`, "Activate <plan>" -> Paystack redirect; else "You're all set" -> dashboard (sets `preferences.onboardingCompleted`).
- Data: `POST /api/onboarding/setup`; `GET /api/billing/subscription`; start subscription (Paystack authorization URL).

## `/form/:slug` - PublicCheckout (`pages/PublicCheckout.tsx`; no auth; embeddable iframe)
- Data: `GET /api/public/forms/:slug`; `POST /api/public/forms/:slug/orders` (adds Meta `_fbp`/`_fbc` cookies); `POST /api/public/forms/:slug/track/initiate-checkout` (server CAPI mirror).
- Sections: product header (name, description; hideable), Package selector "Select Package" (cards, "Most Popular", discount and original price, highlight text), Add-on selector (upsells with image and expandable description), "Your Information" (dynamic fields), Order Summary (hideable; packages, add-ons, total), one CTA per enabled payment method (COD "Place Order", "Pay a Deposit", "Pay in Full"), Paystack refund note, terms note. Offer position top or bottom.
- Behaviour: pixel init (FB pixel + image beacon + CAPI dedup by eventID, GA4, TikTok, GTM) in `utils/pixelTracking.ts`; localStorage cooldown `checkout_cooldown_<slug>` (blocks double submit); iframe height `postMessage` to parent; `redirectUrl` custom thank-you with params orderId, total, currency, reference, package; Paystack `authorization_url` redirect; OrderSuccess screen ("Order Placed Successfully!", "What's Next?", support line); "Form Not Found" screen with "Go Home". Phone validation 8-15 digits. Styled from form `design`.

## `/checkout/payment/callback` - PaymentCallback
- Query `reference`. States: "Confirming your payment", "Order received", "Payment Issue". `GET /api/paystack/verify/:reference`.

## `/checkout-forms/:id/preview` - CheckoutFormPreview (bare shell, iframe inside editor)
- ProtectedRoute only (any role). `GET /api/checkout-forms/:id/preview-config`; listens for draft form via `postMessage` from the editor; renders the public form with GHS defaults; posts height to parent.

### Desktop admin app (Layout)

## `/` - Dashboard (`pages/DynamicDashboard.tsx`)
- All tenant roles. Config picked by role from `config/dashboards`: admin, manager and super_admin share `adminConfig`; sales_rep, delivery_agent, accountant, inventory_manager each have their own. Unknown role -> "Dashboard Not Available".
- Common: date range picker (default this month), Refresh button, throttled socket refetch, optional auto-refresh interval, widget types `stat`, `lineChart`, `donutChart`, `barChart`, `leaderboard`, `dataTable`, `ordersAwaiting`, `recentActivity`.
- Admin / Manager ("Admin Dashboard"): stats Total Revenue, Total Orders (previous-period comparison), Total Customers, Delivery Rate; line Order Fulfillment Trend; donut Order Status Distribution. Presets: today, yesterday, this-week, this-month, last-7-days, last-30-days, this-year, last-year. Realtime: order:created/updated/assigned/status_changed, delivery:completed, bulk_import_completed. Fetchers: `/api/analytics/dashboard`, `sales-trends`, `conversion-funnel`, `status-distribution`, `customer-insights`.
- Accountant ("Financial Overview"): stats Total Collected, Pending Collections, Reconciled Today, Discrepancies; line Daily Collections; donut Payment Status Distribution; bar Revenue by Region; line Cash Flow Analysis; leaderboard Top Revenue Sources; table Pending Reconciliation (Order ID, Customer, Amount, Delivered, Status, Agent). Presets Today to Last Quarter. Realtime: order:status_changed, delivery:completed, payment:received. Fetchers fetchFinancialMetrics, CollectionsTrends, PaymentsByStatus, RevenueByRegion, CashFlowData, TopRevenueSources, PendingReconciliation (GUESS: some have no backend endpoint yet).
- Sales rep ("Rep Dashboard"): stats My Earnings (calculated), My Pending Orders, My Total Orders, My Conversion Rate; line My Orders vs Deliveries; donut My Order Status Distribution. Presets Last 7 days to All Time. Realtime order:*. `/api/analytics/rep-performance`.
- Delivery agent ("My Deliveries"): stats My Earnings, My Active Deliveries, My Completed Deliveries, My Success Rate; donut Orders by Status; ordersAwaiting "Ready for Pickup". Realtime delivery:updated/assigned/completed. `/api/analytics/agent-performance`, `/api/deliveries/agent-orders`.
- Inventory manager ("Inventory Overview"): stats Total Products, Low Stock Items, Out of Stock, Inventory Value; bar Stock Levels by Category; leaderboard Top Selling Products; line Inventory Turnover; bar Product Performance; line Stock Movement; table Low Stock Items (Product, SKU, In Stock, Reorder Level, Units Sold, Last Restock). Realtime product:updated, product:stock_changed, order:created. GUESS: several fetchers (fetchInventoryMetrics etc.) may be stubs.
- The same component also serves `/m/` for delivery agents.

## `/orders` - Orders (`pages/Orders.tsx`)
- Roles: `orders:view`. `can('orders','bulk_import')` gates Import. `can('orders','delete')` gates row and bulk Delete. New Order is not gated in UI.
- Toolbar: Filters (side panel: Order Status multi-checkbox of 9 statuses, Apply / Reset, date range preserved), Import, Export, New Order, view toggle Kanban / List (persisted as preference `ordersDefaultView`), SearchBar "Search orders...", DateRangePicker "Filter by date range".
- List columns (resizable; widths in localStorage `orders-column-widths`): checkbox, Order ID (sort), Customer (sort), Phone, Alt. Phone, Address (street, state), Products (names, upsell name, "N items"), Amount (sort), Status (inline select of 9), Date (sort), Actions (View Details, Edit Order, Log Call, Delete Order). Sorting is client-side on the loaded page. Page sizes 25/50/75/100.
- Bulk bar (list view only): "N order(s) selected", Change Status... select, Delete Selected, Clear Selection.
- Kanban (`components/kanban`): 7 columns (pending_confirmation, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, returned), no cancelled / failed_delivery column; drag-drop (dnd-kit) between columns updates status; OrderCard shows id, phone, amount (hard-coded `$`), date, items.
- Modals: OrderForm, CallHistoryModal -> LogCallModal, BulkImportModal, FilterPanel.
- OrderForm fields: customerName*, customerEmail, customerPhone*, alternatePhone, status (9), order items (product select, quantity, price; add/remove row; Total Amount), street*, state*. Products from `GET /api/products`.
- BulkImportModal: .csv/.xlsx/.xls, drag/drop, template download `order_import_template.csv`, required Customer Phone and Total Amount; result counts Successful / Failed / Duplicates; error details list; "Import Another File".
- LogCallModal: outcome (Confirmed, Rescheduled, No Answer, Cancelled, Other), duration (optional), notes. `POST /api/calls`.
- CallHistoryModal "Call History - Order #N": list of calls, Log Call button.
- Data: `GET /api/orders` (page, limit, search, status[], startDate, endDate, customerId), `PATCH /api/orders/:id/status`, `PUT /api/orders/:id`, `POST /api/orders`, `DELETE /api/orders/:id`, `DELETE /api/orders/bulk`, `GET /api/orders/export`, `POST /api/orders/upload`, `GET /api/calls/order/:id`. Assign endpoints exist in service (`PATCH /api/orders/:id/(rep|agent)`) with no UI found on this page.
- Realtime: refetch on `order:created`, `order:status_changed`, `order:updated`.

## `/orders/:id` - OrderDetails
- Roles as Orders. Header: back, order id, "Log Call".
- Cards: Order Items (product, qty, price, total, "No items in this order", Total), Customer Information (Name, Email, Phone, Alternative Phone, Shipping Address), Payment (Payment Method, Payment Status badge, Total Amount), Timeline (Created, Last Updated, Estimated Delivery), Assigned To (Customer Rep, Delivery Agent), Call History. LogCallModal.
- Data: `GET /api/orders/:id`, `GET /api/calls/order/:id`. Read-only: no edit or status change here.

## `/products` - Products
- Roles: `products:view`, not sales_rep / delivery_agent. Buttons: Incoming Inventory (modal), Add Product. Search "Search products by name, SKU, or category...".
- Columns: expander, Product, SKU, Category, Price, Warehouse (stock + badge Out of Stock / Low Stock (<= lowStockThreshold) / In Stock), With Agents, Status, Actions (Edit Product, Delete Product with confirm).
- Row expand -> `AgentStockPanel`: per-agent rows (quantity, In Transit), buttons History, Allocate, per-row Transfer to another agent / Return to warehouse.
- Modals: AllocateStockModal (agent select, quantity, notes optional), TransferStockModal (destination agent, quantity, notes optional), ReturnStockModal (quantity, reason optional), TransferHistoryModal (type filter: allocation, order_fulfillment, agent_transfer, return_to_warehouse, adjustment; 20 per page), IncomingInventoryView (filter tabs, shipments with Pending/Arrived status; Add Shipment, Edit shipment, Mark as arrived, Delete shipment), AddShipmentModal.
- AddShipmentModal fields: product*, supplier, quantity*, unitCost*, shippingCost, customsDuties, otherCosts, expectedArrivalDate, notes.
- Data: `GET /api/products`, `DELETE /api/products/:id`, `GET /api/agent-inventory/product/:id`, `POST /api/agent-inventory/allocate|transfer|return`, `GET /api/agent-inventory/transfers`, shipments `GET|POST /api/products/shipments`, `PATCH /api/products/shipments/:id`, `PATCH .../:id/arrive`, `DELETE`.

## `/products/new`, `/products/:id/edit` - ProductForm
- Fields: productType (Physical / Digital toggle), name*, description, sku* (uppercased), category*, image upload (png/jpg/gif up to 5 MB; preview, remove; `POST /api/upload`), price*, cogs*, stockQuantity (physical), lowStockThreshold (default 10), isActive (default true), live Profit Margin display.
- Digital only: digitalFileUrl* (Drive / Dropbox link), digitalFileType (pdf, ebook, zip, video, audio, other), downloadLinkExpiryHours (default 72).
- Data: `GET /api/products/:id`, `POST /api/products`, `PUT /api/products/:id`.

## `/customers` - Customers
- Roles: `customers:view`. Add Customer (modal). Search "Search customers by name, email, or phone...". Sortable Orders and Total Spent. Pagination.
- Columns: Customer (name, ID), Phone, Location (state), Orders, Total Spent, Actions (View Details, Edit Customer, Delete Customer with confirm). Row click opens detail.
- CustomerForm fields: name*, email, phone*, alternatePhone, street*, state*, notes ("Internal Notes (Optional)").
- Data: `GET /api/customers` (page, limit, search, area, sortBy totalOrders|totalSpent, sortOrder), `POST|PUT|DELETE /api/customers[/:id]`.

## `/customers/:id` - CustomerDetails
- Header: back, Edit Customer (modal). Cards: Total Orders, Total Spent, Avg Order Value. Contact (email mailto, phone tel, alt phone). Address (street, area, state). Orders table (Order #, Date, Status, Amount, View) + "View All Orders". Data: `GET /api/customers/:id`, `GET /api/orders?customerId=&limit=100`.

## `/delivery-agents` - DeliveryAgents
- Roles: manager+. Note "Manage agents in Settings -> User Management" (no Add button on this page). Search "Search agents by name, email, or phone...". DateRangePicker.
- Columns: DeliveryAgent (name, ID), Contact (email, phone, location), Vehicle (type, vehicleId or "Not set"), Performance (MTD success %, MTD completed of assigned, all-time), Earnings (MTD earnings, per-delivery rate, deliveries MTD), Status (Active/Inactive, Available/Unavailable), Actions (Edit agent).
- AgentEditModal fields: firstName*, lastName*, email*, phoneNumber, vehicleType (Motorcycle, Bicycle, Van, Truck, Car), vehicleId, deliveryRate (also saved as commissionAmount), location, isActive. AgentCreateModal (same plus password) exists with no trigger on this page (GUESS orphaned).
- Data: `GET /api/admin/users?role=delivery_agent`, `GET /api/users/agents/performance`, `PUT /api/users/:id`, `PATCH /api/users/:id/availability`. Realtime `agent:updated`, `agent:availability_changed`, `order:assigned`.

## `/customer-reps` - CustomerReps
- Roles: manager+. Search "Search reps by name, email, or phone...". DateRangePicker.
- RepTable columns: Representative (sortable name; initials, ID, since), Contact (email, phone, country), Performance (sortable success rate; MTD delivered of assigned; all-time; pending), Earnings (sortable total), Status, Actions (Edit, View Payments).
- EditRepModal: firstName*, lastName*, email*, phoneNumber*, country* (select), commissionAmount (>= 0; earned per successful delivery), isActive ("Inactive representatives cannot be assigned new orders").
- RepPayoutModal "Payment Details - <rep>": Pending Commissions (checkbox per delivered order, select all, total), Process Payment (method Bank Transfer / Mobile Money / Cash, transaction ref / notes), Payout History (Completed).
- Data: `GET /api/admin/users?role=sales_rep`, `GET /api/users/reps/performance`, `GET /api/users/reps/workload`, `PUT /api/users/reps/:id`, `GET /api/users/reps/:id/pending-payments`, `GET .../payout-history`, `POST .../process-payout {amount, method, orderIds, notes}`. Realtime rep:*.

## `/earnings-history` - EarningsHistory
- Roles: sales_rep only. Summary cards (Total Paid, Total Payments, GUESS a third), table Date, Amount, Method, Orders, Status, Notes. Currency hard-coded GHS. Empty state "No payment history yet". `GET /api/users/me/payout-history`.

## `/agent-inventory` - AgentInventoryRoute (not in sidebar)
- Roles: super_admin, admin, manager, inventory_manager, delivery_agent. Delivery agent gets `AgentMyInventory`; all others get `AgentInventoryManagement`.
- AgentInventoryManagement ("Agent Inventory"), tabs: Summary ("Agents Inventory Overview", per-agent totals, "View"), Detail (assigned stock rows; actions Return to warehouse, Transfer to another agent, Adjust quantity; back arrow), History (Transfer History: filters agent, type [allocation, transfer, return, adjustment, fulfillment], startDate, endDate; pagination). Empty: "No agent inventory yet... Allocate stock to agents from the Products page". Adjust modal: new quantity + required reason.
- AgentMyInventory ("My Inventory", also `/m/inventory`): Assigned Stock list, per-product detail with transfer history; empty "No inventory assigned yet".
- Data: `GET /api/agent-inventory/summary`, `/agent/:id`, `/transfers`, `/product/:id`; `POST /api/agent-inventory/return|transfer|adjust|allocate`.

## `/financial` - Financial
- Roles: `financial:view`. Title "Financial Management". Global DateRangePicker (financialStore.dateRange). Tabs (persisted, key `financial-tab`): Overview, Agent Collections, Accounting & Analysis.
- Overview (`pages/financial/FinancialDashboard.tsx`): KPI Total Revenue, Net Profit (margin), Outstanding Receivables ("Delivered, awaiting collection"), Total Expenses, Pipeline Revenue ("Active orders (not yet delivered)"); "Revenue & Expense Trends" chart; "Liquidity & Cash Forecasting": Cash Available Now, In-Transit Orders, Total Cash Pipeline; "30-Day Cash Flow Forecast" chart with Export CSV. Data: `GET /api/financial/summary`, `/reports?period=daily`, `/pipeline-revenue`, `/cash-flow`, `/cash-flow/export/csv`.
- Agent Collections (`AgentCollections.tsx`): KPIs Agents Holding Cash, Overdue Settlements, Outstanding Receivables, Critical (8+ Days), Warning (4-7 Days); "Exposure Distribution" pie (0-3 / 4-7 / 8+ days); table "Agent Aging & Collections": Agent (sort), Balance (sort), 0-3 Days, 4-7 Days, 8+ Days, Actions (Send reminder, View Details, Block / Unblock Agent). Filter "Show Overdue Only". Export CSV.
  - CollectionActionModal (View Details) tabs Collections (pending collections, checkbox, bulk verify, Reconcile) and Deposits (Verify, Reject with reason). Collection statuses draft, verified, approved, deposited, reconciled. Deposit statuses pending, verified, rejected.
  - Data: `GET /api/financial/agent-aging`, `/agent-aging/export/csv`, `POST /api/agent-reconciliation/agents/:id/block|unblock`, `GET /api/agent-reconciliation`, `/deposits`, `POST .../:id/verify|approve`, `bulk-verify`, `deposits/:id/verify|reject`, `deposits/bulk-verify`, `GET .../agents/:id/balance`, `POST /api/financial/transactions/:id/reconcile`, `/collections/deposit`.
- Accounting & Analysis sub-tabs (default General Ledger):
  - General Ledger: "General Ledger Control" with "Record Journal Entry" (JournalEntryModal: date, description*, lines [account select "code - name", debit, credit, line description], "Add Transaction Line"); Chart of Accounts (search by name or code, Refresh, paginated, type badge asset / liability / equity / revenue / expense, View Ledger); Account Ledger (paginated 20, Export CSV, back). `GET /api/gl/accounts`, `/accounts/:id/ledger[/export]`, `POST /api/gl/journal-entries`.
  - Financial Statements: toggle Profit & Loss / Balance Sheet; Assets, Liabilities & Equity, Net Income; out-of-balance warning; Refresh; Export PDF. `GET /api/financial/profit-loss`, `/balance-sheet`.
  - Profitability Analysis: Export CSV, Export Excel; cards Gross Profit (margin), Net Profit (margin), Total COGS (order count), Commissions ("Agent & Rep commissions"), Operating Expenses ("From GL expense accounts"); Profitability Trend line chart; Product Profitability table (Product, SKU, Quantity, Revenue, COGS, Commission, Gross Profit, Margin). `GET /api/financial/profitability[/export]`.
  - Expense Management: Export CSV (client-side), Add Expense, search "Search expenses...", table Date, Category, Description, Amount, Recorded By, Receipt (View), Actions (Edit expense, Delete expense); expense breakdown chart. AddExpenseModal fields: category (COGS, Delivery, Marketing, Operations, Salaries, Utilities, Other; default COGS), amount*, description*, expenseDate*. `GET|POST /api/financial/expenses`, `PUT|DELETE /:id`, `GET /expenses/breakdown`.
- Realtime store: transaction:*, cod:collected, expense:*.
- Orphaned financial components (not imported anywhere): `AgentAgingTab`, `AgentReconciliationTab` (+ `DepositActionModal` with Select All / Clear, bulk verify), `CashFlowTab`, `components/financial/OverviewTab` (Cash in Hand, Expected Revenue, Quick Stats). Unreferenced service calls: `GET /api/financial/agents/settlement/:id`, `POST /api/agent-reconciliation/deposits` (used by mobile), `/financial/transactions`, `/financial/cod-collections`, `/financial/profit-margins`, `/financial/agent-cash-holdings`.

## `/analytics` - Analytics
- Roles: super_admin, admin, manager, accountant (RoleGuard). Title "Analytics & Insights". Global DateRangePicker (default month to date). Tabs via `?tab=`: overview, sales-revenue, delivery-operations, team-performance.
- Overview: KPIs Total Orders (today), Total Revenue (today), Delivery Rate (delivered / total), Avg Order Value (pending); Revenue & Orders Trend; Order Status chart; Top Sales Rep card; Top Delivery Agent card.
- Sales & Revenue: Revenue & Orders Over Time; Product performance chart; Area distribution chart; table Daily Sales Breakdown (Date, Orders, Delivered, Revenue, Conversion).
- Delivery & Operations: Delivery Rate Trend (area); Order Pipeline funnel; failure reasons bar; Agent Performance Ranking table.
- Team Performance: Sales Rep Performance (Rep, Assigned, Completed, Rate, Revenue); Delivery Agent Performance (Agent, Assigned, Delivered, Failed, Rate); Call Tracking cards (Today, This Week, This Month, Avg per Day); Call Outcomes bar (Confirmed, Rescheduled, No Answer, Cancelled, Other); Rep Call Performance (Rep, Today, Week, Month, Avg/Day, Confirmed).
- Data: `/api/analytics/dashboard`, `sales-trends`, `status-distribution`, `rep-performance`, `agent-performance`, `product-performance`, `area-distribution`; `/api/calls/stats`.

## `/workflows` - Workflows
- Roles: `workflows:view`. Buttons Browse Templates (gallery), Create Workflow. Empty state "Create From Scratch". Search "Search workflows by name or description...".
- Table: Workflow Name, Status (Active / Paused), Description, Trigger Type, Last Updated, Actions (Run for manual workflows, Pause / Activate, Edit, Delete). "Workflow Statistics" panel. Running indicator. Data: `GET /api/workflows`, `PUT /:id {isActive}`, `DELETE /:id`, `POST /:id/execute`, `GET /:id/executions` (ExecutionHistory).
- Template gallery (8): Send Confirmation SMS, Assign Orders by Product, High-Value Order Alert, Auto-Assign by Area, VIP Customer Priority, Daily Delivery Reminder, Shopify Order Import, Failed Delivery Follow-up. Search by name / description / tags.

## `/workflows/new`, `/workflows/:id` - WorkflowWizard
- 5 steps: Basic Info (name*, description, isActive), Trigger, Conditions (optional), Actions, Review ("Test and save"; Save / Save & Activate).
- Triggers: Order Created, Order Status Changed (filter: any, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled), Payment Received, Time-Based (cron, e.g. `0 9 * * *`), Manual, Webhook.
- Condition fields: orderTotal, productName, customerType, status, paymentMethod, state, country, itemCount. Operators: equals, greaterThan, lessThan, between, contains, startsWith, in (subset per field).
- Action types: assign_user (AssignUserAction), send_email, send_sms, send_whatsapp (template: order_created, confirmed, out_for_delivery, delivered, failed_delivery; optional custom link), update_order (status select of 9), wait (minutes), http_request (method GET/POST/PUT/PATCH/DELETE, URL, JSON body with `{orderNumber}`-style variables). Gallery also uses assign_agent and add_tag (GUESS legacy).
- Data: `GET|POST|PUT /api/workflows`. Unrouted: `pages/WorkflowEditor.tsx` + `components/workflow/*` (node-based editor).

## `/communications` - Communications
- Roles: super_admin, admin, manager. Tabs via `?tab=`: overview, history, bulk-send, campaigns, templates, opt-outs.
- Overview: cards Total, Delivered, Failed, Delivery Rate; "Messages by Channel" bar chart. `GET /api/communications/stats`.
- Message History: filters Channel (All / WhatsApp / SMS), Status (All / Pending / Sent / Delivered / Failed), start date, end date; table Date, Channel, Recipient, Template, Status, Message; paginated. `GET /api/communications/messages`.
- Bulk Send: channel selector SMS / WhatsApp / Email.
  - SMS and WhatsApp: Message Content (SMS: saved template or custom textarea; WhatsApp: template key select from 5 keys + optional custom link), Recipient Filters (state/area text, product select, one checkbox, GUESS an opt-out/delivered filter), "Preview Recipients" table, "Send to N recipients". `GET /recipients`, `POST /bulk-sms`, `POST /bulk-whatsapp`.
  - Email (EmailComposer): campaign title*, starter template (Announcement, Promo / Sale, Re-engagement), subject, HTML body with MergeTagToolbar (`{{customer_name}}`, `{{customer_email}}`, `{{store_name}}`, `{{unsubscribe_url}}`), live preview, Audience filters (area, product, checkbox), "Check Eligibility" (audienceTotal, emailable, noEmail, optedOut), Send with confirm. `GET /email-audience`, `POST /bulk-email`.
- Campaigns (CampaignHistoryTab): table Campaign (title + subject), Status (queued, sending, completed), Audience, Emailable, Waiting, Sent, skipped detail (no address, opted out). `GET /campaigns[/:id]`.
- Templates: SMS template CRUD (name, body): Create Template, Edit, Delete. `GET|POST|PUT|DELETE /sms-templates`. `emailTemplate.service.ts` (list/create/update/remove) has no UI.
- Opt-outs: "Customer Opt-out Preferences" table Name, Phone, SMS Opt-out toggle, WhatsApp Opt-out toggle; paginated. `GET /opt-outs`, `PATCH /opt-out/:customerId`.
- All endpoints under `/api/communications`.

## `/settings` - Settings (tabbed)
- All authenticated roles; tab set depends on role. Full field list in section 4. Also mounted at `/m/settings` (code TODO: mobile-optimised version).

## `/settings/billing` - Billing (`pages/Billing.tsx`; also embedded as Settings tab)
- Subscribe, switch and cancel are `super_admin` only.
- Status alerts: past_due ("Your last payment failed" + Update payment method), pending ("Finish setting up your subscription" + Complete payment), billing-not-enabled notice.
- Current plan card: plan name, status badge, "Renews on", next charge in NGN, card ending last4. Usage: "Orders this month N / max (or unlimited)" progress bar. Cancel subscription (confirm; keeps access until cycle end; buttons "Keep plan" / "Cancel subscription").
- Plans grid (Growth, Scale, Enterprise): price NGN/mo, "N orders/mo - M staff" or unlimited, "Current plan" badge, "Switch to <plan>", Enterprise -> mailto "Contact us".
- Data: `GET /api/billing/plans`, `GET /api/billing/subscription`, start subscription (returns Paystack `authorizationUrl`), cancel subscription (all `billingService`).

## `/settings/billing/callback` - SubscriptionCallback
- States "Activating your subscription", "You're all set", "Subscription Issue"; "Back to billing". Verifies via billingService.

## `/checkout-forms` - CheckoutForms
- No role guard (any authed role); entry is Settings > Checkout Forms. Create Form / "Create Your First Form". Table: Name, Description, Fields (count), Packages (count), Upsells (count), Status (active checkbox), Actions (Edit, Clone, Preview, Delete). Embed note referencing `docs/embed.md`.
- Data: `GET /api/checkout-forms`, `PUT /:id {isActive}`, `DELETE /:id`. Clone via create (GUESS).

## `/checkout-forms/new`, `/checkout-forms/:id/edit` - CheckoutFormEditor
- Header: back, "Unsaved" chip, Preview toggle (live iframe of `/checkout-forms/:id/preview`, draft via postMessage), Save. Builder (`components/forms/CheckoutFormBuilder.tsx`, react-hook-form + dnd-kit) tabs:
  - Basics: name*, slug (read-only, auto from name), productId* (product select), description.
  - Fields: "Add Form Fields" grid (Text Input, Email, Phone Number, Number, Text Area, Dropdown, Checkbox, Multi Select, State). "Form Fields" sortable list (drag reorder; Required toggle; Edit field; Delete field). Defaults: Full Name, Phone, Alt Phone, Email Address, Street Address, Region/State. Missing required standard keys block saving ("This form can't take orders yet"). FieldEditModal: label*, standardKey (Auto-detect, fullName, phone, alternativePhone, email, region, streetAddress, custom), placeholder, options (add/remove for select / checkbox / multiselect), widthPercent (50 puts two fields on a row), required.
  - Packages: Add Package. PackageEditor: name, quantity, price, discountType (None / % off / fixed), discountValue, original price (from product price), isDefault, isPopular, showHighlight + highlightText, showDiscount; copy checkout link and embed snippet.
  - Upsells: Add Upsell. UpsellEditor: source (Manual Entry or existing product), name, description, image upload, quantity, price, discountType / discountValue, isPopular.
  - Design: Colors (Primary, CTA / Button, Surface / Accent, Text; swatches + custom hex), Button (shape square / rounded / pill, size S / M / L, label), Inputs (flat / outlined / filled; labelColor, priceColor), Layout (hide product name + description, show order summary, offer position top / bottom; page background, productBanner).
  - Settings: Default Country; Payment Methods (Nigeria only; COD, Pay a Deposit (Paystack) with deposit percentage 1-99, Pay in Full (Paystack); max two); Thank You Page (redirectUrl); Embed on Your Site (allowedOrigins, one per line; widget snippet copy); Tracking & Pixels (Facebook Pixel ID, Google Analytics 4 ID, TikTok Pixel ID, Google Tag Manager ID, Meta Conversion API Access Token [write-only, masked], Meta CAPI Test Event Code). Its help text links to `/settings/integrations`, which is not a route (bug).
- Data: `GET|POST|PUT /api/checkout-forms[/:id]`, `GET /:id/preview-config`, `GET /:id/stats` (service fn, no UI found), `GET /api/products`. Extra DB columns: formType (default physical), currency, regions, styling.

## `/webhooks` - Webhooks
- Roles: super_admin, admin. Add Webhook (modal). Search "Search webhooks by name...". Table: Name, Receiving URL (+ API key prefix with copy), Status, Last Updated, Actions (View Logs, Edit, Delete). Empty: "Add your first webhook to start importing orders automatically."
- WebhookForm (modal, tabs): Configuration (name*, productId*, isActive, fixed WPForms field mapping inputs: customerName=customer_name, phoneNumber=phone_number, alternativePhone=alternative_phone_number, customerAddress=customer_address, region=region, quantity=quantity [package + price]); Security (secret min 16 chars with generate, custom headers key/value add/remove); Test (sample JSON, test mapping; needs saved webhook). Success view = WebhookIntegrationDetails (Webhook Endpoint, API Key, Example Request).
- `FieldMappingEditor` (generic external-to-internal map; categories Customer / Delivery / Product / Order / Other; customerPhone required) exists. Internal fields: customerPhone, customerFirstName, customerLastName, customerEmail, deliveryAddress, deliveryState, deliveryArea, productName, quantity, price, package, subtotal, shippingCost, deliveryFee, totalAmount, notes.
- WebhookLogs modal: 30-day stats; table Timestamp, Status (Success / Failed), Method, Endpoint, Status Code, Actions; expand with tabs Request / Response / Error; retry; paginated 20.
- Data: `/api/webhooks` CRUD, `/:id/logs`, `/:id/test`, `/:id/stats?days=30`, `POST /api/webhooks/logs/:logId/retry`.

### Mobile agent app (`/m`, delivery_agent only, MobileLayout)

## `/m/` - mobile Dashboard
- DynamicDashboard with delivery-agent config.

## `/m/deliveries` - MobileDeliveries
- Tabs All, Pending (ready_for_pickup), Transit (out_for_delivery), Done (delivered + failed_delivery), with counts. Search "Search name, phone, address, order #..." with "Clear search". Month-to-date window. Page size 20 with load more. `GET /api/deliveries/agent-orders`.

## `/m/deliveries/:id`, `/m/deliveries/order/:orderId` - MobileDeliveryDetail
- Sections: Customer (tel link), Order Items, Order, Notes, Delivery Attempts. Actions: start delivery (order -> `out_for_delivery`), Mark Delivered sheet "Complete Delivery" (COD amount collected, recipient name, optional photo proof; proofType photo / otp), Failed sheet "Report Failed Delivery" (reason*, "Reschedule for tomorrow" toggle -> `ready_for_pickup`, else `failed_delivery`).
- Data: `GET /api/deliveries/:id`, `/by-order/:orderId`, `PATCH /api/deliveries/:id/complete`, `PATCH .../proof`, `POST /api/upload`, `PATCH /api/orders/:id/status`.

## `/m/inventory` - AgentMyInventory (shared with desktop `/agent-inventory`).

## `/m/collections` - MobileCollections
- Tabs Collections (pending cash list with count), Deposits (history), New Deposit (amount, method [Mobile Money, Bank Transfer, Cash, Check], reference number, notes, receipt photo "Tap to capture receipt"). Balance card. Data: `GET /api/agent-reconciliation/agents/:id/balance`, agent collections, `GET /api/agent-reconciliation/deposits?agentId=`, `POST /api/agent-reconciliation/deposits`.

## `/m/settings` - Settings (desktop component reused)

### Platform admin (`/platform/*` on main domain, `/` on platform subdomain; guard `isPlatformAdmin`)

## `/platform` - PlatformDashboard
- Stat cards Total Tenants, MRR, Active Users, Suspended Tenants; Tenant Growth line chart (totalTenants, newTenants), period 30d / 90d / 1y. `GET /api/platform/metrics`, `/metrics/trends?period=`.

## `/platform/tenants` - PlatformTenants
- Search "Search by name or slug...", Plan filter (All, Free, Starter, Pro, Enterprise; stale vs growth / scale), Status filter (All, Active, Suspended, Trial). Table Name, Slug, Plan, Status, Users, Orders, Created, View. Paginated. Create Tenant modal: name*, slug*, planName, region, currency (default GHS). `GET|POST /api/platform/tenants`.

## `/platform/tenants/:id` - PlatformTenantDetail
- Header: name, slug, plan badge, status badge, free-until, admin email, region, currency. Usage: Orders This Month, Revenue This Month, Total Users.
- Plan Management (plan select + Save Plan -> `PUT /api/platform/tenants/:id {currentPlanId}`). Grant Free Plan (optional expiry date; `POST .../grant-free`). Billing History (BillingActivityTable; `GET /api/platform/billing-events?tenantId`). Rate Limiting: toggle, "Requests per 15 min", "Burst per second", Save Rate Limit.
- Danger Zone: Suspend / Reactivate (`POST .../suspend|reactivate`), Delete Tenant (modal, type slug to confirm; `DELETE` with confirmSlug).

## `/platform/announcements` - PlatformAnnouncements
- Create Announcement modal: title*, body*, type (Info, Warning, Maintenance), expiresAt (datetime-local, optional). Table Title, Type, Active, Expires, Created, delete (confirm). `GET|POST|DELETE /api/platform/announcements`.

## `/platform/billing` - PlatformBilling
- "Billing Activity": last 100 events; table Event (Subscribed, Charge, Payment failed, Cancelled), Tenant, Amount (NGN), When. `GET /api/platform/billing-events?limit=100`. Service also has `GET /api/platform/plans` and `/health` (no UI found).

### Files that exist but are routed nowhere (decide: drop or revive)
- `pages/Dashboard.tsx`, `pages/OrdersList.tsx`, `pages/OrdersKanban.tsx`, `pages/CallsDashboard.tsx`, `pages/WorkflowEditor.tsx` + `components/workflow/*`, `pages/mobile/MobilePlaceholder.tsx`, `components/layout/MobileNav.tsx`, `components/settings/integrations/MessageTemplates.tsx`, the orphaned financial components listed above, `AgentCreateModal`.

## 4. Settings in full detail
Storage key: **SS** = `system_config` table, one row per tenant (`tenant_id` unique). Columns: businessName, businessEmail, businessPhone, businessAddress, taxId, currency (default "USD"), operatingHours JSON, smsProvider JSON, emailProvider JSON, whatsappProvider JSON, paystackProvider JSON, notificationTemplates JSON, rolePermissions JSON. Read `GET /api/admin/settings`; write `PUT /api/admin/settings` (partial, per key). **User** = `users` table. **Tenant** = `tenants` table. Secrets live in these JSON columns (GUESS: not encrypted).
Tab visibility: Profile, Security, My Notifications for everyone. Everything else `isSuperAdmin` only. URL `?tab=`; `?oauth=` forces Integrations; `?section=` picks the integration.

### 4.1 Profile (all roles)
- firstName: text, default current user's, editable except sales_rep. Save has no handler (not persisted; GUESS unfinished).
- lastName: text, same.
- email: email, same.
- phone: tel, placeholder "+1 (555) 000-0000", not bound to user data, not persisted.
- Current Role: read-only.
- Member Since: read-only (user.createdAt).

### 4.2 My Notifications (all roles)
- Order Updates: toggle, default ON, local only (no handler / not persisted).
- Payment Notifications: toggle, default ON, hidden for sales_rep, not persisted.

### 4.3 Security (all roles)
- currentPassword: password (admin / super_admin only). No handler, not persisted.
- newPassword: password (same).
- confirmNewPassword: password (same). Other roles see "Password Changes Restricted" (ask an admin).
- Delete Account (super_admin, Danger Zone): deletePassword password in confirm modal -> `DELETE /api/auth/delete-account {password}`, then logout. Deletes all tenant data.

### 4.4 User Management (super_admin) - stored in User
- Filter search: text, client-side.
- Filter role: select, all 7 roles.
- Filter status: Active (default) / Inactive / All Statuses. Page size 20.
- Table columns: Name, Email, Role, Status, Commission, Actions (Edit, Reset password, Deactivate or delete modal [soft or permanent], Reactivate).
- Create User firstName*: text.
- Create User lastName*: text.
- Create User email*: email.
- Create User password*: password, min 8, show / hide.
- Create User phoneNumber: text.
- Create User role: select, default sales_rep.
- Create User commissionAmount: number step 0.01, default 0 (also sent as deliveryRate).
- Edit User fields: firstName, lastName, email, phoneNumber, role, commissionAmount (sent as both commissionAmount and deliveryRate).
- Reset Password newPassword: password.
- API: `GET|POST /api/admin/users`, `PUT /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`, `DELETE /api/admin/users/:id` (soft), `DELETE /api/admin/users/:id/permanent`.

### 4.5 Business Settings (super_admin) - SS
- businessName: text, default "" (config store fallback "COD Admin").
- businessEmail: email, default "".
- businessPhone: tel, default "".
- taxId (Tax ID / VAT Number): text, default "".
- currency (Global Currency): select, default USD (DB default). Options: USD, GHS, NGN, KES, EUR, GBP, INR, CAD, AUD, JPY. Onboarding writes GHS NGN KES ZAR UGX TZS RWF ETB, so ZAR/UGX/TZS/RWF/ETB are not in this list.
- businessAddress: textarea, default "".
- Save also refreshes `configStore`.
- operatingHours (`{day: {open, close, enabled}}`): in type and DB, no UI.

### 4.6 Checkout Forms tab (super_admin)
- Static pointer card with Quick Start steps and "Manage Forms" -> `/checkout-forms`. No fields.

### 4.7 Integrations (super_admin)
Left nav shows a green dot when configured (sms: authToken; whatsapp: accessToken; email: apiKey; paystack: secretKey).
SMS (Arkesel) - SS.smsProvider:
- provider: fixed "arkesel".
- authToken (API Key): password.
- senderId: text, max 11 chars, placeholder CODAdmin.
- isEnabled: toggle, default true.
- Delivery Report Webhook URL: read-only `<api>/api/sms/webhook`, Copy.
- testPhone: tel + "Test SMS" -> `POST /api/sms/test {phoneNumber}`.
- (Type also lists accountSid, phoneNumber; unused by UI.)
WhatsApp Business API - SS.whatsappProvider:
- Status badge Connected / Not Connected / Not Configured via `GET /api/whatsapp/status` (verifiedName, displayPhoneNumber, qualityRating).
- Tab "Connect with Meta" (when OAuth enabled): Connect button (`POST /api/whatsapp/oauth/initiate`, opens authUrl); phone picker modal "Select WhatsApp Number" (`GET /oauth/phones`; quality GREEN / YELLOW / RED; `POST /oauth/select {phoneNumberId, displayPhone, verifiedName}`); connected card (verifiedName, displayPhone, "Token expires in N days", auto-refresh within 7 days); Disconnect (`DELETE /oauth/disconnect`).
- OAuth-stored keys: authMode ('oauth'), wabaId, oauthTokenExpiry, oauthConnectedAt, oauthVerifiedName, oauthDisplayPhone, oauthUserId.
- Tab "Manual Setup": accessToken (placeholder EAAx...).
- phoneNumberId: text.
- appSecret: text.
- webhookVerifyToken: text.
- isEnabled ("Enable WhatsApp"): toggle, default false. Buttons: Test Connection, Save WhatsApp Settings (authMode 'manual').
Email - SS.emailProvider:
- provider: select sendgrid (default) / resend / smtp.
- apiKey (API Key / Password): password.
- fromEmail: email.
- fromName: text.
- testEmail: email + Send Test -> `POST /api/email/test {email}`.
Paystack (per-tenant keys) - SS.paystackProvider:
- mode: select test (default) / live.
- publicKey: text.
- secretKey: password.
- isEnabled: checkbox, default true.
- Webhook URL: read-only `<origin>/api/paystack/webhook/<tenantSlug>`, Copy.
Webhooks: pointer card + 5-step Quick Start -> `/webhooks`.
AI Assistant (MCP) - `/api/mcp-keys`:
- label: text, max 50, required on Generate.
- Generated key: shown once, with `mcpConfig` JSON (tabs Remote (recommended) / Local (stdio)) and setup steps; list shows label, keyPrefix, createdAt, lastUsedAt; expiresAt is server-set; Revoke with confirm (`DELETE /api/mcp-keys/:id`).
Message Templates (SS.notificationTemplates; component built, NOT mounted in any tab; backend may still read it, GUESS):
- orderConfirmation.sms, orderConfirmation.email, outForDelivery.sms, outForDelivery.email, delivered.sms, delivered.email, paymentReminder.sms, paymentReminder.email: textareas, default "". Variables `{customerName}`, `{orderNumber}`, `{totalAmount}`.

### 4.8 Role Permissions (super_admin) - SS.rolePermissions
- UI controls: role select (7), search resources, Full Access, Read Only, Reset to Saved, Save (enabled when dirty), enabled-count badge per resource, per-action toggles.
- Resources and actions in UI: users [create, view, update, delete]; orders [create, view, update, delete, bulk_import, assign]; customers [create, view, update, delete]; products [create, view, update, delete, update_stock]; financial [create, view, update, delete]; analytics [view]; workflows [create, view, update, delete, execute]; settings [view, update]. Backend also holds `calls` [create, view, update, delete] and `gl` [create, view, update, delete] with no UI rows.
- Defaults (backend `getDefaultPermissions`, merged under stored values): super_admin everything; admin everything except products.update_stock, financial [view, create], settings [view]; manager orders [view, update, bulk_import, assign], customers CRUD, products [view], financial [view], analytics [view], workflows [view, execute], calls [view], gl [view]; sales_rep orders [create, view, update], customers CRUD, products [view], analytics [view], calls [create, view]; inventory_manager orders [view], customers [view], products CRUD + update_stock, analytics [view]; delivery_agent orders [view, update], customers [view], products [view], financial [create], analytics [view], calls [view]; accountant orders / customers / products [view], financial [view, create], analytics [view] (rest of its row not read).
- Socket `permissions:updated` refreshes open clients. Server caches per tenant (GUESS TTL minutes).

### 4.9 Billing & Plans tab (super_admin)
- Renders the `/settings/billing` page (section 3). No fields; actions Subscribe / Switch plan, Cancel subscription, Update payment method.

### 4.10 Other config-like stores
- Checkout form per-form settings (table `checkout_forms`): defaultCountry/country, codEnabled (default true), paystackDepositEnabled (false), paystackFullEnabled (false), depositPercent, redirectUrl, allowedOrigins, pixelConfig {facebookPixelId, googleAnalyticsId, tiktokPixelId, googleTagManagerId}, metaCapiAccessToken, metaCapiTestEventCode, design JSON, styling JSON {buttonColor, accentColor, showName, showDescription}, regions, currency, isActive.
- Webhook config (`webhook_configs`): name, url, secret, productId, isActive, fieldMapping, headers, apiKey.
- Tenant (platform-managed): name, slug, logo, region, currency, defaultDeliveryFee (no UI), currentPlanId, subscriptionStatus, trialEndsAt, paystack billing columns, freeAccessExpiresAt, rateLimitEnabled, rateLimitConfig.
- User preferences: ordersDefaultView, onboardingCompleted, onboardingCompletedAt.
- localStorage (per browser): `sidebarCollapsed`, `platformSidebarCollapsed`, `orders-column-widths`, `financial-tab`, `MOBILE_OPT_IN`, `DESKTOP_FLAG`, `checkout_cooldown_<slug>`.
