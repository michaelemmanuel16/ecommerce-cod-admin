# Area 01: Shell, navigation, auth, onboarding, platform admin, correctness base

F-ID range: F-100 to F-199. Owner of this file: Builder A.
Date: 2026-10-18. Status: draft for owner review.

Sources: `docs/prd/decisions.md` (final), design doc 2026-10-18 (sections 3, 5, 9, 10), `docs/prd/gap-matrix.md`, `docs/mockups/v2/*`, the three inventories.
GUESS means a source did not prove the statement. The text says how to check it.

---

## 1. Scope

This file covers:
- Gap-matrix 1.1 Shell and navigation: SH-01 to SH-20.
- Gap-matrix 1.21 Auth and public pages: AU-01 to AU-09.
- Gap-matrix 1.22 Platform admin: PA-01.
- The cross-cutting rows of gap-matrix section 3 (broken or dead) and section 4 (mockup fixes) that no single screen owns. Section 5 of this file lists them.

Roles that use these requirements:
| Role | What they use here |
|---|---|
| Owner (`super_admin`) | Whole shell, onboarding, command palette, user menu. |
| Admin, manager | Shell with fewer menu items (F-102). |
| Finance clerk (`accountant`) | Shell with Finance as home (F-102). |
| Stock keeper (`inventory_manager`) | Shell with Inventory as home (F-102). |
| Call rep (`sales_rep`) | Own app shell (F-103). Login and password pages. |
| Delivery agent (`delivery_agent`) | Own phone app shell (F-103). Login and password pages. |
| Platform admin (`isPlatformAdmin`) | `/platform` pages (F-140). |
| Public visitor, customer | Login page, public tracking, digital download (F-120, F-125). |

The v2 mockup shows only the owner. This file adds the rules for the other roles. Where it does, the text says GUESS and how to check.

Out of scope here: the dashboard (area 02), the AI drawer and cards (area 13), the inbox page (area 05), settings tabs (area 12), the rep and agent screens (areas 08 and 09).

---

## 2. Requirements: shell and navigation

