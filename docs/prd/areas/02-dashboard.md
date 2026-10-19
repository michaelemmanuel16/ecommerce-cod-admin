# Area 02: Dashboard and the leadership KPI services

F-ID range: F-200 to F-299. Owner of this file: Builder A.
Date: 2026-10-18. Status: draft for owner review.

Sources: `docs/prd/decisions.md`, design doc sections 3, 4, 5.4, 9 and 10, gap-matrix 1.2, `docs/mockups/v2/index.html#dash`, `NUMBERS.md`.
GUESS means a source did not prove the statement. The text says how to check it.

---

## 1. Scope

This file covers:
- Gap-matrix 1.2 Dashboard: DB-01 to DB-15.
- The KPI services that the dashboard needs: one revenue definition, the three named rates, the pace and projection numbers (design doc section 4.2 and 4.5). The other KPI groups (marketing, finance, conversion) are specified in the area files that own them (11, 10, 08). This file defines the shared rules every KPI service follows (F-250).
- Gap-matrix section 3 rows 16, 17, 18, 19 and 22 (analytics part). Section 4 row 20 (the failed-delivery-calls quest).

Roles: owner, admin and manager see the Dashboard. The finance clerk and the stock keeper have other homes (F-210, F-211). Call reps and delivery agents have their own apps (F-212).

Milestones: the KPI services land in M1. The Dashboard on live services lands in M3 (design doc section 10).

---

## 2. Requirements: dashboard screen

### F-200: Dashboard page and data endpoint
- Priority: P0. Milestone: M3.
- Description: Build the owner dashboard as the mockup shows it. It answers one question: are we on track for the North Star, and if not, why. The page reads one endpoint. The endpoint calls the KPI services (F-250 to F-253). It never computes a number itself. This replaces `DynamicDashboard` and its per-role config files for the owner, admin and manager.
- Current app: `frontend/src/pages/DynamicDashboard.tsx`; `frontend/src/config/dashboards/adminConfig.ts`; `/api/analytics/dashboard`, `sales-trends`, `conversion-funnel`, `status-distribution`, `customer-insights`. Stats today: Total Revenue, Total Orders, Total Customers, Delivery Rate.
- Mockup: `index.html#dash`.
- Acceptance criteria:
  - [ ] The page has these blocks in this order: header, target ladder (F-202), today's targets (F-203), four driver tiles (F-204), chart with three driver cards (F-205), agent cards (F-206), recent orders (F-207), top this month (F-208).
  - [ ] One call to `GET /api/dashboard/owner` returns every block. The page shows a skeleton per block while it loads. One failing block shows an inline error with a retry button. The other blocks still show.
  - [ ] Each number has an info tooltip with its name, formula and date basis (design doc section 4.1 rule 2).
  - [ ] The page uses only the three rate names: confirmation rate, delivery success rate, order-to-cash yield. It never shows "delivery rate", "26%" or "₦6,400" (F-112).
  - [ ] With the fixture (F-114) the page shows: North Star GH₵1.38M of GH₵1,800,000; October GH₵92k of GH₵180,000; confirmation rate 71%; delivery success rate 48%; yield 34%; cash still with agents GH₵23.4k.
  - [ ] Dark mode and phone width (760 px) work (F-100, F-107).
- Data: none new. Reads `Target` (area 12, F-1100 range), `Order`, `AgentCollection`, `AgentDeposit`.
- API: `GET /api/dashboard/owner?range=month&asOf=YYYY-MM-DD` returns `{ header, ladder, quests, tiles, chart, drivers, recentOrders, top }`. `asOf` defaults to today in the store time zone. Cache: 30 seconds per tenant and range (GUESS: invalidate on `order:status_changed`; check Redis cache middleware).
- Permissions: `analytics:view` and role owner, admin or manager. The cash tile needs `financial:view`; without it the tile is hidden.
- Edge cases and errors:
  - No North Star target yet: the ladder shows a card "Set your North Star" with a button to the setup wizard (area 12). Tiles and recent orders still show.
  - No orders yet (new tenant): every tile shows 0 or "No data yet". No division by zero (rates show "n/a").
  - Time zone: all "today" boundaries use the store time zone (Settings, area 12). GUESS: the setting exists as `Tenant`/`SystemConfig` time zone. Check before M3.
- Tests:
  - Unit: endpoint service returns each block for the fixture.
  - Integration: two-tenant test (tenant B orders never show for tenant A); a role without `financial:view` gets no cash tile.
  - E2E: log in as owner; the page shows the fixture numbers above.