### F-100: App shell and v2 design tokens
- Priority: P0. Milestone: M3.
- Description: Build one admin shell that matches the approved v2 mockups. The shell holds the sidebar, the top bar, the page area, the AI drawer mount point, the command palette mount point and the toast area. All colours, spacing and type come from tokens copied from `docs/mockups/v2/app.css` (`--pine --mint --gold --coral --violet --ink --ink-2 --ink-3 --bg --card --line --hover` and the `-soft` versions). Money shows in the store currency through one formatter.
- Current app: `frontend/src/components/layout/Layout.tsx`, `Sidebar.tsx`, `Header.tsx`; `frontend/src/utils/format.ts` (reads `configStore.currency`). The UI is hand-written. `CLAUDE.md` names Shadcn, but the code does not use it (design doc risk 18).
- Mockup: `docs/mockups/v2/index.html` shell (`<aside class="side">`, `<header class="top">`); `app.css`; `DESIGN-SPEC.md` hard rules 2 and 3.
- Acceptance criteria:
  - [ ] The tokens live in one CSS file or one Tailwind theme. No page defines its own colour.
  - [ ] Every colour token has a dark-mode value.
  - [ ] The layout works from 1440 px down to 760 px. Under 760 px the sidebar becomes a drawer.
  - [ ] Every interactive element shows a visible focus ring.
  - [ ] All money on every page uses the store-currency formatter. No page has a hard-coded `$` or `GHS` (gap-matrix section 3 row 25).
  - [ ] The mockup "sample data" pill does not exist in the app (SH-20 is DROP).
  - [ ] All money shows in the store currency (decision O5). An amount in another currency (for example the ad account's currency) converts at that day's rate and the page shows the rate used that day, for example "₦112 = GH₵1" (sample values for the Manny Dynamics store).
- Data: none. API: `GET /api/admin/config/me` stays (see F-126).
- Permissions: all authenticated roles.
- Edge cases and errors:
  - The store currency changes (decision O6): the formatter uses the new currency at once. Amounts in other currencies convert with the rate of each record's date.
  - Fonts fail to load: the system font stack shows. The layout does not shift by more than 2 px.
- Tests:
  - Unit: money formatter for two currencies and an unknown currency code.
  - E2E: open each top-level page at 1440 px and 760 px; no horizontal page scroll.
  - Lint: a check fails the build if a component file contains a hex colour outside the token file.

### F-101: Sidebar groups and navigation
- Priority: P0. Milestone: M3.
- Description: Group the sidebar as the mockup does: Dashboard and Inbox at the top, then Sell, Stock, Money, Team, Setup. The sidebar can collapse. The collapsed state is remembered per browser. The "Set up North Star" link shows until the North Star setup is complete (F-1100 area). The store chip does not show "2 stores" (multi-store is out until the SaaS phase, decision D7). Counts on pills (Inbox 5, Orders 38, Finance 2) come from live data.
- Current app: `Sidebar.tsx` with 12 flat items; `sidebarCollapsed` in `localStorage`.
- Mockup: shell in every v2 file. Groups: Dashboard, Inbox; Sell (Orders, Customers, Checkout forms, Messages); Stock (Products, Inventory and stock, Deliveries); Money (Finance, Marketing, Reports); Team (Targets, Leaderboard, Staff and roles); Setup (Workflows, Connections, Settings, Set up North Star).
- Acceptance criteria:
  - [ ] The sidebar shows the six groups in the order above.
  - [ ] The active page link has the active style, including links that share one file (Orders, Targets, Leaderboard).
  - [ ] The sidebar collapse state survives a reload. If `localStorage` fails, the sidebar opens expanded and the page still works.
  - [ ] The store chip shows the business name and country from Settings. It has no store switcher and no "2 stores" text (SH-13 is DROP).
  - [ ] "Set up North Star" shows only while no North Star target exists. After setup, it moves into Settings (F-1100 area).
  - [ ] The Inbox pill shows unread inbox items for the signed-in user. The Orders pill shows the count of orders in `pending_confirmation`. The Finance pill shows the count of open Findings that need action. With the fixture the Orders pill shows 64 (pending), not the mockup sample 38. GUESS: the mockup pill 38 is "orders unpaid over 8 days". Check with the owner which count the Orders pill shows.
  - [ ] Agent Inventory (`/agent-inventory`) no longer exists as a hidden route. Its function lives in Inventory and stock (area 06).
- Data: none. API: `GET /api/nav/counts` returns `{ inbox, ordersPending, financeOpen }` for the signed-in user.
- Permissions: counts only include data the user may see.
- Edge cases and errors: count request fails: pills hide. The menu still works.
- Tests:
  - Unit: group builder returns the right items for each role (F-102).
  - Integration: `GET /api/nav/counts` returns only the caller's tenant data (two-tenant test).
  - E2E: collapse, reload, state kept.

### F-102: Role-based menu and role home
- Priority: P0. Milestone: M3.
- Description: The mockup shows only the owner. The menu must show each role only what it may use. An item shows when the user can view its resource (permission matrix in `SystemConfig.rolePermissions`, merged over defaults). Each role also has a home route. This also settles the three "MISSING-IN-MOCKUP" dashboards (DB-11, DB-12, DB-13): the owner, admin and manager land on the Dashboard; the finance clerk lands on Finance Overview; the stock keeper lands on Inventory and stock.
- Current app: `usePermissions().canAccessMenu`; `config/dashboards/*` (one config per role); hard-coded role guards in `App.tsx` (`/analytics`, `/communications`, `/webhooks`, `/agent-inventory`).
- Mockup: not in mockup (owner view only). Build the menu below in the v2 style.
- Acceptance criteria:
  - [ ] The default menu matrix is as in the table below. The owner can change it through the permission matrix (area 12).
  - [ ] A direct URL to a page the role may not see shows a "You do not have access" page (HTTP 403 from the API). It does not redirect silently.
  - [ ] After login, each role goes to its home route.
  - [ ] The `admin` role sees the Settings tabs the permission matrix allows (gap-matrix section 3 row 5 is covered by area 12; this file only requires that the menu uses the same matrix).
  - [ ] Hard-coded `RoleGuard` role lists are replaced by permission checks.
- Default menu matrix (GUESS: derived from the current default permission matrix in `inventory-backend.md` 7.1 and the current hard-coded guards. Check with the owner before M3 ships):
| Menu item | Needs | Owner | Admin | Manager | Finance clerk | Stock keeper |
|---|---|---|---|---|---|---|
| Dashboard | `analytics:view` and role is owner, admin or manager | yes | yes | yes | no | no |
| Inbox | any signed-in user | yes | yes | yes | yes | yes |
| Orders | `orders:view` | yes | yes | yes | read only | read only |
| Customers | `customers:view` | yes | yes | yes | read only | read only |
| Checkout forms | `settings:view` (GUESS: new resource `checkout_forms` later) | yes | yes | no | no | no |
| Messages | manager and above | yes | yes | yes | no | no |
| Products | `products:view` | yes | yes | yes | read only | yes |
| Inventory and stock | `products:update_stock` or `inventory:view` | yes | yes | yes | no | yes |
| Deliveries | manager and above | yes | yes | yes | no | no |
| Finance | `financial:view` | yes | yes | yes | yes | no |
| Marketing | new `marketing:view` | yes | yes | yes | no | no |
| Reports | `analytics:view` and (manager and above, or finance clerk) | yes | yes | yes | yes | no |
| Targets | manager and above | yes | yes | yes | no | no |
| Leaderboard | desk roles | yes | yes | yes | yes | yes |
| Staff and roles | `users:view` | yes | yes | read only | no | no |
| Workflows | `workflows:view` | yes | yes | yes | no | no |
| Connections | admin and above | yes | yes | no | no | no |
| Settings | all (profile, security); other tabs by permission | yes | yes | yes | yes | yes |
| Set up North Star | owner only | yes | no | no | no | no |
| Home route | | Dashboard | Dashboard | Dashboard | Finance | Inventory and stock |
- Role to app mapping: `sales_rep` goes to the rep app; `delivery_agent` goes to the agent app (F-103).
- Data: add permission resource `marketing` (action `view`) to the default matrix. API: `GET /api/auth/me` returns `homeRoute` and the menu keys.
- Permissions: as in the table.
- Edge cases and errors:
  - A user has no role yet: show the "no access" page with the owner contact.
  - A permission change while the user is signed in: the socket event `permissions:updated` refreshes the menu (F-110).
- Tests:
  - Unit: menu builder for all seven base roles and for a custom permission matrix.
  - Integration: API returns 403 for a hidden page's data endpoint.
  - E2E: sign in as each role; check menu items and home route.

### F-103: Role apps and routing for call reps and delivery agents
- Priority: P0. Milestone: M3 (routing); M7 (rep app); M10 (agent app).
- Description: Call reps and delivery agents do not use the admin shell. A call rep uses the rep screen (area 08). A delivery agent uses the phone app (area 09). This requirement defines how a login reaches the right app. It removes the old "Mobile View" switch, the sales-rep onboarding tour and the rep Help menu.
- Current app: `MobileRedirect` (agent on a mobile viewport with `MOBILE_OPT_IN`); sidebar "Mobile View" button; `components/onboarding/*` tour; Help menu in `Header.tsx`; `/m/*` pages.
- Mockup: `rep.html` and `agent.html` (own shells). Neither is linked from the admin sidebar; the owner reaches them from Staff and roles (preview).
- Acceptance criteria:
  - [ ] After login, `sales_rep` goes to `/rep` and `delivery_agent` goes to `/agent`.
  - [ ] These two roles cannot open admin pages by URL (403).
  - [ ] The "Mobile View" button, `MOBILE_OPT_IN`, `DESKTOP_FLAG`, the rep tour and the rep Help menu are removed (SH-09, SH-10, SH-18 are DROP).
  - [ ] An owner can open `/rep` and `/agent` in preview mode from Staff and roles (area 12). Preview mode shows a banner "Preview as <name>" and blocks writes.
  - [ ] The agent app works at phone width. The rep app works with a desktop sidebar and phone bottom tabs (area 08).
- Data: none. API: none new.
- Permissions: as above.
- Edge cases and errors:
  - A rep logs in on a phone: they still get `/rep` with bottom tabs.
  - Old bookmarks to `/m/...`: redirect to the matching `/agent/...` page.
- Tests:
  - E2E: log in as rep, agent, owner. Check landing page and blocked pages.
  - Integration: rep token gets 403 on `/api/financial/*`.

### F-104: Top bar, user chip and user menu
- Priority: P1. Milestone: M3.
- Description: The top bar holds search (F-105), the dark-mode toggle (F-107), the bell (F-106), the "Ask agent" button (area 13) and the avatar. The avatar opens a menu with Profile, Security and Sign out. The sidebar "me" chip shows the person's name and role names (for example "Manny, Owner, Finance clerk, Marketing"). Today the chip says "all roles" and the avatar does nothing.
- Current app: `Header.tsx`, `UserMenu` (Settings, Logout).
- Mockup: top bar in every v2 file; the avatar is dead in the mockup (gap-matrix section 4 row 25 says: avatar opens a menu).
- Acceptance criteria:
  - [ ] The avatar opens a menu with Profile, Security and Sign out. Profile and Security open the matching Settings sections (area 12).
  - [ ] Sign out clears the tokens, calls `POST /api/auth/logout`, and goes to `/login`.
  - [ ] The user chip lists the person's role names from `RoleAssignment` (area 12). If the person has none, it shows the base role name.
  - [ ] Keyboard: the menu opens with Enter and closes with Escape.
- Data: none. API: `GET /api/auth/me` returns `roles: [{ id, name }]`.
- Permissions: all signed-in users.
- Edge cases and errors: logout request fails: clear local tokens anyway and go to `/login`.
- Tests:
  - E2E: open menu, open Security, sign out.
  - Unit: chip text for 0, 1 and 3 roles.

### F-105: Command palette and global search
- Priority: P1. Milestone: M3.
- Description: The top-bar search is a button that opens the command palette (cmd+K or ctrl+K). The palette has three parts: "Ask the agent" (sends the text to the AI drawer, area 13), "Go to" (pages) and "Actions". The text box also searches orders, customers and phone numbers. Today the header search input does nothing. The two mockup actions "Record a 3PL payout" and "Start a stock count" must work: each opens the matching screen or modal.
- Current app: `Header.tsx` search input with no handler (decorative). Gap-matrix section 3 row 23.
- Mockup: `index.html` `#veil` palette; items: Ask the agent, Go to Orders (G O), Leaderboard (G L), Targets (G T), Actions Record a 3PL payout, Start a stock count.
- Acceptance criteria:
  - [ ] cmd+K opens the palette on every page. Escape closes it. Focus returns to the element that opened it.
  - [ ] Typing 3 or more characters searches orders (by order number, customer name, phone) and customers (name, phone). Results show within 400 ms on a data set of 10,000 orders. Each result opens its order drawer or customer page.
  - [ ] The "Go to" list shows only pages the role may open (F-102).
  - [ ] Key hints G O, G L, G T work as two-key shortcuts when no input has focus. The hint labels in the palette match real behaviour.
  - [ ] "Record a 3PL payout" opens the partner payout modal in Finance (area 10). "Start a stock count" opens the stock count modal in Inventory (area 06). Both are hidden for roles without the permission.
  - [ ] "Ask the agent" with text opens the AI drawer and sends the text as the first message (area 13).
  - [ ] Phone numbers match with or without the country code and with or without spaces (use `customerLookup`).
- Data: none. API: `GET /api/search?q=` returns `{ orders: [...], customers: [...] }`, max 5 each, tenant-scoped, permission-filtered.
- Permissions: results follow `orders:view` and `customers:view`.
- Edge cases and errors:
  - No results: show "No match. Ask the agent?".
  - Search service slow: show a spinner after 200 ms; allow navigation items to work meanwhile.
  - A query that looks like a phone number (7 or more digits) searches phones first.
- Tests:
  - Unit: query classifier (order number, phone, name).
  - Integration: search is tenant-scoped; a rep sees only allowed orders.
  - E2E: cmd+K, type a phone, open the customer.

### F-106: Notification bell
- Priority: P1. Milestone: M3 (bell); M9 (inbox content).
- Description: The bell shows the count of unread inbox items and links to the Inbox (area 05). It reads `Notification` rows from the database. Today it reads an in-memory store that is lost on reload.
- Current app: `NotificationBell`, `notificationsStore` (memory; fed by socket events `order:created`, `order:updated`, `order:status_changed`). Backend `Notification` model and `/api/notifications`.
- Mockup: bell with a dot in the top bar; links to `inbox.html`.
- Acceptance criteria:
  - [ ] The bell count equals the number of unread `Notification` rows for the signed-in user.
  - [ ] A new notification raises the count within 2 seconds through the socket event `notification`.
  - [ ] A page reload keeps the count (it comes from the database).
  - [ ] Click on the bell goes to `/inbox`. The mockup dot shows when the count is above zero.
- Data: `Notification` gains `subjectType`, `subjectId`, `actorId`, `snoozedUntil` (design doc 5.3; owned by area 05). API: `GET /api/notifications/unread-count`.
- Permissions: each user sees only their own notifications.
- Edge cases and errors: the socket drops: poll `unread-count` every 60 seconds.
- Tests:
  - Integration: unread count is per user and per tenant.
  - E2E: create an order in another session; the bell rises.

### F-107: Dark mode
- Priority: P2. Milestone: M3.
- Description: The moon button in the top bar switches between light and dark. The choice is remembered per browser. The first visit follows the operating-system setting.
- Current app: none.
- Mockup: `#theme` button sets `data-theme="dark"`; `app.css` defines both themes.
- Acceptance criteria:
  - [ ] Every page and every modal renders correctly in dark mode (no unreadable text, contrast of body text at least 4.5:1).
  - [ ] The choice survives a reload. If `localStorage` fails, the page still works and follows the system setting.
  - [ ] Charts, tags and progress bars use tokens, not fixed colours.
- Data: none. API: none.
- Permissions: all.
- Edge cases and errors: the theme flips before first paint to avoid a white flash (set the attribute in the HTML head script).
- Tests:
  - E2E: toggle and reload.
  - Visual: screenshot of Dashboard in both themes.

### F-108: Platform announcement banner and plan banner
- Priority: P2. Milestone: M3.
- Description: Keep the platform announcement banner (info, warning, maintenance). Platform admins post announcements (F-140). Keep the pending-plan banner too. Decision G2 says do not hide Billing and plans, so the banner stays; it only shows when the tenant's subscription is `pending` or `past_due`. The owner's tenant is on the free plan, so it will not show for the owner.
- Current app: `AnnouncementBanner` (`GET /api/platform/announcements/active`), `PendingPlanBanner`.
- Mockup: not in mockup. Restyle with `.tag` and `.card` tokens.
- Acceptance criteria:
  - [ ] An active announcement shows above the page. A user can dismiss it for the session.
  - [ ] An expired announcement does not show.
  - [ ] The plan banner shows for `pending` and `past_due` and links to Billing (area 12).
  - [ ] Neither banner shows in the rep or agent apps.
- Data: none. API: unchanged.
- Permissions: announcements show to all admin-shell users; the plan banner shows to the owner only.
- Edge cases and errors: the endpoint fails: no banner, no error toast.
- Tests: component tests for each banner state; integration test for the active-announcement query.

### F-109: Update prompt, error boundary and 404
- Priority: P2. Milestone: M3.
- Description: Keep the PWA update prompt, the error boundary and the 404 page. Restyle them in v2.
- Current app: `UpdatePrompt`, `ErrorBoundary`, router catch-all.
- Mockup: not in mockup.
- Acceptance criteria:
  - [ ] A new service worker shows a toast "A new version is ready" with a Reload button.
  - [ ] A render error shows a page with the error id and a "Reload" button. The error goes to Sentry when `VITE_SENTRY_DSN` is set.
  - [ ] An unknown URL shows a 404 page with a link to the role's home route.
- Data: none. API: none.
- Permissions: all.
- Edge cases and errors: the error boundary must not itself throw (test with a failing child).
- Tests: component tests for all three; e2e for 404.

### F-110: Realtime refresh with tenant-scoped sockets
- Priority: P0. Milestone: M0 (scoping); M3 (stores).
- Description: Keep socket.io realtime refresh of stores. Fix the leak: socket rooms must include the tenant id, and workflow and permission events must go to the tenant's rooms only. Today `role:admin` spans all tenants and workflow events use a global `io.emit`.
- Current app: `backend/src/sockets/index.ts` (rooms `role:<role>`, `user:<id>`, `order:<id>`); frontend stores listen to the events listed in `inventory-frontend.md` section 0. Gap-matrix section 3 row 31.
- Mockup: none.
- Acceptance criteria:
  - [ ] Rooms are named `t:<tenantId>:role:<role>`, `t:<tenantId>:user:<id>`, `t:<tenantId>:order:<id>`.
  - [ ] A client can join an `order:<id>` room only if the order belongs to its tenant and the user may see it.
  - [ ] No server code calls a global `io.emit` for tenant data. A test greps for it.
  - [ ] `permissions:updated` goes only to the tenant's rooms.
  - [ ] With two tenants, an event in tenant A never reaches a client of tenant B.
- Data: none. API: socket handshake keeps the JWT; the tenant id comes from the token.
- Permissions: as above.
- Edge cases and errors:
  - A user with no tenant (a platform admin): joins only `platform` rooms.
  - A token expires while connected: the socket reconnects with a refreshed token.
- Tests:
  - Integration: two-tenant socket test (client A and B, emit in A, B receives nothing).
  - Unit: room-name builder.

### F-111: Shared UI rules: confirm dialog, no dead buttons
- Priority: P1. Milestone: M3.
- Description: Every delete or bulk action uses one confirm dialog. The dialog states the count ("Delete 3 orders?"). Every button in the app is wired or removed. About 40 mockup buttons are dead (gap-matrix section 4 row 25). Each area file lists its own buttons; this requirement sets the rule and the test.
- Current app: confirms differ per page.
- Mockup: dead buttons across all pages. Remove: Download report, Add status, store chip. The avatar opens a menu (F-104). Agent suggestion buttons open a pre-filled screen (area 13).
- Acceptance criteria:
  - [ ] One `ConfirmDialog` component exists. It shows the action, the count, a Cancel button and a danger button. It closes on Escape.
  - [ ] Delete in Orders, Checkout forms, Workflows, Staff and Customers uses it.
  - [ ] The Customers search is a text input, not a button (fix 29).
  - [ ] A test scans each page for `<button>` elements with no handler and no `type="submit"`. The build fails if it finds one.
  - [ ] Each area file's dead-button list is checked off in its acceptance criteria.
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: a bulk delete of 500 orders shows the count and needs a typed word "DELETE" above 50 items (GUESS: threshold; owner can change).
- Tests: component test for `ConfirmDialog`; static scan test for dead buttons.

### F-112: Wording guard
- Priority: P1. Milestone: M1 (start), kept for all later milestones.
- Description: Three words must never appear in UI text. "Airtime" (decision D9). "Delivery rate" (design doc section 4.1 rule 4; use confirmation rate, delivery success rate, order-to-cash yield). The old "26%" and the "₦6,400 ceiling" must not appear as KPIs.
- Current app: not present. The mockups and `DESIGN-SPEC.md` still contain them (gap-matrix section 4 rows 1 and 22).
- Mockup: remove "80% airtime" lines (row 1). The mockup files stay as they are; the guard applies to the app.
- Acceptance criteria:
  - [ ] A CI test scans `frontend/src` strings and `backend/src` response text for `airtime`, `delivery rate` (case-insensitive) and `6,400`. It fails on a match. Code identifiers (for example a field named `deliveryRate` on `User`) are listed in an allow-list file with a reason.
  - [ ] Reward tiers in the app are cash tiers only (see area 12).
  - [ ] `docs/mockups/v2/DESIGN-SPEC.md` is updated: replace "delivery rate 26% (target 40%)" and "ceiling ₦6,400" with the three named rates and max CPA. (Gap-matrix section 4 row 22.)
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: `User.deliveryRate` (a Float, the old per-delivery pay) is a field name, not UI text. It is removed (decision F1): the delivery fee comes from one fee rule per partner (area 07, F-703). Check with `grep -rn deliveryRate backend/src` that nothing still reads it.
- Tests: the scan test itself, with a fixture file that must fail.

### F-113: Shared reference data
- Priority: P1. Milestone: M1.
- Description: Keep one source for lists that several screens use. (1) The regions of the store's country. (2) The currency list. (3) The order number format. (4) The order status display map. Today the currency lists differ (Settings has 10, onboarding has 8), the mockup region lists use 6 or 7 regions, and the mockup order numbers use three formats (#24xxx, CA-482xx, #MG-104xx).
- Current app: `inventory-frontend.md` 4.5 (currency lists); onboarding country list of 10.
- Mockup: gap-matrix section 4 rows 10, 11, 24.
- Acceptance criteria:
  - [ ] `regions.ts` is one helper that returns the regions of a country from `country-state-city` data (decision O3). It holds no fixed list for one country. The store's country comes from setup (F-124). (CHECK the library list for the store's country before M3.)
  - [ ] Cities are shown as "city", never as "region" (Reports uses cities).
  - [ ] One currency list serves onboarding and Settings. GUESS: use the union of the two current lists (GHS, NGN, KES, ZAR, UGX, TZS, RWF, ETB and the two extra in Settings). Check the Settings list in `Settings.tsx` before M1.
  - [ ] Every order shows one number format everywhere. Use the numeric order number with `#` (for example `#24117`), as in the dashboard mockup. GUESS: `Order.orderNumber` is the source. Check the schema field name.
  - [ ] The order status display map has one entry per `OrderStatus` value. Screens may show friendlier labels for a role (for example the rep sees "Waiting for call" for `pending_confirmation`). All labels come from this one map. "Not reachable" is a call outcome, not an order status (fix 10, E3).
- Data: none (constants). API: `GET /api/reference/regions` may serve the list to the public checkout form.
- Permissions: read for all; no write.
- Edge cases and errors: an unknown region string on an old order shows as "Other (<text>)". Old orders are not rewritten.
- Tests: unit tests for the helper (regions of two countries, no duplicates) and the other constants; a test that every `OrderStatus` has a label.

### F-114: Canonical demo fixture
- Priority: P1. Milestone: M1.
- Description: Build one seed fixture that reproduces `NUMBERS.md` (1 to 17 October 2026) so tests and the staging site show the same numbers as the mockups. One order table feeds every screen. This stops the mockup problems where the same order id belongs to different customers (fix 12).
- Current app: `backend/scripts/*`, `prisma/seed`; no fixture matches `NUMBERS.md`.
- Mockup: `NUMBERS.md`.
- Acceptance criteria:
  - [ ] `npm run seed:fixture` builds: 1,445 orders; 1,026 confirmed; 376 delivered; 354 failed; 48 returned; 148 out for delivery; 100 waiting to dispatch; 64 pending; 355 cancelled; delivered revenue GH₵92,000; AOV GH₵245; the five delivery partners with the assigned, delivered and failed counts in `NUMBERS.md`; the three call reps; 5 Meta campaigns with the spend in `NUMBERS.md`.
  - [ ] KPI service tests assert: confirmation rate 71%; delivery success rate 48% (376 / 778); order-to-cash yield about 34%; orders needed per day 56 (October, 31 days; decision R2).
  - [ ] The fixture also seeds delivered revenue for January to September 2026 as the Targets mockup shows: Jan 118k, Feb 121k, Mar 133k, Apr 131k, May 142k, Jun 148k, Jul 158k, Aug 166k, Sep 173k (GH₵ thousands). Quarters then total Q1 372k, Q2 421k, Q3 497k, and the year to date is GH₵1.38M with October. These months may use a small number of large synthetic orders, as long as revenue by delivery date is exact. Margin history (Q1 11%, Q2 12%, Q3 12%, year to date 12%) comes from seeded expenses and is checked in area 10.
  - [ ] The fixture runs only when `NODE_ENV` is not `production`.
  - [ ] The fixture is deterministic (fixed random seed).