### F-201: Header, greeting, date range and refresh
- Priority: P1. Milestone: M3.
- Description: The header greets the person by name and time of day, and states what the month still needs. The "This month" button chooses the range. The mockup button is dead; make it work. The range choices are Today, This week, This month, Last 7 days, Last 30 days, This quarter, This year. The page refreshes by itself when a related socket event arrives, and by hand with a refresh icon.
- Current app: date presets in `DynamicDashboard` (today, yesterday, this-week, this-month, last-7-days, last-30-days, this-year, last-year); throttled socket refetch; optional auto refresh.
- Mockup: `index.html#dash` header: "Good evening, Manny" and "Friday 17 October. You need GH₵2,100 more delivered revenue today to stay on pace." Buttons: "This month" (dead) and "Download report" (removed, see F-209).
- Acceptance criteria:
  - [ ] The greeting uses the signed-in person's first name and the store time zone: before 12:00 "Good morning", 12:00 to 17:59 "Good afternoon", from 18:00 "Good evening".
  - [ ] The sub-line reads: "<weekday> <day> <month>. You need GH₵<X> more delivered revenue today to stay on pace." X = today's target minus today's delivered revenue (F-203). If today's target is met, it reads "You hit today's target."
  - [ ] With the fixture on 17 October: today's target GH₵6,286 (shown GH₵6.3k) minus GH₵4,200 delivered today = GH₵2,086, shown as "GH₵2,100". Rounding is to the nearest GH₵100.
  - [ ] The range button opens a menu with the choices above. The choice changes the tiles, the chart and the recent orders. The target ladder always shows year, quarter, month and day, whatever the range.
  - [ ] A socket event (`order:status_changed`, `delivery:completed`, `payment:received`, `bulk_import_completed`) triggers one refetch at most every 5 seconds.
  - [ ] The page shows "Updated 06:42" style time of the last fetch.
- Data: none. API: `range` and `asOf` on F-200's endpoint.
- Permissions: as F-200.
- Edge cases and errors:
  - Last day of month: "days left" counts today only.
  - A range with a future date: the endpoint clamps to today.
- Tests: unit tests for greeting hours and the "more today" text; E2E range menu changes the tile numbers.

### F-202: Target ladder
- Priority: P0. Milestone: M3.
- Description: Show the North Star, the quarter target, the month target and today's target, with progress, a pace marker and a status tag at each level. The North Star card also shows a margin chip and a pace chip. This is the first thing the owner reads.
- Current app: none (new). Needs the `Target` model (area 12, F-1100 range).
- Mockup: `index.html#dash` ladder: "North Star 2026" GH₵1.38M of GH₵1,800,000, chips "3 pts behind the year's pace" and "Margin 12% year to date · target 35%"; Q4 GH₵92k of GH₵540,000, 75 days left, "Behind"; October GH₵92k of GH₵180,000, 14 days left, "Off track"; today GH₵4.2k of GH₵6,300, 17 delivered so far, "In progress".
- Acceptance criteria:
  - [ ] Progress = delivered revenue by delivery date inside the period ÷ the period target.
  - [ ] Pace marker = days gone ÷ days in the period, for year, quarter and month. This is the mockup's rule (Q4: 17 ÷ 92 = 18.5%; October: 17 ÷ 31 = 55%). Note: the stepped plan (quarters that grow) would show the year as ahead; the mockup uses straight days, so the build uses straight days. Owner to confirm (open question 1).
  - [ ] Status tag: "On track" when progress is at or above the pace marker; "Behind" when it is below by less than 3 points; "Off track" when it is below by 3 points or more. GUESS: the 3-point split is inferred from the mockup (quarter 1.5 points below = Behind; month 3.8 points below = Off track). Owner to confirm.
  - [ ] Year chip: "<N> pts behind the year's pace" or "<N> pts ahead". N = progress points minus pace points, rounded. With the fixture: 76.7% minus 79.5% = 2.8, shown "3 pts behind".
  - [ ] Margin chip: "Margin <X>% year to date · target <T>%". X comes from the net margin KPI (area 10). With the fixture X = 12 and T = 35. If the margin KPI is not ready, the chip is hidden (not shown as 0).
  - [ ] Days left: "75 days left" for the quarter on 17 October (14 + 30 + 31). "14 days left" for October.
  - [ ] Today's rung: "GH₵4.2k of GH₵6,300 · 17 delivered so far". "17 delivered" is the count of orders with `deliveryDate` today.
  - [ ] Each rung is a link: the year and quarter go to Targets; the month goes to Targets; today stays.
  - [ ] Revenue counts delivered revenue (F-250). Margin shows beside revenue at year, quarter and month (decision D in `NUMBERS.md`).
- Data: `Target` (scope `north_star`, `quarter`, `month`; area 12). API: part of F-200.
- Permissions: as F-200.
- Edge cases and errors:
  - Quarter or month target missing: that rung shows "No target" with a link to Targets.
  - Progress above 100%: bar fills to 100%; the number keeps counting; the tag reads "Hit".
  - Margin target of 0: chip hidden.
- Tests: unit tests for pace, status tag and "pts behind" on the fixture (expect Behind, Off track, "3 pts behind"); edge test for the last day of a quarter.