- Data: seed script only. API: none.
- Permissions: not applicable.
- Edge cases and errors: the fixture must not run against a database that already holds real orders (check order count first, abort if above 0 unless `--force`).
- Tests: the fixture's own self-check test compares the counts above.

### F-115: Remove unrouted files
- Priority: P2. Milestone: M3.
- Description: Delete files that no route reaches, so no one revives them by mistake.
- Current app: `pages/Dashboard.tsx`, `OrdersList.tsx`, `OrdersKanban.tsx`, `CallsDashboard.tsx`, `WorkflowEditor.tsx` with `components/workflow/*`, `pages/mobile/MobilePlaceholder.tsx`, `components/layout/MobileNav.tsx`, `AgentCreateModal` (gap-matrix section 3 row 20).
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] The files above are deleted. The build, lint and tests pass.
  - [ ] A grep shows no import of the deleted files.
  - [ ] `WorkflowWizard` stays (area 05 restyles it).
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: if a file is imported by a test, delete the test too and say so in the pull request.
- Tests: `npm run build` and `npm test` pass.

---

## 3. Requirements: auth and public pages

### F-120: Login
- Priority: P0. Milestone: M3.
- Description: Keep the login page. Restyle it in v2. After login, send the user to their home route (F-102, F-103). Platform admins use the same page on the platform domain.
- Current app: `pages/Login.tsx` (zod: valid email, password min 6), `POST /api/auth/login`, `authStore`; `PlatformLogin` for the platform domain.
- Mockup: not in mockup (restyle).
- Acceptance criteria:
  - [ ] Wrong password shows a generic message ("Email or password is wrong") and does not say which one failed.
  - [ ] After 40 failed attempts in 15 minutes from one address, the API returns 429 (current `authLimiter`).
  - [ ] The page links to forgot password. It has no "Sign up" link while SaaS signup is off (F-123).
  - [ ] Access token life 15 minutes and refresh token life 7 days stay as today. A refresh happens without a page reload.
  - [ ] A platform admin who signs in on the tenant domain is sent to `/platform`.
- Data: none. API: unchanged.
- Permissions: public.
- Edge cases and errors:
  - A deactivated user (`isActive = false`) gets the generic failure message.
  - The refresh token is rotated on each refresh; a reused old token signs the user out.
- Tests: integration for login, refresh rotation, rate limit; e2e for each role's landing page.

### F-121: Forgot and reset password
- Priority: P1. Milestone: M3.
- Description: Keep both pages. Restyle. The reset link lives 15 minutes.
- Current app: `ForgotPassword`, `ResetPassword`; `POST /api/auth/forgot-password`, `/reset-password`.
- Mockup: not in mockup.
- Acceptance criteria:
  - [ ] Forgot password always answers "If an account exists with that email, we've sent a reset link", whether the email exists or not.
  - [ ] The reset page checks the token. An expired or used token shows "Request a new reset link".
  - [ ] New password rules: at least 8 characters with upper case, lower case, a digit and a special character. Password and confirm must match.
  - [ ] After reset, all refresh tokens of that user are cleared.
- Data: none. API: unchanged.
- Permissions: public.
- Edge cases and errors: the email provider is down: the API still returns the same message and logs the error.
- Tests: integration for token expiry and reuse; e2e happy path.

### F-122: Remove the public user registration route
- Priority: P0. Milestone: M0.
- Description: `POST /api/auth/register` is public. It creates a user with a privileged role and no tenant. A user with no tenant gets unfiltered data access, because the tenant filter passes queries through when there is no tenant (GUESS: severity high; the inventory marks it as unverified). Remove the route. People join through the owner's invite (area 12).
- Current app: `authController` `register`; `backend/src/routes/auth*`. Gap-matrix section 3 row 6.
- Mockup: none.
- Acceptance criteria:
  - [ ] `POST /api/auth/register` returns 404. The controller code is deleted.
  - [ ] Before deleting, a test proves the problem: register a user, log in, read orders of another tenant. Keep the test as a regression test that now expects 404 on register.
  - [ ] Any existing user with `tenant_id IS NULL` and `isPlatformAdmin = false` is listed in a report. The owner decides to assign or deactivate each one. No automatic delete.
  - [ ] No script or page still calls the route.
- Data: report query only. API: route removed.
- Permissions: not applicable.
- Edge cases and errors: the platform admin script `create-platform-admin` must still work (it writes directly, not through this route).
- Tests: integration (404); a two-tenant test for the null-tenant check (see F-150).

### F-123: SaaS signup, pricing and plan limits
- Priority: P2. Milestone: M3.
- Description: Seller SaaS is out of this rebuild (design doc non-goals). The public `/register` page, the `/pricing` page and `POST /api/auth/register-tenant` stay in the code but are switched off by a flag. Decision G2: Billing and plans stay visible inside the app (the Billing tab itself is in area 12). Plan limits and subscription status are display only. The code does not enforce them. This is a known gap, accepted until the SaaS phase.
- Current app: `/register`, `/pricing`, `/settings/billing/callback`, `billingController`, `platformBillingService`. No limit is enforced (gap-matrix section 3 rows 9, 10, 44).
- Mockup: Billing tab in `settings.html` (area 12). Fix the plan numbers there to match the live plans (G2): Growth ₦10,000 a month, 5,000 orders, 10 staff; Scale ₦20,000, unlimited.
- Acceptance criteria:
  - [ ] An env flag `SAAS_SIGNUP_ENABLED` (default `false`) controls `/register`, `/pricing`, `POST /api/auth/register-tenant` and the subscription callback page. With the flag off: the API returns 404 and the pages redirect to `/login`.
  - [ ] The Billing tab still shows the plan, the order count against the limit and the status. Nothing blocks a user when a limit is passed.
  - [ ] The suspended or past-due tenant keeps full access (no change). The PRD records this as a known gap for the SaaS phase.
  - [ ] The pricing page copy for caps (5 products, 10 delivery agents, 5 forms) is not shown anywhere in the app while the flag is off, because the code does not enforce them.
- Data: none. API: flag only.
- Permissions: not applicable.
- Edge cases and errors: when SaaS starts later, turning the flag on must not need a code change.
- Tests: integration with the flag off (404) and on (201); component test for the redirect.

### F-124: Onboarding wizard shell (steps 1 and 2)
- Priority: P1. Milestone: M3.
- Description: The first-run wizard has six steps in the mockup rail: Your store, Connect your 3PL, Set your North Star, Driver targets, Invite your team, Rewards. This requirement covers the wizard shell, step 1 and step 2. Steps 3 to 6 belong to the North Star setup (area 12, F-1100 range). The wizard also stays reachable from "Set up North Star" in the sidebar until it is complete.
- Current app: `/onboarding` (three steps: country and currency, business details, done with plan activation). `POST /api/onboarding/setup`.
- Mockup: `index.html#onboard` rail. Steps 1 and 2 have no screen in the mockup (gap-matrix 1.21 AU-05).
- Acceptance criteria:
  - [ ] Step 1 "Your store": business name, country, business email, phone, address, tax id (the last four optional). The owner picks the country; the store currency is that country's currency and is set automatically (decision O3). The regions list comes from the country. The app is English only.
  - [ ] The store currency is not locked (decision O6). The owner can change it in Settings at any time. The screen says this in one line.
  - [ ] Step 2 "Connect your 3PL": the owner adds the first delivery partner (name, type 3PL or agent). The owner can skip. The partner is created through the Deliveries service (area 07).
  - [ ] Steps 3 to 6 link to the North Star setup (area 12). The rail shows each step as done when its data exists: a North Star target, driver targets, a second user, reward tiers.
  - [ ] Step 1 and 2 data is saved on Next. Back keeps entered values. The wizard can close and resume.
  - [ ] When the plan status is `pending`, the final step shows "Activate <plan>" (as today). The owner tenant is on the free plan, so it skips this.