### F-203: Today's targets
- Priority: P1. Milestone: M3.
- Description: Three daily quests: New orders, Delivered revenue, Failed delivery calls. Each shows progress and a tag. A header counts the days this month that were on target. Rewards and badges come only from hitting a target (no XP, no streaks; design doc decision, `DESIGN-SPEC.md` rule 4). The mockup quest "Failed delivery calls 6 of 15" has no setting in the app today (gap-matrix section 4 row 20): add it as a daily call-rep target in Targets.
- Current app: none.
- Mockup: `index.html#dash` "Today's targets": New orders 64 of 58 (Hit); Delivered revenue GH₵4.2k of GH₵6,300 (67%); Failed delivery calls 6 of 15 done (40%). Header: "On target 14 of 17 days this month".
- Acceptance criteria:
  - [ ] New orders = orders placed today (not cancelled later is not required; count all placed today). Target = orders needed per day from the North Star setup (56 in October with the fixture: real days in the month, decision R2). Tag "Hit" when count is at or above target.
  - [ ] Delivered revenue = delivered revenue dated today. Target = today's target = (month target − delivered revenue so far this month) ÷ days left after today. Fixture: (180,000 − 92,000) ÷ 14 = GH₵6,286, shown GH₵6,300.
  - [ ] Failed delivery calls = calls logged today on orders whose status is `failed_delivery`. Target = `Target` metric `failed_delivery_calls_per_day` for the role Call rep (default 15). GUESS: default 15 comes only from the mockup. Owner sets the real value in Targets (area 12).
  - [ ] Header "On target X of Y days this month": Y = days gone including today; X = days when the New orders quest was hit by end of day (the day in progress counts only if already hit). GUESS: the mockup does not say which quest decides the day. Owner to confirm (open question 2).
  - [ ] Bar colours: green at or above target, gold between 50% and 99%, coral under 50%.
  - [ ] Each quest links to its detail: New orders to Orders (today filter); Delivered revenue to Reports; Failed delivery calls to the Orders list with filter "failed, no call today".
  - [ ] No XP, level or streak text anywhere.
- Data: `Target` metric `failed_delivery_calls_per_day` (area 12); `Call` (`startedAt`, order link). API: part of F-200.
- Permissions: as F-200.
- Edge cases and errors:
  - No call-rep target set: the quest shows "Set a target" with a link to Targets.
  - A failed order with several calls today counts once per order (distinct orders called).
- Tests: unit test for each quest on the fixture; integration test for the distinct-order count.

### F-204: Driver tiles
- Priority: P0. Milestone: M3.
- Description: Four tiles: Orders today, Confirmation rate, Delivery success rate, Cash still with agents. They replace the old tiles (Total Revenue, Total Orders, Total Customers, Delivery Rate). Each tile shows the value, its target and a status tag.
- Current app: stats in `adminConfig.ts`: Total Revenue, Total Orders (with previous-period comparison), Total Customers, Delivery Rate. Delivery Rate mixes cohorts (numerator by `deliveryDate`, denominator by `createdAt`).
- Mockup: `index.html#dash` KPI tiles: Orders today 64 (target 58, "▲ 18% vs last Friday"); Confirmation rate 71% (target 70%, On track); Delivery success rate 48% (target 60% · yield 34%, "▼ 12 pts"); Cash still with agents GH₵23.4k ("38 orders over 8 days").
- Acceptance criteria:
  - [ ] Orders today: count of orders placed today. Compare to the same weekday last week ("vs last Friday"). With the fixture 64 and target 56 (October, decision R2).
  - [ ] Confirmation rate = confirmed ÷ orders placed, for the range, by order date. Target 70%. Fixture: 1,026 ÷ 1,445 = 71% (On track).
  - [ ] Delivery success rate = delivered ÷ (delivered + failed + returned), closed orders only. Target 60%. Fixture: 376 ÷ 778 = 48%. The tile text reads "Target 60% · yield 34%" and the delta reads "12 pts" below target. The tile states its basis: "orders placed in range" (cohort) or "delivered in range"; the default for this tile is the order cohort basis.
  - [ ] Cash still with agents = cash held by partners and agents (collected or delivered, not yet deposited), from the cash-held-by-partner KPI (area 10). Subtext: "<N> orders over <D> days" where D is the days-to-pay (area 12). Fixture: GH₵23.4k, 38 orders over 8 days.
  - [ ] Each tile links: Orders today to Orders; Confirmation rate to Reports (Team); Delivery success rate to Deliveries; Cash to Finance (unpaid delivered).
  - [ ] Tag rules: confirmation rate On track at or above target; delivery success On track at or above target, Behind when under by less than 3 points, Off track otherwise (same rule as F-202).
- Data: none. API: part of F-200.
- Permissions: the cash tile needs `financial:view`.
- Edge cases and errors:
  - Closed orders = 0: delivery success shows "n/a".
  - Same weekday last week has 0 orders: no percent delta, shows "no data".
- Tests: unit tests on the fixture for all four; a test that the API never returns a field called `deliveryRate`.