- Data: `Tenant.currency` (set from the country; can change later; no lock field). API: `POST /api/onboarding/setup` (steps 1 and 2 fields); `GET /api/onboarding/status` returns the done state of each step.
- Permissions: owner only.
- Edge cases and errors:
  - Currency change after sales (decision O6): allowed. The API saves it and the app converts figures with the per-day rate history. A missing rate day uses the nearest earlier rate and shows a note (PRD section 5.7).
  - The legacy path that auto-creates a tenant for a tenantless user is removed with F-122.
- Tests: integration for a currency change after orders exist (saves; figures convert by the record date); e2e for steps 1 and 2 with back and resume.

### F-125: Public order tracking and digital download
- Priority: P2. Milestone: M0 (check), no UI change.
- Description: Keep the API-only public order tracking and the signed digital download link. No page is built for tracking now. Add tests for the rate limits and the token expiry.
- Current app: `POST /api/public/orders/track` (phone plus order id, 30 requests per 15 minutes); `GET /api/public/download/:token` (default 72 hours, 5 downloads).
- Mockup: none.
- Acceptance criteria:
  - [ ] Tracking returns only the order status and the delivery partner name, no address, no phone.
  - [ ] The 31st request in 15 minutes from one address gets 429.
  - [ ] An expired or exhausted download token returns 410.
- Data: none. API: unchanged.
- Permissions: public.
- Edge cases and errors: wrong phone for an order id returns the same message as "not found".
- Tests: integration for both endpoints.

### F-126: Authorization hardening
- Priority: P0. Milestone: M0.
- Description: Close four access gaps listed in `inventory-backend.md` 7.5.
- Current app: delivery routes with no role check (`GET /deliveries`, `/:id`, `/routes/:agentId`, `PATCH proof`, `PATCH complete`); `GET /api/admin/config` without login and without tenant; `/metrics` and `/health/detailed` public. Gap-matrix section 3 rows 29, 30, 32.
- Mockup: none.
- Acceptance criteria:
  - [ ] Delivery routes require a role (owner, admin, manager, or the assigned delivery agent). A delivery agent can read and change only their own deliveries. Test: agent A requests agent B's delivery and gets 403.
  - [ ] `GET /api/admin/config` resolves the tenant from the request host (tenant slug) or requires login. With two tenants, it returns the right business name and never the first row. GUESS: the tenant host mapping exists; check how `FRONTEND_URL` and tenant slugs map before M0.
  - [ ] `/metrics` and `/health/detailed` need a shared secret header or an internal network address. `/health`, `/ready`, `/live` stay public.
  - [ ] The check for each is in a test.
- Data: none. API: as above.
- Permissions: as above.
- Edge cases and errors: the load balancer health check must keep working with `/health`.
- Tests: integration tests for the four items with two tenants.

---

## 4. Requirements: platform admin and correctness base

### F-140: Platform admin pages
- Priority: P3. Milestone: M3 (small fix only).
- Description: Platform admin pages stay as they are (design doc: out of scope for the redesign). Dashboard, tenants, tenant detail, announcements and billing events keep their behaviour. One fix: the tenant plan filter lists Free, Starter, Pro, Enterprise. It must list the live plans (free, growth, scale, enterprise).
- Current app: `/platform/*` (`PlatformDashboard`, `PlatformTenants`, `PlatformTenantDetail`, `PlatformAnnouncements`, `PlatformBilling`); `backend/src/routes/platform*`. Gap-matrix section 3 row 45.
- Mockup: none.
- Acceptance criteria:
  - [ ] The plan filter options come from `GET /api/platform/plans` (active plans).
  - [ ] All other platform behaviour is unchanged. Existing platform tests still pass.
  - [ ] Platform routes run under the platform guard (`requirePlatformAdmin` reads the flag from the database on each request).
- Data: none. API: unchanged.
- Permissions: `isPlatformAdmin` only.
- Edge cases and errors: a legacy tenant on a deactivated plan (starter, pro) still shows its plan name.
- Tests: component test for the filter options; existing platform tests.

### F-150: Tenant isolation fails closed
- Priority: P0. Milestone: M0.
- Description: Today the Prisma tenant extension lets a query through when there is no tenant context. Cron jobs, queues, public routes and webhooks must set a context. A query with no context on a scoped model must throw, unless the code opts in with a named bypass. This closes the "fail-open" risk (design doc risk 8). The same work fixes `agingService.refreshAll`, which runs `deleteMany({})` across all tenants.
- Current app: `backend/src/utils/prismaExtensions.ts` (`TENANT_SCOPED_MODELS`, 24 models), `utils/tenantContext.ts`, `agingService`, queues in `backend/src/queues`. Gap-matrix section 3 row 34.
- Mockup: none.
- Acceptance criteria:
  - [ ] A scoped-model query with no tenant context throws `TenantContextMissing`, except inside `withoutTenant('reason')`, which logs its use.
  - [ ] Each queue job and each cron entry runs inside `tenantStorage.run`. Jobs that need all tenants loop over tenants and run once per tenant.
  - [ ] `agingService.refreshAll` runs per tenant and deletes only that tenant's buckets.
  - [ ] Public routes (`/api/public/*`, webhooks) resolve the tenant from the form slug, the webhook URL or the tenant slug before any query.
  - [ ] A two-tenant test suite covers: orders, customers, products, deliveries, collections, GL entries, notifications, MCP tools. Tenant B data never appears for tenant A.
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors:
  - Startup seeding runs before any tenant exists: it uses `withoutTenant('seed')`.
  - Platform admin routes use `withoutTenant('platform')` on purpose.
- Tests: the two-tenant suite above; a unit test for the extension that throws without context.

### F-151: Add `tenantId` to the 12 models that lack it
- Priority: P0. Milestone: M0.
- Description: Add a required `tenantId` to the models that have none, backfill it, and add them to the scoped list. Without it, these models leak between tenants.
- Current app: schema models without `tenantId`: `AgentCollection`, `AgentDeposit`, `AgentAgingBucket`, `Payout`, `Call`, `OrderHistory`, `AuditLog`, `WebhookLog`, `SmsTemplate`, `DownloadToken`, `FormSubmission`, `product_cost_entries` (design doc 5.3; `OrderItem` relies on its parent order, see edge cases). `PendingCheckout` and `WebhookEvent` have the column but are not in the scoped list. `Notification.tenantId` is optional today and becomes required. Gap-matrix section 3 rows 36 and 46.
- Mockup: none.
- Acceptance criteria:
  - [ ] Each listed model has `tenantId String` (required) with an index and a relation to `Tenant`.
  - [ ] A migration backfills `tenantId` from the parent row (for example `AgentCollection` from its order or agent). Rows with no parent are listed in a report and fixed by hand.
  - [ ] After backfill, no row has `tenant_id IS NULL` in these tables. A query proves it.
  - [ ] All 14 models are in `TENANT_SCOPED_MODELS`.
  - [ ] Every new model added later (design doc 5.3) has a required `tenantId` and is in the list. A test lists all Prisma models and fails if a model with `tenantId` is missing from the scoped list.
- Data: the changes above. API: none.
- Permissions: not applicable.
- Edge cases and errors:
  - `OrderItem` and `OrderHistory` link to an order. Decision for `OrderItem`: GUESS: keep scoping through the parent; add `tenantId` only if a query reads it alone. Check with a grep for direct `orderItem` queries.
  - The migration runs on production data: run it on staging with a production dump first (F-153).
- Tests: migration test on a fixture with two tenants; scoped-list completeness test.

### F-152: Per-tenant uniques and chart seed
- Priority: P0. Milestone: M0.
- Description: Some unique keys are global: `Account.code`, `JournalEntry.entryNumber`, `Product.sku`, `SmsTemplate.name`, `CheckoutForm.slug`, `MessageLog.providerMessageId`. A second tenant could not use the same code. Startup seeding also creates chart-of-accounts rows with `tenant_id = NULL`. The tenant extension then hides them. This is the "null-tenant register" risk (design doc risk 7; memory note on NULL `tenant_id` hiding rows).
- Current app: `schema.prisma` uniques; startup seed; `register-tenant` seeds no chart. Gap-matrix section 3 row 35.
- Mockup: none.
- Acceptance criteria:
  - [ ] `Account.code`, `JournalEntry.entryNumber`, `Product.sku` and `SmsTemplate.name` are unique per tenant (`@@unique([tenantId, code])` and so on). `CheckoutForm.slug` stays globally unique because it is a public URL (GUESS: keep global; check with the owner). `MessageLog.providerMessageId` stays global because it is a provider id.
  - [ ] A script backfills `tenant_id` on the NULL chart rows to the owner's tenant. A report lists any other NULL-tenant rows in all scoped tables.
  - [ ] Creating a tenant (platform `POST /tenants` or `register-tenant`) seeds its own chart of accounts and email templates.
  - [ ] The GL service finds accounts by code inside the tenant context.
  - [ ] Test: two tenants each post a delivery; each has revenue in its own account 4010.
- Data: the unique-key changes; the seed function `seedTenantDefaults(tenantId)`. API: none.
- Permissions: not applicable.
- Edge cases and errors: the backfill must be idempotent (safe to run twice).
- Tests: two-tenant GL test; seed idempotency test.

### F-153: Migration integrity and deploy guard
- Priority: P0. Milestone: M0.
- Description: Make `prisma migrate deploy` build the same schema as production. Three migration folders dated 18 February 2026 (`20260218*`) hold only a comment ("applied directly to DB"). Eleven additive migrations are pending on production (memory note). The staging deploy script ignores a failed migration. All three block safe new migrations (design doc risks 5 and 6).
- Current app: `backend/prisma/migrations/20260218*`, `scripts/deploy-staging.sh` (GUESS: path; find with `grep -rn "migrate deploy" scripts`). Gap-matrix section 3 row 37.
- Mockup: none.
- Acceptance criteria:
  - [ ] A `pg_dump --schema-only` of production is diffed against a database built by `migrate deploy`. The diff is saved in the pull request.
  - [ ] Each placeholder migration is replaced by real SQL for the objects it created, or deleted when the objects exist from other migrations. The `period_close` enum value (design doc risk 15) is checked first.
  - [ ] The 11 pending migrations are applied on staging first, then production, with a backup before each.
  - [ ] The deploy script exits with a non-zero code when `migrate deploy` fails. The deploy stops.
  - [ ] After this work, `migrate deploy` on an empty database equals production (diff is empty).
- Data: migrations only. API: none.
- Permissions: not applicable.
- Edge cases and errors: never run `migrate reset` against production. A dry run on a copy comes first.
- Tests: CI job builds a fresh database with `migrate deploy`, runs `prisma migrate diff` against the schema file, and fails on any difference.

### F-154: Money columns from Float to Decimal
- Priority: P0. Milestone: M0 (decision D4).
- Description: Convert all money columns from `Float` to `Decimal(19,4)`. The books already use Decimal; orders, products, expenses and payouts use Float. Float rounding can make totals disagree by a cent. New models use Decimal from the start.
- Current app: Float money columns today: `Tenant.defaultDeliveryFee`; `User.commissionAmount`, `User.deliveryRate` (removed, decision F1, not converted), `User.totalEarnings`; `Customer.totalSpent`; `Product.price`; `Order.subtotal`, `shippingCost`, `discount`, `totalAmount`, `codAmount`; `OrderItem.unitPrice`, `totalPrice`; `Transaction.amount`; `Expense.amount`; `FormPackage.price`, `discountValue`, `originalPrice`; `FormUpsell.price`, `discountValue`, `originalPrice`; `FormSubmission.totalAmount`; `PendingCheckout.subtotal`, `shippingCost`, `discount`, `totalAmount`, `codAmount`; `Payout.amount`; `product_cost_entries.amount`. `Product.weight` is not money and stays Float. GUESS: `discountValue` may hold a percent. Check how `FormPackage.discountType` is used before converting.
- Mockup: none.
- Acceptance criteria:
  - [ ] Before any conversion, a check on production data in M0 finds which money columns hold minor units (decision R15), first `Order.depositPaid` and `Order.balanceDue` (file 04, F-405). The result is written down and the migration converts those columns by dividing by 100 only where the check proves minor units.
  - [ ] Every column above (except weight and the removed `User.deliveryRate`) is `Decimal(19,4)`.
  - [ ] The migration copies values with rounding to 2 decimals for amounts in GH₵. A script compares before and after totals for orders, expenses and payouts and prints zero difference to the cent.
  - [ ] TypeScript code does not use `number` arithmetic on money. A `Money` helper (Decimal.js or Prisma `Decimal`) does add, multiply and round. API responses send money as a string with two decimals (for example `"249.00"`). The frontend parses them in one place.
  - [ ] All tests pass. Totals in the fixture (F-114) stay: delivered revenue GH₵92,000.00.
  - [ ] The migration runs on a staging copy of production first, with timing recorded. Plan for a maintenance window if it exceeds 5 minutes (GUESS: threshold).
  - [ ] August and September stay as booked (decision D5): the migration does not restate them. The Finance area adds the note (area 10).
- Data: the column changes above. API: money fields change from JSON number to string.
- Permissions: not applicable.
- Edge cases and errors:
  - A Float like 0.1 + 0.2 in old data: rounding makes it 0.30.
  - API clients (MCP tools, external webhooks) that expect numbers: MCP tools return strings with a field note. GUESS: no outside client parses the API. Check the `cod-admin` MCP users and the scripts that outside agents run.
- Tests: unit tests for `Money`; migration test with edge values; contract test for string money in responses.