### F-205: Delivered revenue chart and driver cards
- Priority: P1. Milestone: M3.
- Description: A line chart of delivered revenue for the month against a straight target-pace line. Under it, three driver cards: Projected October, Needed per day, Biggest lever. The mockup chart is a drawn picture; build a real chart from daily data (Recharts is already in the frontend).
- Current app: line chart "Order Fulfillment Trend" from `/api/analytics/sales-trends` (reads all `totalAmount`, including cancelled).
- Mockup: `index.html#dash` chart card and `.drv` cards: Projected October GH₵164k (91% of target at today's rate); Needed per day GH₵6.3k (for the last 14 days); Biggest lever Delivery success (+5 pts = +GH₵22k this month).
- Acceptance criteria:
  - [ ] The chart has one point per day. Y value = cumulative delivered revenue by delivery date. The target pace line runs straight from 0 on day 1 to the month target on the last day.
  - [ ] The tooltip shows the date, delivered revenue to date and target pace for that day.
  - [ ] The legend reads "Delivered" and "Target pace".
  - [ ] Projected month = revenue so far ÷ days gone × days in month (design doc section 4.2). Fixture: 92,000 ÷ 17 × 31 = GH₵167.8k, 93% of target. The mockup shows GH₵164k (91%). The two differ by GH₵3.8k. RESOLVED (decision R1): the build follows the written formula; the mockup number is illustration only.
  - [ ] Needed per day = (month target − revenue so far) ÷ days left after today. Fixture: 88,000 ÷ 14 = GH₵6.3k.
  - [ ] Biggest lever = projected month confirmed orders × 5 points × AOV. It names the rate with the largest gap to target (delivery success: 12 points under; confirmation rate: above target). Fixture: 1,026 ÷ 17 × 31 = 1,871 confirmed; × 0.05 × GH₵245 = GH₵22.9k; the card shows "+GH₵23k" and the accepted range is GH₵21k to GH₵24k. The mockup shows GH₵22k (`NUMBERS.md`). GUESS: the exact formula is not written in any source. Owner to confirm (open question 3).
  - [ ] The projection card text states its basis: "at today's rate".
  - [ ] A screen-reader table or `aria-label` summarises the chart.
- Data: none. API: `chart: { days: [{ date, delivered, cumulative, targetPace }] }` in F-200.
- Permissions: as F-200.
- Edge cases and errors:
  - Month target missing: hide the pace line and the Needed per day card; show the other two.
  - Day 1 of the month: projection uses 1 day gone; it shows "Too early to project" when fewer than 3 days have passed (GUESS: threshold).
- Tests: unit tests for projection, needed per day and lever on the fixture; visual test for the chart in both themes.

### F-206: Agent cards on the dashboard
- Priority: P1. Milestone: M11.
- Description: The dashboard shows up to 3 suggestion cards from the problem finders. The cards, their finders, their pre-filled screens and the "never write" rule (decision G10) are specified in area 13 (F-1313, F-1314). This requirement fixes only the dashboard slot.
- Current app: none.
- Mockup: `index.html#dash` card "Agent found 3 things", updated 06:42: Logiswift paid GH₵840 less than its order list (11 Oct, 41 orders, 3 missing); Magic Groove stock is 12 units short (Logiswift 88, ours 100); ₦41,000 Meta spend has no product (campaign MG_Oct_Retarget).
- Acceptance criteria:
  - [ ] The slot calls `GET /api/suggestions?page=dashboard` and shows up to 3 cards, highest priority first.
  - [ ] With the fixture the three cards above show: short-pay GH₵840, 12 units short, ₦41,000 unmapped. The fixture is built so that the expected payout is cash collected minus fees (decision F4); the GH₵840 is a sample value (R1).
  - [ ] Header text is "Agent found N things" with the generated time. When N = 0 the card shows "Nothing to fix right now".
  - [ ] Until M11, the slot is hidden (not an empty card).
  - [ ] Each card button opens a pre-filled screen. It never changes data (G10).
- Data: see area 13. API: see area 13.
- Permissions: a card shows only if the user may open its target screen.
- Edge cases and errors: the suggestions call fails: hide the slot; the page works.
- Tests: component test with 0, 1 and 3 cards; E2E on the fixture.

### F-207: Recent orders
- Priority: P2. Milestone: M3.
- Description: A table of the latest orders with customer, city, status and amount. "View all" opens the Orders page.
- Current app: `recentActivity` widget.
- Mockup: `index.html#dash` "Recent orders": #24117 Abena Owusu Kumasi Delivered GH₵249; #24116 Kwame Mensah Accra Central Out for delivery; #24115 Efua Asante Tema Confirmed; #24114 Yaw Boateng Takoradi Not reachable.
- Acceptance criteria:
  - [ ] The table shows the 4 latest orders by creation time, newest first, with order number (F-113 format), customer name and city, status tag and amount.
  - [ ] The status tag uses the display map (F-113). "Not reachable" is a call outcome, not a status (gap-matrix section 4 row 10, E3): the row for a pending order whose last call was not reachable shows the status "Pending" with a small "Not reachable" note.
  - [ ] Click on a row opens the order drawer on the Orders page.
  - [ ] The list updates on socket event `order:created`.
- Data: none. API: `recentOrders` in F-200.
- Permissions: `orders:view`.
- Edge cases and errors: a deleted (soft) order does not show.
- Tests: component test for each status; integration test for ordering.

### F-208: Top this month
- Priority: P2. Milestone: M6 (needs targets).
- Description: A ranked list of the top 3 people or companies by percent of their role target this month. AI agents appear only under the role they hold (design doc decision 4). The "Leaderboard" button opens the Leaderboard (area 12).
- Current app: `leaderboard` widget.
- Mockup: `index.html#dash` "Top this month": 1 Esi Badu, Delivery, 55% delivery success, 92% of target; 2 Kofi Appiah, 54%, 90%; 3 Adwoa Darko, Call rep, 253 confirmed and delivered, 60% of target.
- Acceptance criteria:
  - [ ] Ranking = percent of role target, across roles, top 3. Ties break by the role's own number.
  - [ ] The sub-line shows the role and its main number (delivery success for delivery; confirmed orders for call reps).
  - [ ] With the fixture the list reads Esi Badu 92%, Kofi Appiah 90%, Adwoa Darko 60%. The Delivery leaderboard in `NUMBERS.md` lists Kwesi at 90% as well as Kofi. Tie rule: the higher closed-order count ranks first (Kofi 152 closed, Kwesi 48 closed), so Kofi is second. GUESS: tie rule; owner to confirm.
  - [ ] A company (3PL) can rank. An AI agent ranks only under its role and shows an "AI agent" tag.
  - [ ] Until M6 the card is hidden.
- Data: reads `Target`, `RoleAssignment` (area 12). API: `top` in F-200.
- Permissions: as F-200.
- Edge cases and errors: fewer than 3 holders with a target: show what exists.
- Tests: unit test for ranking and tie-break on the fixture.

### F-209: Remove "Download report" from the dashboard
- Priority: P3. Milestone: M3.
- Description: The mockup "Download report" button does nothing. Reports exports (CSV and Excel) are in Reports (area 11, decision G8). Remove the button from the dashboard.
- Current app: none.
- Mockup: `index.html#dash` header button (dead).
- Acceptance criteria:
  - [ ] The dashboard header has no "Download report" button.
  - [ ] The header offers a text link "Open Reports" instead (optional; owner can drop it).
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: none.
- Tests: component snapshot.

### F-210: Manager view and finance clerk home
- Priority: P1. Milestone: M3.
- Description: Gap-matrix DB-11 and DB-12 are missing in the mockup. Decision for the build (needs owner check): the manager sees the owner dashboard, with blocks hidden when the manager lacks the permission. The finance clerk does not get a dashboard. Their home is Finance Overview (area 10), which already holds collections, aging and unpaid delivered orders. The old accountant dashboard (Total Collected, Pending Collections, Reconciled Today, Discrepancies, "Pending Reconciliation" table) is removed.
- Current app: `adminConfig` shared by admin, manager and super_admin; `accountantConfig.ts` with fetchers `fetchFinancialMetrics`, `fetchCollectionsTrends`, `fetchPaymentsByStatus`, `fetchRevenueByRegion`, `fetchCashFlowData`, `fetchTopRevenueSources`, `fetchPendingReconciliation` (GUESS: some have no backend endpoint; gap-matrix section 3 row 19).
- Mockup: none (MISSING-IN-MOCKUP).
- Acceptance criteria:
  - [ ] A manager sees the same Dashboard as the owner. The margin chip and the cash tile hide when the manager lacks the margin or `financial:view` permission.
  - [ ] A finance clerk who signs in lands on Finance Overview (F-102). The route `/` for that role redirects there.
  - [ ] `accountantConfig.ts` and its fetchers are deleted (with F-254).
  - [ ] Call-centre numbers for the call-centre manager (queue size, oldest wait, time to first call) are not on this dashboard. They live in Reports (Team tab, area 11) and the Orders queue filter (area 03). Owner to confirm (open question 4).
- Data: none. API: none.
- Permissions: as F-102.
- Edge cases and errors: a user with a custom role and no analytics permission lands on Inbox.
- Tests: E2E for manager and accountant logins.

### F-211: Stock keeper home
- Priority: P1. Milestone: M4.
- Description: Gap-matrix DB-13. The stock keeper's home is Inventory and stock (area 06). It shows stock by location, low stock and the stock gap per location. The old inventory dashboard (Total Products, Low Stock Items, Out of Stock, Inventory Value, Stock Levels by Category, Top Selling Products, Inventory Turnover, Stock Movement, Low Stock table) is removed. The numbers it showed that still matter (low stock) are specified in area 06.
- Current app: `inventoryManagerConfig.ts` with fetchers `fetchInventoryMetrics` and others (GUESS: some may be stubs).
- Mockup: none (MISSING-IN-MOCKUP). `inventory.html` is the replacement.
- Acceptance criteria:
  - [ ] A stock keeper who signs in lands on Inventory and stock.
  - [ ] `inventoryManagerConfig.ts` and its fetchers are deleted (with F-254).
  - [ ] The low-stock list exists on Inventory and stock (area 06). Cross-check at M4.
- Data: none. API: none.
- Permissions: `products:view` or `inventory:view`.
- Edge cases and errors: none.
- Tests: E2E for stock keeper login.

### F-212: Rep and agent homes
- Priority: P1. Milestone: M7 (rep), M10 (agent).
- Description: Gap-matrix DB-14 and DB-15. The call rep's dashboard becomes the rep screen "Today" (area 08). The delivery agent's dashboard becomes the agent app "Home" (area 09). The old `salesRepConfig` and `deliveryAgentConfig` dashboards are removed. This file only sets the redirect and the deletion.
- Current app: `salesRepConfig.ts` (My Earnings, My Pending Orders, My Total Orders, My Conversion Rate); `deliveryAgentConfig.ts` (My Earnings, My Active Deliveries, My Completed Deliveries, My Success Rate); the same `DynamicDashboard` serves `/m/` for agents.
- Mockup: `rep.html` Today; `agent.html` Home.
- Acceptance criteria:
  - [ ] `/` for `sales_rep` redirects to `/rep`. `/` for `delivery_agent` redirects to `/agent`.
  - [ ] Both old configs are deleted when the new apps ship (M7 and M10). Until then the old dashboards stay for those roles.
  - [ ] "My Conversion Rate" and "My Success Rate" are replaced by named rates: confirmation rate (rep) and delivery success rate (agent).
- Data: none. API: none.
- Permissions: as F-103.
- Edge cases and errors: a user with both roles chooses a home in their profile (GUESS: not needed now; one base role per user today).
- Tests: E2E redirect for both roles.

---

## 3. Requirements: KPI services behind the dashboard

### F-250: KPI service rules and the one revenue definition
- Priority: P0. Milestone: M1.
- Description: Build the KPI service layer with one rule: a number is computed in exactly one place. The dashboard, reports, MCP tools and AI chat all call it (design doc section 4.1 rule 6 and section 5.2 rule 2). Start with revenue. The audit found four revenue definitions (design doc risk 1). Keep one: delivered revenue = the sum of `totalAmount` of delivered orders, dated by delivery date. A paid digital order counts as delivered revenue (decision D8). A free bundled digital item does not.
- Current app: four definitions today. (1) GL account 4010 by journal `entryDate` (dashboard and finance). (2) Sum of `totalAmount` including cancelled (sales trends). (3) Delivered orders windowed by `updatedAt` (profit margins). (4) Line revenue for all statuses (product performance). Files: `backend/src/services/analyticsService.ts`, `financialService.ts`, `glAutomationService.ts`.
- Mockup: all revenue figures (GH₵92k, GH₵1.38M).
- Acceptance criteria:
  - [ ] A `KpiResult` shape exists: `{ name, value, unit, dateBasis, formulaId, from, to, asOf }`. Every KPI function returns it.
  - [ ] `kpi.revenue({ from, to })` sums `totalAmount` of orders with status `delivered`, or status `digital_delivered` with payment status paid, whose `deliveryDate` falls in the range. Cancelled, returned and failed orders never count.
  - [ ] A free bundled digital item adds GH₵0 to `totalAmount`, so it adds 0 to revenue. A test covers an order with a physical set and a free guide.
  - [ ] For a digital order, `deliveryDate` is the time the file link was issued (after payment settles). GUESS: check `paystackSettlementService.ts` to see which field is set at settlement. If `deliveryDate` is not set, set it there.
  - [ ] These endpoints and tools return the same revenue for the same range: dashboard, `/api/analytics/*`, financial summary, profit margins, product performance (revenue column), MCP `orders_summary`, `analytics_daily`, `analytics_weekly`, `analytics_monthly`, `financial_summary`. A contract test calls all of them on the fixture and expects GH₵92,000.00 for 1 to 17 October 2026.
  - [ ] The old definitions are removed from the code (not left behind a flag).
  - [ ] A nightly check compares KPI revenue with GL 4010 per day and opens a Finding when they differ (the check itself lives in area 10; this file only requires that revenue's date basis be `deliveryDate` so the two can match).
  - [ ] GUESS to check before M1 ends: GL 4010 posts with `entryDate` equal to the posting time, not `deliveryDate` (design doc 5.4). Read `glAutomationService.ts` and the delivery posting path.
- Data: no new fields. `Order.deliveryDate` is the revenue date. API: `GET /api/kpi/revenue?from&to` (internal); the other endpoints call the service.
- Permissions: `analytics:view`.
- Edge cases and errors:
  - A backdated delivery (MCP `orders_update_status` with `deliveryDate`): revenue lands in the backdated day.
  - A delivered order later set to returned: revenue for that order leaves the delivery day. The service always recomputes from current order status. The ledger reversal is in area 03 and area 10.
  - Orders are taken in the store currency. If the store currency changes (O6), figures convert with the rate of each order's date (PRD section 5.7).
- Tests:
  - Unit: revenue on a small fixed data set with each status.
  - Contract: all endpoints agree on the fixture.
  - Integration: two-tenant.

### F-251: The three named rates
- Priority: P0. Milestone: M1.
- Description: Replace the mixed "delivery rate" with the three named rates. Each rate has one formula and one date basis. The old "26%" (delivered ÷ all orders including in-flight) is removed as a KPI.
- Current app: `analyticsService.ts` lines 86 to 88 and 241: numerator by `deliveryDate`, denominator by `createdAt`. Dashboard label "Delivery Rate". MCP `orders_summary` returns a "fulfilment rate".
- Mockup: dashboard tiles; `NUMBERS.md` decision A.
- Acceptance criteria:
  - [ ] Confirmation rate = confirmed ÷ orders placed, by order date. Target 70%. "Confirmed" means the order reached `confirmed` or a later live status, so confirmed = placed − pending confirmation − cancelled. Fixture: 1,445 − 64 − 355 = 1,026; 1,026 ÷ 1,445 = 71%.
  - [ ] Delivery success rate = delivered ÷ (delivered + failed + returned), closed orders only. Two labelled bases: "by order date (cohort)" and "by delivery date". Target 60%. Fixture: 376 ÷ (376 + 354 + 48) = 376 ÷ 778 = 48%.
  - [ ] Order-to-cash yield = confirmation rate × delivery success rate, on the same order cohort. Fixture: 0.71 × 0.48 = 34%. Design doc literal formula ("delivered ÷ orders placed on closed cohorts") gives the same number only when every order in the cohort is closed. In October, 148 orders are still out for delivery, so delivered ÷ placed would show 26%, which is the removed number. Use the product.
  - [ ] The API never returns a field named `deliveryRate`, `fulfilmentRate` or `conversionRate`. MCP tools use the new names (area 13).
  - [ ] "Conversion rate" and "confirmed per call %" are removed.
  - [ ] Per-partner and per-rep versions use the same function with a filter.
  - [ ] Rates return `n/a` (null) when the denominator is 0.
- Data: needs `Order.confirmedAt` (area 03, M1 backfill). If `confirmedAt` is not yet backfilled, derive "confirmed" from `OrderHistory` status changes; GUESS: check history rows suffice (design doc open check 11). API: `GET /api/kpi/rates?from&to&basis=cohort|delivery&partnerId&repId`.
- Permissions: `analytics:view`.
- Edge cases and errors:
  - An order that was confirmed and later cancelled counts as cancelled, not confirmed (this matches `NUMBERS.md`, where confirmed 1,026 = waiting 100 + dispatched 926). GUESS: owner to confirm; the effect is a lower confirmation rate than counting the moment of confirmation.
  - Digital orders (`payment_pending`, `payment_failed`, `digital_delivered`) have no call and no delivery. They stay out of the confirmation rate and the delivery success rate. They count in revenue (F-250). GUESS: check the fixture has none, or the rates need a digital filter.
  - Cohort not yet closed: show the rate with a "provisional" tag when more than 5% of the cohort's confirmed orders are still open (GUESS: threshold).
- Tests: unit tests on the fixture for the three values; edge tests for zero denominators; a grep test for forbidden field names (F-112).

### F-252: Rep success-rate fix
- Priority: P0. Milestone: M1.
- Description: Fix the rep success-rate bug. Today the number counts only delivered orders with `commissionPaid = false`, so it falls after a payout. Count delivered orders by status, whatever the pay state.
- Current app: `backend/src/services/repPerformanceService.ts` lines 110 to 117. Gap-matrix section 3 row 16.
- Mockup: `NUMBERS.md` call reps table: Adwoa "Delivered from confirmed" 52%, Confirm agent 44%, Nana 30%.
- Acceptance criteria:
  - [ ] Delivered from confirmed, per rep = delivered ÷ closed orders (delivered + failed + returned) among the orders that rep confirmed. Fixture: Adwoa 253 ÷ 486 = 52%; Confirm agent 110 ÷ 249 = 44%; Nana 13 ÷ 43 = 30%; All 376 ÷ 778 = 48%.
  - [ ] The number does not change after a commission payout. A test pays out then re-reads.
  - [ ] Conflict noted: design doc section 4.4 writes the formula as "delivered ÷ confirmed", but the `NUMBERS.md` data (253 delivered, 486 closed, 52%) uses closed orders. The build follows `NUMBERS.md`. If the formula were delivered ÷ confirmed, Adwoa would show 253 ÷ 640 = 40%. Owner to confirm (open question 5).
  - [ ] The rep screen and Reports (Team) read this function (areas 08 and 11).
- Data: none. API: `GET /api/kpi/rep-performance?repId&from&to`.
- Permissions: manager and above see all reps; a rep sees own.
- Edge cases and errors: a rep with 0 closed orders shows `n/a`.
- Tests: unit test (before and after payout), fixture test.

### F-253: Pace, projection and orders needed per day
- Priority: P0. Milestone: M1.
- Description: Build the leadership numbers: pace, projection, orders needed per day, target attainment, and the delivery-success lever. They read the `Target` model (area 12).
- Current app: none.
- Mockup: dashboard ladder and drivers; North Star setup tiles ("Orders a day you need" shows 58 in the mockup; the build shows 56 for October, decision R2).
- Acceptance criteria:
  - [ ] Pace marker = days gone ÷ days in period (year, quarter, month).
  - [ ] Projected month = revenue so far ÷ days gone × days in month. Projected percent = projected ÷ month target.
  - [ ] Needed per day = (month target − revenue so far) ÷ days left after today.
  - [ ] Orders needed per day = month revenue target ÷ planned AOV ÷ (confirmation target × success target) ÷ days in month. With 180,000 ÷ 249 = 723 delivered; 723 ÷ (0.70 × 0.60) = 1,721 orders; ÷ 31 days in October = 55.5, shown 56. RESOLVED (decision R2): every screen, the setup screen too, divides by the real number of days in that month (31 for October, 30 for September, 28 or 29 for February). The mockup and `NUMBERS.md` value 58 (a flat 30-day divisor) is illustration only (R1).
  - [ ] Planned AOV default = AOV of the last 30 days of actual orders; the owner can edit it (decision S2). AOV is computed as delivered revenue ÷ delivered orders. Fixture: GH₵245.
  - [ ] Target attainment = actual ÷ target per role and per person, by delivery date (rep targets by confirmed orders that get delivered, counted at month close, P7).
  - [ ] Biggest lever (F-205) is a function here: `kpi.lever()`.
  - [ ] All functions return `KpiResult` with date basis.
- Data: reads `Target`. API: `GET /api/kpi/leadership?asOf`.
- Permissions: `analytics:view`.
- Edge cases and errors: leap year, month-end, February (28 days): use real calendar counts for pace; use 30 for the planning divisor only.
- Tests: unit tests on the fixture (56, 6.3k, 93% projection, lever 22.9k); calendar edge tests.

### F-254: Retire duplicate and dead analytics
- Priority: P1. Milestone: M1 (services), M3 (frontend deletions).
- Description: Remove code that the KPI services replace, so no second definition survives. Delete the stub dashboard fetchers. Fix or drop `getCustomerInsights.activeCustomers`, which only repeats the total.
- Current app: `analyticsService.ts` (`getCustomerInsights`, time-series methods with no caller), MCP analytics tools with their own queries, `config/dashboards/accountantConfig.ts`, `inventoryManagerConfig.ts`, and their fetcher files. Gap-matrix section 3 rows 18, 19 and 22 (analytics part).
- Mockup: none.
- Acceptance criteria:
  - [ ] No analytics function remains that computes revenue or a rate outside the KPI services (a grep test lists allowed files).
  - [ ] `activeCustomers` is removed from the API and the UI (drop with RP-15 in area 11).
  - [ ] The unused analytics time-series methods are deleted.
  - [ ] Every old `/api/analytics/*` route is either rebuilt on the KPI services (and listed in this file's tests) or deleted. The list of kept routes is in the pull request.
  - [ ] The build, lint and tests pass.
- Data: none. API: routes removed or rebuilt as above.
- Permissions: not applicable.
- Edge cases and errors: the `cod-admin` MCP server (used outside the app) calls `analytics_*` tools; keep their names (area 13 rebuilds them).
- Tests: build and test pass; grep test.

---

## 4. Cross-area dependencies

| This file needs | From | F-ID or area |
|---|---|---|
| `Target` model, North Star setup, planned AOV, `failed_delivery_calls_per_day` target, operating hours, time zone | Area 12 | F-1100 range, F-1200 range |
| Net margin KPI, cash held by partner, days-to-pay, unpaid delivered by age | Area 10 | F-900 range |
| `Order.confirmedAt`, `firstContactAt`, order number format, status display map | Area 03 | F-300 range |
| Order drawer for recent orders | Area 03 | F-300 range |
| Rep performance consumers | Areas 08, 11 | F-750, F-1050 ranges |
| Suggestion cards and `/api/suggestions` | Area 13 | F-1313, F-1314 |
| Leaderboard page | Area 12 | F-1100 range |
| Shell, role home, wording guard, fixture | Area 01 | F-102, F-112, F-114 |

---

## 5. Coverage table

### 5.1 Feature matrix 1.2 (15 rows)
| Row | Covered by |
|---|---|
| DB-01 Owner dashboard | F-200 |
| DB-02 Date range and refresh | F-201 |
| DB-03 Target ladder | F-202 |
| DB-04 Today's targets | F-203 |
| DB-05 Driver tiles | F-204 |
| DB-06 Delivered revenue vs target chart | F-205 |
| DB-07 Agent suggestion cards | F-206 (slot); cards in F-1313 and F-1314 |
| DB-08 Recent orders | F-207 |
| DB-09 Top this month | F-208 |
| DB-10 Download report | DROP: use Reports export (F-209 removes the button) |
| DB-11 Manager dashboard | F-210 |
| DB-12 Accountant dashboard | F-210 (home is Finance Overview) |
| DB-13 Inventory manager dashboard | F-211 |
| DB-14 Sales rep dashboard | F-212 |
| DB-15 Delivery agent dashboard | F-212 |

Count: 15 rows in the matrix 1.2 (DB-01 to DB-15). Covered: 15 (1 marked DROP).

### 5.2 Gap-matrix section 3 rows taken by this file
| Row | Item | Covered by |
|---|---|---|
| 16 | Rep success rate counts only commission-unpaid orders | F-252 |
| 17 | Delivery rate mixes cohorts; four revenue definitions | F-250, F-251 |
| 18 | `getCustomerInsights.activeCustomers` duplicates total | F-254 |
| 19 | Accountant and inventory dashboards use stub fetchers | F-210, F-211, F-254 |
| 22 | Dead service methods | F-254 (analytics time series only). Other methods: owners of each area. |

### 5.3 Gap-matrix section 4 rows taken by this file
| Row | Item | Covered by |
|---|---|---|
| 20 | Dashboard quest "Failed delivery calls" has no setting | F-203 (area 12 holds the target setting) |
| 25 | Dead buttons: "This month", Download report | F-201, F-209 |
| 1 | Airtime | not in the dashboard; F-112 guard |
| 19 | One text source for agent drawer | area 13 |

### 5.4 Totals
Feature rows covered: 15 of 15. Section 3 rows: 5 (16, 17, 18, 19, 22 part). Section 4 rows: 2 (20, 25 part). F-IDs written: 18 (F-200 to F-212 is 13; F-250 to F-254 is 5).

---

## 6. Open questions for the owner (this file)

| # | Question | Default used in this PRD |
|---|---|---|
| 1 | The year pace uses straight days (79.5% on 17 October), so the year shows "3 pts behind". The stepped plan (quarters that grow) would show the year ahead by about GH₵23k. Which do you want? | Straight days, as the mockup shows. |
| 2 | Which quest decides an "on target day" in "14 of 17 days"? | The New orders quest. |
| 3 | Projected October: the formula gives GH₵167.8k (93%); the mockup shows GH₵164k (91%). The lever formula gives GH₵22.9k; the mockup shows GH₵22k. | RESOLVED (R1): follow the written formulas. |
| 4 | Should the call-centre manager have a call-queue strip on the dashboard? | No. Queue numbers live in Reports (Team) and the Orders queue filter. |
| 5 | "Delivered from confirmed" for a rep: delivered ÷ closed (matches `NUMBERS.md`) or delivered ÷ confirmed (design doc text)? | RESOLVED (R3): delivered ÷ closed confirmed orders. |
| 6 | Orders needed per day: divide by 30 (58) or by days in the month (56 in October)? | RESOLVED (R2): days in the month; October shows 56. |