### F-155: Baseline branch, repo notes and docs
- Priority: P1. Milestone: M0.
- Description: Pick the baseline. `develop` equals `main` (PRs #300 and #301 merged). The MAN-56 order state machine exists only on a local five-month-old branch; the owner decided to rebuild it in M1 (D7). Multi-store branches stay unmerged until SaaS. Fix `CLAUDE.md`, which names Shadcn and `WorkflowEditor`.
- Current app: git state in design doc 5.1; `CLAUDE.md`. Gap-matrix section 3 row 50.
- Mockup: none.
- Acceptance criteria:
  - [ ] All rebuild work branches from `develop`.
  - [ ] `CLAUDE.md` lists the real UI approach (hand-written components with tokens) and `WorkflowWizard`.
  - [ ] The old MAN-56 and multi-store branches stay untouched and are listed in the PRD change log as reference only.
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: none.
- Tests: none (documentation).

### F-156: Test baseline and coverage gate
- Priority: P1. Milestone: M0.
- Description: Record what the test suites do today, then keep them from sliding. The backend gate is lines 37% and branches 25%. Whether the suites pass today is unknown (design doc risk 16: not run).
- Current app: Jest (about 91 files), Vitest and Playwright (`e2e/`).
- Mockup: none.
- Acceptance criteria:
  - [ ] Run `npm test` in `backend` and `frontend` on `develop`. Save the result (pass or fail counts) in the pull request.
  - [ ] Fix failing tests or mark each with a reason and a ticket. Do not leave silent skips.
  - [ ] New code files must have a test file. Every KPI service and every registry tool has tests (see PRD section 8).
  - [ ] The coverage gate never drops below its current value, and moves up by 5 points at M5 and M11 (GUESS: targets; owner can change).
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: flaky tests are fixed or removed, not retried.
- Tests: CI runs both suites on every pull request.

---

## 5. Cross-area dependencies

| This file needs | From | F-ID or area |
|---|---|---|
| Rep app and its routes | Area 08 rep screen | F-750 range |
| Agent app and its routes | Area 09 agent app | F-800 range |
| Inbox page, `Notification` fields | Area 05 | F-550 range |
| Settings tabs, Billing tab, permission matrix editor, Staff invite and `RoleAssignment` | Area 12 | F-1150, F-1200 ranges |
| North Star setup steps 3 to 6 | Area 12 | F-1100 range |
| Partner create (wizard step 2) | Area 07 | F-700 range |
| Stock count modal, partner payout modal for palette actions | Areas 06 and 10 | F-650, F-900 ranges |
| "Ask the agent" and the AI drawer mount | Area 13 | F-1310 |
| KPI services for the nav counts | Area 02 | F-250 to F-253 |
| Order number field and status display map | Area 03 | F-300 range |

---

## 6. Coverage table

Rows come from `docs/prd/gap-matrix.md`.

### 6.1 Feature matrix 1.1, 1.21, 1.22 (30 rows)
| Row | Covered by |
|---|---|
| SH-01 Sidebar groups | F-101 |
| SH-02 Menu filtered by role | F-102 |
| SH-03 Collapsible sidebar | F-101 |
| SH-04 Header search | F-105 |
| SH-05 Notification bell | F-106 |
| SH-06 User menu | F-104 |
| SH-07 Platform announcement banner | F-108 |
| SH-08 Pending plan banner | F-108 (kept, per G2) |
| SH-09 Sales-rep onboarding tour | DROP: the rep app replaces it (F-103) |
| SH-10 Rep Help menu | DROP: same reason (F-103) |
| SH-11 PWA update prompt | F-109 |
| SH-12 Error boundary and 404 | F-109 |
| SH-13 Store chip "2 stores" | DROP: multi-store is out until SaaS (D7); F-101 shows the plain chip |
| SH-14 Me chip | F-104 |
| SH-15 Dark mode | F-107 |
| SH-16 Command palette | F-105 |
| SH-17 AI drawer | F-1310 (area 13) |
| SH-18 "Mobile View" switch | DROP: the agent app is separate (F-103) |
| SH-19 Realtime refresh | F-110 |
| SH-20 Sample-data pill | DROP: mockup only (F-100) |
| AU-01 Login | F-120 |
| AU-02 Forgot and reset password | F-121 |
| AU-03 Register (tenant signup) | F-123 |
| AU-04 Pricing page | F-123 |
| AU-05 Onboarding | F-124 |
| AU-06 Subscription callback | F-123 |
| AU-07 Public order tracking | F-125 |
| AU-08 Digital download link | F-125 |
| AU-09 Platform login | F-120 |
| PA-01 Platform admin | F-140 |

Count: SH 20 + AU 9 + PA 1 = 30. The matrix has SH-01 to SH-20, AU-01 to AU-09 and PA-01. Counts match.

### 6.2 Gap-matrix section 3 rows taken by this file
| Row | Item | Covered by |
|---|---|---|
| 6 | Public `POST /auth/register` | F-122 |
| 9 | Plan limits not enforced | F-123 (display only, known gap) |
| 10 | Suspended tenants keep access | F-123 (known gap) |
| 20 | Unrouted files | F-115 |
| 23 | Header search does nothing | F-105 |
| 25 | Kanban `$` and Earnings GHS hard-coded | F-100 (store currency formatter); Kanban and Earnings are dropped |
| 26 | Currency lists differ | F-113 |
| 29 | Delivery routes lack role check | F-126 |
| 30 | `GET /admin/config` unauthenticated | F-126 |
| 31 | Socket rooms not tenant-scoped | F-110 |
| 32 | `/metrics` and `/health/detailed` public | F-126 |
| 34 | `agingService.refreshAll` global | F-150 |
| 35 | Chart seeded with NULL tenant; global uniques | F-152 |
| 36 | 12 models lack `tenantId` | F-151 |
| 37 | Empty migrations; failed migrate tolerated | F-153 |
| 44 | Pricing caps not enforced | F-123 |
| 45 | Platform plan filter stale | F-140 |
| 46 | `Call` has no `tenantId` | F-151 |
| 50 | `CLAUDE.md` doc rot | F-155 |

Rows taken in other files of Builder A: 16, 17, 18, 19, 22 (analytics part) in area 02 (F-250 to F-254); 33, 39 in area 13 (F-1302, F-1303, F-1305).
Rows left to other builders (they appear in their coverage tables): 1 to 5 (profile, password, notification toggles, templates, admin settings tabs), 7, 8, 11 to 15, 21, 22 (other parts), 24, 27, 28, 38, 40 to 43, 47 to 49. GUESS: Builder B1, B2 and C own them by area. The coordinator must check that none is missing.

### 6.3 Gap-matrix section 4 rows taken by this file
| Row | Item | Covered by |
|---|---|---|
| 1 | Rewards in two places; airtime | F-112 (wording guard); tiers in area 12 |
| 10 | Order statuses differ per screen | F-113 (display map); Settings part in area 12 |
| 11 | Order id formats | F-113 |
| 12 | Same id maps to different customers | F-114 |
| 22 | `DESIGN-SPEC.md` lists 26% and ₦6,400 | F-112 |
| 24 | Region lists | F-113 (list); Workflow region condition in area 05 |
| 25 | Dead buttons | F-111 (rule and scan); per-screen lists in each area |
| 26 | North Star steps 4 to 6 | F-124 (rail and steps 1 and 2); steps 3 to 6 in area 12 |
| 29 | Delete confirms inconsistent | F-111 |
| E1 | Chart of accounts codes | not here (area 10) |

Rows 2, 3, 4 to 9, 13 to 21, 23, 27, 28, 30, E2 to E4 belong to other areas.

### 6.4 Totals
Rows in gap-matrix 1.1, 1.21, 1.22: 30. Covered here: 30 (6 marked DROP). Section 3 rows taken: 19. Section 4 rows taken: 9 of 30 (plus the extras listed as not here). Feature F-IDs written: 31 (F-100 to F-115 is 16; F-120 to F-126 is 7; F-140 is 1; F-150 to F-156 is 7).
