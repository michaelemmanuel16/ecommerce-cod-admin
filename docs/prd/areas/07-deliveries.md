# Area 07: Deliveries

Part of the CodAdmin rebuild PRD. Builder B2. Date: 2026-10-18.
Range: F-700 to F-749.

Terms:
- Partner: a delivery agent (a person) or a 3PL (a company). Both hold the Delivery role and share one list.
- Delivery fee: what we pay whoever delivers an order (a 3PL or an own agent) for each outcome. One fee rule per partner sets it, in Settings (decisions F1, F2). The partner keeps the fee from the cash it collects and hands in the rest (F4). There is no second pay amount for agents (Removed (decision F1)).
- Closed order: an order that ended as delivered, failed or returned.
- Delivery success rate: delivered ÷ (delivered + failed + returned), closed orders only. Target 60%.
- GUESS: the source did not prove the statement. The text says how to check it.

---

## 1. Scope

This file covers gap-matrix section 1.9 Deliveries (DL-01 to DL-16), the §3 and §4 rows that touch partners, and the Settings rows for fee rules and days to pay. Mockup: `deliveries.html`.

Roles:
- Owner (`super_admin`) and `admin`: all actions.
- `manager`: view, assign, move orders.
- Finance clerk (`accountant`): view, cash held and days to pay.
- Stock keeper (`inventory_manager`): view; sees returns.
- Call rep and delivery agent: no access. Agents use the app (file 09).

Decisions that apply: D3 and O4 (assign by region is a Workflow with a "Region is X" condition and an "Assign to" action; there is no coverage grid; G7 and P8 are replaced), O1 (agents run partner syncs outside the app; the app has one generic "record partner payout" action and no Logiswift-specific code; fee rules live in settings), F1 to F4 (one delivery fee per partner, booked once, kept from collected cash), G10 (cards never change data), round-2 rule: no sync status or sync controls anywhere in the UI.

Partner payout matching (settlements, auto-reconcile, deposit, fee expense in the ledger) belongs to the F-900 range (Builder C). This file computes the delivery fee and the cash held (collected minus fees, decision F4). F-900 matches the money.

Regions come from the store's country (country-state-city data, decision O3). Every screen that asks for a region uses the same list. The sample store (Manny Dynamics, Ghana) uses the Ghana regions, for example Greater Accra, Ashanti, Western and Central.

---

## 2. Requirements

### F-700: Delivery partners list
- Priority: P1. Milestone: M4.
- Description: One table lists agents and 3PLs together. It replaces `DeliveryAgents.tsx`, which lists agents only. Each row is a partner with its numbers for the period. Tabs filter by type.
- Current app: `frontend/src/pages/DeliveryAgents.tsx` (`/delivery-agents`), `GET /api/admin/users?role=delivery_agent`, `GET /api/users/agents/performance`.
- Mockup: `deliveries.html` (table "Delivery partners").
- Acceptance criteria:
  - [ ] Columns: Partner (initials, name, type tag Agent or 3PL, trial tag), Assigned, Delivered, Failed or returned, Out now, Delivery success (bar, target 60%), Confirmed to dispatched, Dispatched to delivered, Cash held, Oldest unpaid, Delivery fee rule, Data source. A total row closes the table.
  - [ ] Tabs: All partners, Agents, 3PLs. They filter the table and show counts (5, 3, 2 in the sample). The mockup tabs only highlight (fix #25). They must filter.
  - [ ] Sample values must hold (NUMBERS.md): Logiswift 590 / 220 / 270 / 100 / 45%; Kofi Appiah 172 / 82 / 70 / 20 / 54%; Esi Badu 102 / 48 / 40 / 14 / 55%; Kwesi Amoah 54 / 26 / 22 / 6 / 54%; Kasapa Express 8 / 0 / 0 / 8 / "No closed orders yet"; total 926 / 376 / 402 / 148 / 48%.
  - [ ] "Assigned" means orders of the period that were dispatched to the partner (reached `out_for_delivery` at least once). Orders still waiting to dispatch are not in it (F-715).
  - [ ] The partner's base town shows in small text under the name. Towns are towns, not regions (fix #24). There is no Coverage column (decision O4).
  - [ ] "Data source" shows App, Connector or CSV (F-712). GUESS: the mockup shows CSV upload for the three agents, but they use the agent app. Check with the owner how their data arrives. Default for a person with a login is App.
  - [ ] Delivered, Failed or returned and Out now sum to Assigned for each row.
  - [ ] Row click opens the partner drawer (F-707).
  - [ ] Delivered counts here equal Staff delivered counts (Kofi 82, Esi 48, Kwesi 26) by using one service.
  - [ ] The period is set by the date range (F-710).
- Data: new `DeliveryPartnerProfile` {id, tenantId, userId (unique), daysToPay Int, isTrial Boolean, dataSource enum (`app`, `connector`, `csv`), baseTown String?, createdAt}. `User.kind` (person, company) comes from Builder A/C staff work. The partner type is derived from `kind`.
- API: `GET /api/delivery-partners?from=&to=&type=` returns rows and the total row. It replaces `GET /api/users/agents/performance` for this page.
- Permissions: view for owner, admin, manager, finance clerk, stock keeper.
- Edge cases and errors: a partner with no orders shows zeros and "—". A deactivated partner is hidden unless it has orders in the period (then it shows with an Inactive tag).
- Tests: unit (row sums); integration (one fixture gives the sample table and the total 926 / 376 / 402 / 148); e2e (open page, switch to 3PLs tab).

### F-701: Delivery KPI tiles
- Priority: P1. Milestone: M4.
- Description: Five tiles sit above the table. Each tile has one formula and one date basis.
- Current app: none.
- Mockup: `deliveries.html` (tiles).
- Acceptance criteria:
  - [ ] "Out for delivery now": count of orders in `out_for_delivery`, and the number of partners holding them. Sample 148, 5 partners. Basis: now.
  - [ ] "Waiting to dispatch": count and age of the oldest (F-715). Sample 100, 3 days. Basis: now. Link "Dispatch" opens Orders filtered to these orders.
  - [ ] "Delivered this month": count and delivered revenue. Sample 376, GH₵92k. Basis: delivery date.
  - [ ] "Delivery success": the rate and the gap to the 60% target in points. Sample 48%, 12 points below. Basis: closed orders of the period's order cohort. The tile states the basis.
  - [ ] "Cash still with agents and 3PLs": sum of cash held (F-704) and the number of orders unpaid over 8 days. Sample GH₵23.4k, 38 orders over 8 days. Link "Chase" opens Finance (Builder C).
  - [ ] The tile text uses only the named rates: "delivery success rate" (or "delivery success" in a tile title).
  - [ ] "Behind pace" under delivered revenue comes from the KPI service (Builder A/C), not from text typed in the page.
- Data: none.
- API: `GET /api/delivery-partners/summary?from=&to=`.
- Permissions: same as F-700.
- Edge cases and errors: no closed orders gives "—", not 0%.
- Tests: unit (each tile); integration (tiles equal the KPI service values).

### F-702: Delivery success rate and timings per partner
- Priority: P0. Milestone: M1 (formula), M4 (page).
- Description: The delivery success rate counts closed orders only. The old "26%" (delivered ÷ all orders including in-flight) is removed. Each partner gets the rate and two median timings.
- Current app: `analyticsService.ts` lines 86 to 88 and 241 mix cohorts (audit risk 2). `GET /api/users/agents/performance` shows month-to-date success against assigned.
- Mockup: `deliveries.html` (columns Delivery success, Confirmed to dispatched, Dispatched to delivered).
- Acceptance criteria:
  - [ ] Rate = delivered ÷ (delivered + failed + returned) for orders of the period assigned to the partner. Orders still out are not in the denominator.
  - [ ] The partner table is an order cohort: orders placed in the period. The label says "October orders" (or the chosen range). The delivered revenue tile is by delivery date. Each shows its basis.
  - [ ] Confirmed to dispatched = median days from `confirmedAt` to `dispatchedAt` per partner. Dispatched to delivered = median days from `dispatchedAt` to `deliveryDate`. Sample Logiswift 1.4 and 3.8 days; Kofi 0.6 and 1.2; Esi 0.7 and 1.5; Kwesi 0.9 and 1.9; Kasapa 1.0 and "—".
  - [ ] Failed and returned are separate counts in tooltips: failed 354 and returned 48 in total (fix #30). The column shows their sum, labelled "Failed or returned".
  - [ ] A partner with 0 closed orders shows "No closed orders yet" (Kasapa Express).
  - [ ] Bar colour: at or above 60% good; 50 to 59% warning; under 50% bad. (GUESS: the bands; check with the owner.)
  - [ ] The same function feeds Reports, the leaderboard (Builder C, attainment = rate ÷ 60%: Esi 92%, Kofi 90%, Kwesi 90%, Logiswift 75%) and the MCP tools.
- Data: `Order.confirmedAt`, `Order.dispatchedAt` (design §5.3; backfill from `OrderHistory`; GUESS: history may be enough, check count).
- API: part of F-700 and F-701.
- Permissions: as F-700.
- Edge cases and errors: an order reassigned between partners counts for the partner that held it when it closed. An order that is rescheduled and later delivered counts once, as delivered.
- Tests: unit (rate, median with even and odd counts, zero closed); integration (sample fixture gives 45%, 54%, 55%, 54%, 48%).

### F-703: Delivery fee rule per partner
- Priority: P0. Milestone: M5.
- Description: Each partner (3PL company or own agent) has one delivery fee rule (decision F2). It says what we pay for each outcome: delivered, failed, returned. The rule lives in Settings, not in code. The fee is stored on each closed order and booked once as a delivery fee expense (decision F3, F-936). The partner keeps the fee from the cash it collects (F4). For any partner, the Charge column of a recorded payout later replaces the fee from the rule (F-900 range).
- Current app: `GL_DEFAULTS` in `config/glAccounts.ts` (failed-delivery fee 50.00, return fee 0); `Tenant.defaultDeliveryFee` is never read. No screen.
- Mockup: `deliveries.html` (column "Delivery fee rule"). The edit screen is not shown. Build it in the partner drawer (F-707).
- Acceptance criteria:
  - [ ] A rule has: partner, outcome, basis (flat amount or percent of order total), amount, valid from. Rules are versioned. A new rule closes the old one on its valid-from date.
  - [ ] Sample rules (store currency GH₵): Logiswift delivered 35, failed 0, returned 0. Kofi Appiah delivered 25 (the fee rule, decision F2), failed 5 (fuel), returned 0. Esi Badu delivered 25, failed 0, returned 0. Kwesi Amoah delivered 30, failed 5, returned 0. Kasapa Express delivered 30, failed 0, returned 0. (The mockup does not state returned fees; 0 is the old default. GUESS: check.)
  - [ ] The table shows the rule as a sentence: "GH₵35 per delivered, no charge on failed".
  - [ ] When an order closes, the service stores `Order.deliveryFee` = the rule valid on the close date for the partner and outcome. No rule means fee 0 and the row shows a "No fee rule" tag. The old default of 50 on failed deliveries is removed.
  - [ ] Check on the sample: fees on delivered = 220 × 35 + 82 × 25 + 48 × 25 + 26 × 30 = 11,730. Fees on failed = 70 × 5 + 22 × 5 = 460. Total 12,190, shown as GH₵12,200 in Finance.
  - [ ] Changing a rule never changes fees on orders already closed.
  - [ ] Footnote under the table: "Delivery fee is what the partner keeps from the cash it collects. Expected cash = cash collected minus fees." No old pay-per-delivery wording and no "agent fee" wording appear anywhere (decision F1).
  - [ ] `Tenant.defaultDeliveryFee` is removed from settings and code (§3 #42).
- Data: new `FeeRule` {id, tenantId, partnerUserId, outcome enum (`delivered`, `failed`, `returned`), basis enum (`flat`, `percent`), amount Decimal(19,4), validFrom Date, createdById}. `Order.deliveryFee` Decimal(19,4) and `Order.deliveryFeeSource` enum (`rule`, `settlement`, `manual`).
- API: `GET /api/delivery-partners/:id/fee-rules`, `POST /api/delivery-partners/:id/fee-rules`. Fee stamping happens inside `orderService` when status becomes `delivered`, `failed_delivery` or `returned`.
- Permissions: view for owner, admin, manager, finance clerk; edit for owner and admin.
- Edge cases and errors: percent above 100 rejected. Two rules with the same valid-from for one outcome rejected. Backfill: for October orders already closed, stamp the fee from the current rule (older months stay as booked, D5).
- Tests: unit (rule selection by date; percent basis); integration (closing 220 + 82 + 48 + 26 delivered orders gives 11,730); e2e (edit a rule, close an order, see the fee).

### F-704: Cash held, oldest unpaid and days to pay per partner
- Priority: P1. Milestone: M5.
- Description: The table shows how much cash each partner holds, how old the oldest unpaid delivered order is, and how fast the partner pays. The matching of payments to orders is in F-900.
- Current app: `agentReconciliationService`, `AgentBalance`, `agingService` (buckets 0-1, 2-3, 4-7, 8+ days from `collectionDate`). Aging counts all non-reconciled collections, which inflates it (design risk 10).
- Mockup: `deliveries.html` (Cash held, Oldest unpaid); `finance.html` aging.
- Acceptance criteria:
  - [ ] Cash held = cash collected by the partner on delivered orders − delivery fees the partner keeps (delivered, failed and returned) − cash deposited or settled, now (decision F4). The deposit and the 3PL payout are matched against this net amount. Sample: Logiswift GH₵17,300, Kofi GH₵2,900, Esi GH₵2,100, Kwesi GH₵1,100, Kasapa GH₵0, total GH₵23,400.
  - [ ] Oldest unpaid = days since delivery of the oldest delivered order with no deposit or settlement. Sample Logiswift 18 days, Kofi 3, Esi 4, Kwesi 5, Kasapa "None".
  - [ ] Days to pay is a number on the partner profile (default from Settings → Operations, F-1200 range). A cell turns bad when oldest unpaid is above days to pay.
  - [ ] The partner drawer shows average days to pay = mean of (payment date − delivery date) on reconciled orders. Sample: Logiswift 9.2 days.
  - [ ] Cash held must exclude collections that settlement has reconciled (F-900), so the figure reflects true unpaid orders.
  - [ ] Conflict noted: `agent.html` shows Kofi's oldest cash as 4 days; this page shows 3. Both screens read this one function.
- Data: `DeliveryPartnerProfile.daysToPay`.
- API: part of `GET /api/delivery-partners`.
- Permissions: view for owner, admin, manager, finance clerk.
- Edge cases and errors: negative cash held (deposit above collected) shows in red with a Finding (Builder C).
- Tests: unit (oldest unpaid); integration (fixture gives 23,400).

### F-705: Failed and returned by reason
- Priority: P1. Milestone: M4.
- Description: A card shows why 402 orders closed unsuccessfully. Failed (354) and returned (48) are shown apart (fix #30).
- Current app: Analytics bar chart; failure reason is free text in delivery notes.
- Mockup: `deliveries.html` (card "Failed and returned by reason").
- Acceptance criteria:
  - [ ] Reasons (fixed list): Not reachable, Refused, Wrong address, Rescheduled, Other. Sample: Not reachable 41% (165), Refused 24% (96), Wrong address 21% (84), Rescheduled 14% (57). They sum to 402.
  - [ ] Failed and returned counts show as two small figures: failed 354, returned 48.
  - [ ] The reason is stored on the order when it fails. The agent app writes it from the reason chips (file 09, F-806). Staff and outside agents (through the API or an MCP tool) write it too. Unknown reasons map to Other.
  - [ ] Filter by partner and period. Click a reason to open Orders filtered by it.
  - [ ] The note "Not reachable is the biggest cause. Calling the customer before dispatch is the cheapest fix." is generated from the data only when Not reachable is the largest share.
- Data: `Order.failureReason` enum (`not_reachable`, `refused`, `wrong_address`, `rescheduled`, `other`) nullable. Backfill: GUESS: from `Delivery.notes` and `OrderHistory.notes` where possible; otherwise Other. Check how many rows are free text.
- API: `GET /api/delivery-partners/failure-reasons?from=&to=&partnerId=`.
- Permissions: as F-700.
- Edge cases and errors: a failed order with no reason counts as Other.
- Tests: unit (percent split); integration (fixture sums to 402).

### F-706: Returned units missing
- Priority: P1. Milestone: M4.
- Description: Returns show on the Deliveries page. A 3PL sent back 41 units. We received 36. 5 are missing.
- Current app: none.
- Mockup: `deliveries.html` (note under reasons card).
- Acceptance criteria:
  - [ ] A line in the reasons card and in the partner drawer reads "Logiswift sent back 41 units. We received 36. 5 are missing." with numbers from F-656 (`GET /api/inventory/returns/summary`).
  - [ ] The line links to the return record in Inventory.
  - [ ] Value of missing units = missing × landed cost (5 × GH₵30 = GH₵150).
- Data: none (F-656).
- API: uses F-656.
- Permissions: as F-700.
- Edge cases and errors: 0 missing hides the line.
- Tests: integration (numbers match F-656).

### F-707: Partner drawer and edit partner
- Priority: P1. Milestone: M4.
- Description: Clicking a partner opens a drawer. It holds the settings that belong to the delivery job: fee rules, days to pay, data source, trial flag. Name, phone, pay and login are edited in the Staff person modal (Builder C).
- Current app: `AgentEditModal` (firstName, lastName, email, phone, vehicleType, vehicleId, deliveryRate also saved as `commissionAmount`, location, isActive).
- Mockup: not in mockup for partner settings (Staff has the person modal). Build a right-side drawer in v2 style with tabs.
- Acceptance criteria:
  - [ ] Header: name, type tag, trial tag, buttons "Edit person" (opens the Staff person modal) and a status switch.
  - [ ] Tab Summary: the row figures, average days to pay, cash held, last 10 closed orders.
  - [ ] Tab Orders: orders of the partner with status, date, amount, proof thumbnail (F-711), filter by status.
  - [ ] Tab Fees: fee rules (F-703 edit), days to pay, data source, trial flag.
  - [ ] Tab Stock: the partner's stock location summary with link "Open in Inventory".
  - [ ] Vehicle types follow the Staff person modal: Motorbike, Car, Tricycle, Bicycle, On foot (the current app lists Motorcycle, Bicycle, Van, Truck, Car; map Motorcycle to Motorbike, Van and Truck to Car; GUESS: check existing values).
  - [ ] Save writes an audit row.
- Data: `DeliveryPartnerProfile` (F-700).
- API: `GET /api/delivery-partners/:id`, `PATCH /api/delivery-partners/:id`.
- Permissions: view for owner, admin, manager, finance clerk; edit for owner and admin.
- Edge cases and errors: none new.
- Tests: integration (patch persists; audit row); e2e (open drawer, change days to pay).

### F-708: Add delivery partner
- Priority: P1. Milestone: M4.
- Description: The button "Add delivery partner" creates a person or a company with the Delivery role. It opens the Staff person modal with the Delivery role chosen. After save, the partner drawer opens on Fees so the owner completes setup. Today the create modal is orphaned (`AgentCreateModal`).
- Current app: `AgentCreateModal` (no trigger), `POST /api/admin/users`.
- Mockup: `deliveries.html` (button, dead). Staff person modal exists (`staff.html`).
- Acceptance criteria:
  - [ ] The button opens the Staff person modal in "Delivery" mode with type choice Person or Company.
  - [ ] On save, a `StockLocation` is created (F-650) and a `DeliveryPartnerProfile` with defaults (days to pay from settings, data source App for a person, CSV for a company, or Connector when an outside agent posts for it with an API or MCP key, O7).
  - [ ] The new partner shows in the list with the tag "Setup incomplete" until it has a fee rule. (Coverage is not a setup step; regions are handled by Workflows, decision O4.)
  - [ ] Workflows with an "Assign to" action can pick the new partner as soon as it is available (F-511).
- Data: as F-700.
- API: reuses the Staff invite endpoint (Builder C).
- Permissions: owner and admin.
- Edge cases and errors: duplicate phone or email: show the Staff error.
- Tests: e2e (add a company partner, see the tag, add a fee rule, tag clears).

### F-709: Partner availability
- Priority: P2. Milestone: M4.
- Description: Assignment skips partners who are unavailable. The current app has a toggle. The mockup lacks it.
- Current app: `PATCH /api/users/:id/availability`; `assignmentService` skips inactive, unavailable and blocked agents.
- Mockup: not in mockup. Build a switch "Available for new orders" in the partner row menu and the drawer header.
- Acceptance criteria:
  - [ ] The switch sets `isAvailable`. An unavailable partner shows a tag.
  - [ ] Unavailable and blocked partners are skipped by auto-assign and by every Workflow "Assign to" action (F-511).
  - [ ] An agent can turn their own availability off in the agent app More screen (file 09).
  - [ ] Realtime event `agent:availability_changed` still fires.
- Data: `User.isAvailable` (exists).
- API: `PATCH /api/users/:id/availability` (stays).
- Permissions: owner, admin, manager; the agent for self.
- Edge cases and errors: turning off does not move open orders.
- Tests: integration (skipped in assignment).

### F-710: Date range on the list
- Priority: P2. Milestone: M4.
- Description: The page needs a date range like the current page.
- Current app: `DateRangePicker` on `DeliveryAgents.tsx`.
- Mockup: not in mockup (the header text says "October · 1 to 17 Oct"). Build the shared date range control in the page header.
- Acceptance criteria:
  - [ ] Presets: This month, Last month, Last 7 days, Custom. Default This month.
  - [ ] The range applies to the table, the tiles that use a period and the reasons card.
  - [ ] The selected range shows in the card headers.
- Data: none. API: `from` and `to` on F-700 routes.
- Permissions: as F-700.
- Edge cases and errors: from after to is rejected.
- Tests: unit (range parsing); e2e (change range, numbers change).

### F-711: Delivery proof in the admin view
- Priority: P2. Milestone: M4.
- Description: The app stores proof (photo, signature, OTP, recipient name, time). Admins cannot see it. They need it to settle disputes.
- Current app: `Delivery.proofType`, `proofImageUrl`, `proofData`, `recipientName`; `PATCH /api/deliveries/:id/proof`.
- Mockup: not in mockup. Build: a proof thumbnail on rows of the partner drawer Orders tab, and a "Delivery proof" block in the order drawer (Builder B1 hosts it).
- Acceptance criteria:
  - [ ] The block shows recipient name, time, cash collected, and the photo (click to enlarge).
  - [ ] An order with no proof shows "No proof recorded".
  - [ ] Photos load over a signed URL that expires.
- Data: none new.
- API: `GET /api/deliveries/by-order/:orderId` returns proof for admin roles.
- Permissions: owner, admin, manager, finance clerk.
- Edge cases and errors: broken image shows a placeholder.
- Tests: integration (role check); e2e (open proof).

### F-712: Upload CSV for a partner
- Priority: P2. Milestone: M5.
- Description: "Upload CSV" lets the owner apply a partner's status list when no connector or app feed exists. It is the CSV connector for partners (DL-14, CN-07).
- Current app: none.
- Mockup: `deliveries.html` (button, dead). Build a modal: choose partner, drop file, preview, confirm.
- Acceptance criteria:
  - [ ] Columns (GUESS: check with the owner's partner sheets): order number, status (delivered, failed, returned), date, reason, cash collected.
  - [ ] Preview shows matched rows, unmatched rows and rows that would be rejected, before anything is saved.
  - [ ] Confirm applies each row through the order status service (never a raw write). Fees, stock and ledger follow the normal path.
  - [ ] Limits: 2,000 rows and 10 MB.
  - [ ] Importing twice changes nothing the second time (idempotent per order and status).
  - [ ] A report lists applied, skipped and failed rows, with a CSV download of failures.
- Data: none new.
- API: `POST /api/delivery-partners/:id/csv/preview`, `POST /api/delivery-partners/:id/csv/apply`.
- Permissions: owner, admin, manager.
- Edge cases and errors: a row for an order assigned to another partner is flagged, not applied.
- Tests: unit (parser); integration (idempotent apply); e2e (upload, preview, confirm).

### F-713: Delivery attempts history
- Priority: P2. Milestone: M4.
- Description: Each order keeps a history of attempts with date, reason and note. The agent app shows it. The partner drawer shows it too.
- Current app: `Delivery.deliveryAttempts` and notes; mobile detail "Delivery Attempts".
- Mockup: `agent.html` (Past attempts).
- Acceptance criteria:
  - [ ] Each failed or rescheduled attempt writes one attempt row: date, reason, note, actor.
  - [ ] The partner drawer Orders tab shows attempt count per order and opens the list.
  - [ ] The agent app shows the same list (file 09, F-803).
- Data: new `DeliveryAttempt` {id, tenantId, orderId, partnerUserId, attemptedAt, reason enum (F-705), note}. `Delivery.deliveryAttempts` becomes a count kept in sync.
- API: `GET /api/deliveries/by-order/:orderId` includes attempts.
- Permissions: partner sees own; admin roles see all.
- Edge cases and errors: none new.
- Tests: integration (a failed then delivered order shows two attempts).

### F-714: Removed (O4): partner coverage grid
- Status: REMOVED by decision O4 (replaces G7 and P8). Do not build.
- What replaces it: "Assign by region" is a Workflow (file 05, F-511). The owner sets the condition "Region is X" (workflow conditions already include Region and Country) and the action "Assign to" one or more delivery agents or partners, split Evenly or Weighted. Many agents can serve one region. If no Workflow matches, the order stays unassigned for the fulfilment lead.
- Removed with it: the coverage grid on Deliveries, the Coverage column, `PartnerCoverage`, `DeliveryPartnerProfile.isFallback`, the priority order, the fallback partner, `GET/PUT /api/delivery-partners/coverage`, `GET /api/delivery-partners/resolve`, and the "Setup incomplete needs a covered region" rule.
- Kept from the old text: an order's region is normalised to a value of the store's country list at order creation (checkout form region list, New order, imports map common spellings, for example "Greater Accra Region"). An unmapped value goes to a review list; it is not guessed. Towns and areas (for example Accra Central) are used only for reports (labelled as towns). This rule is built in M4-T19 under F-707 to F-709.

### F-715: Waiting to dispatch and out for delivery
- Priority: P1. Milestone: M4.
- Description: Two live counts drive fulfilment: orders confirmed but not dispatched, and orders out now.
- Current app: none (orders have statuses only).
- Mockup: `deliveries.html` (tiles).
- Acceptance criteria:
  - [ ] Waiting to dispatch = orders in `confirmed`, `preparing` or `ready_for_pickup`. Oldest age = now − `confirmedAt`. Sample 100 orders, oldest 3 days. (NUMBERS.md: confirmed 1,026 = waiting 100 + dispatched 926.)
  - [ ] `dispatchedAt` is set the first time an order enters `out_for_delivery`, by app, connector or staff.
  - [ ] A list "Waiting to dispatch" (modal or Orders filter) shows each order with age, region and the partner that would take it.
  - [ ] Out for delivery now = orders in `out_for_delivery`, grouped by partner (148 across 5).
  - [ ] Waiting orders older than 2 days are marked (GUESS: the limit; the KPI table says "keep oldest short"; check).
- Data: `Order.confirmedAt`, `Order.dispatchedAt` (design §5.3; backfill).
- API: `GET /api/delivery-partners/waiting`.
- Permissions: view for owner, admin, manager.
- Edge cases and errors: an order rescheduled to `ready_for_pickup` counts as waiting again; `dispatchedAt` keeps the first value, and a `lastDispatchedAt` is not added (GUESS: not needed).
- Tests: unit (age); integration (sample fixture gives 100 and 148).

### F-716: Access control on delivery routes
- Priority: P0. Milestone: M0.
- Description: Delivery routes check login only. Any signed-in user can read or complete any delivery. Add role and ownership checks (§3 #29).
- Current app: `GET /api/deliveries`, `GET /:id`, `GET /routes/:agentId`, `PATCH /:id/proof`, `PATCH /:id/complete` in `deliveryController` with `authenticate` only.
- Mockup: n/a.
- Acceptance criteria:
  - [ ] A delivery agent can read, prove and complete only deliveries assigned to them.
  - [ ] Admin roles (owner, admin, manager) can read all. Finance clerk can read. Call reps get 403.
  - [ ] Complete requires the order to be assigned to the caller (or an admin role acting on behalf, audit-logged).
  - [ ] Tests prove a second tenant's delivery returns 404.
- Data: none. API: middleware on the routes above.
- Permissions: as stated.
- Edge cases and errors: 403 with a plain message.
- Tests: integration (agent A cannot complete agent B's delivery; cross-tenant).

### F-717: Deliveries suggestion cards
- Priority: P3. Milestone: M11.
- Description: One to three cards find real problems on the page. They open a pre-filled screen. They never change data (G10, fix #19, fix #25).
- Current app: none.
- Mockup: `deliveries.html` (three cards, dead).
- Acceptance criteria:
  - [ ] Card "<Partner> delivery success is X%, below the 60% target": button "Move N orders to <partner>" opens Orders with the filter and the bulk assign dialog pre-filled. A person clicks confirm. (Mockup: "Move 40 Accra orders to Esi Badu".)
  - [ ] Card for a weak area: computed from `deliveryArea` data and labelled as a town. The mockup finding "Accra Central 18%" is not in NUMBERS.md. Show it only if the data produces it. Button "Queue N call-backs" opens the rep queue filter or Orders filter, pre-filled.
  - [ ] Card "<Partner> holds GH₵17.3k, 38 orders over 8 days": button "Send payout reminder" opens the Set reminder popover or a message draft pre-filled. Nothing is sent until a person confirms.
  - [ ] Text numbers come from F-700 and F-704 only. The text source is the one shared with the AI drawer.
  - [ ] Dismiss works.
- Data: none. API: problem finders `cash_gaps_by_partner`, `partner_success_below_target` (design §7.3).
- Permissions: as F-700.
- Edge cases and errors: no problem, no card.
- Tests: unit (text from numbers); e2e (click Move orders, dialog opens pre-filled).

### F-718: Removed (O7): partner key for outside agents
- Status: REMOVED by decision O7 (owner, 2026-10-19). Do not build.
- What replaces it: an outside agent (for example the Logiswift sync, run outside the app per O1) uses the normal API or MCP key with the permissions it needs. Status changes go through the order status tool and the state machine. Payouts go through the one generic "record partner payout" action (F-906) with a key that holds the payout permission.
- Removed with it: the `PartnerConnector` model, key create, rotate and delete under `/api/connections/partners`, the key-header auth and its rate limit, the Connections card for the partner key (CN-14, F-1214), M5-T09 and M5-T33.
- Kept: the app still has no Logiswift-specific code and no sync status or controls (O1). A company partner's data source is CSV, or Connector when an outside agent posts for it (F-712).
- Later: a scoped per-partner key may be added when a third party (a 3PL company, or a SaaS seller's 3PL) needs to call the API.

### F-719: Remove dead delivery service code
- Priority: P3. Milestone: M4.
- Description: The delivery service has methods nothing calls: `markDeliveryFailed`, `createDelivery`, `autoAssignAgent`, `getAgentStats` (§3 #22, delivery part). Remove them. The failed-delivery path goes through the one status service (F-720).
- Current app: `backend/src/services/deliveryService.ts`.
- Mockup: n/a.
- Acceptance criteria:
  - [ ] The four methods are deleted. Builds and tests pass.
  - [ ] `GET /api/deliveries/routes/:agentId` is deleted (DL-16, no UI).
  - [ ] Other dead methods named in §3 #22 (customer merge, tags, notifications, analytics time series) belong to the owners of those areas.
- Data: none. API: route removed.
- Permissions: n/a.
- Edge cases and errors: grep proves no caller.
- Tests: build and full test run.

### F-720: One path to delivered, failed and returned
- Priority: P0. Milestone: M1.
- Description: `PATCH /deliveries/:id/complete` and the order status service both mark an order delivered. The delivery route must call the status service, so fee stamping (F-703), stock (F-657), the cash collection and the ledger run once.
- Current app: `deliveryService.completeDelivery` has its own transaction. A failed delivery posts no ledger entry when set through `failed_delivery` (§3 #11).
- Mockup: n/a.
- Acceptance criteria:
  - [ ] `completeDelivery` records proof and cash, then calls the order status service for `delivered`.
  - [ ] Setting `failed_delivery` stamps the failed fee (F-703) and posts the failed-delivery entry (Builder C ledger).
  - [ ] The status machine rejects invalid moves (rebuilt in M1 by Builder B1, D7).
  - [ ] A second completion changes nothing.
- Data: none. API: `PATCH /api/deliveries/:id/complete` behaviour changes, same shape.
- Permissions: as F-716.
- Edge cases and errors: cash collected differs from COD amount: record both; the difference opens a Finding (Builder C).
- Tests: integration (fee, stock, collection each once).

### F-721: Cost of a refused delivery
- Priority: P2. Milestone: M5.
- Description: The Customers mockup says a refused order costs GH₵40. The fee rules say GH₵0 to GH₵5 (fix #17). The cost is computed: the failed fee of the partner plus the lost units (if returned units are lost) at landed cost.
- Current app: none.
- Mockup: `customers.html` (text card, wrong).
- Acceptance criteria:
  - [ ] One function `refusalCost(order)` = failed fee stamped on the order + units lost × landed cost (units lost only when F-656 shows missing for that return).
  - [ ] Customers (Builder B1, F-350) and the cost of failed deliveries (Builder C) call it.
  - [ ] Sample: Kofi failed 5; Kwesi failed 5; Logiswift 0.
- Data: none. API: service method.
- Permissions: system.
- Edge cases and errors: no fee rule means 0.
- Tests: unit.

---

## 3. Cross-area dependencies

| Need | Where | Used by |
|---|---|---|
| Staff person modal (person or company), `User.kind` (no pay-rate field; the fee rule is in F-703, decision F1) | F-1150 range (Builder C) | F-707, F-708 |
| Settlements, payout matching, fee expense posting, aging, Findings | F-900 range (Builder C) | F-703, F-704 |
| Connections card for CSV upload | F-1200 range (Builder C) | F-712 |
| Settings → Operations default days to pay | F-1200 range (Builder C) | F-704 |
| Order status service, state machine (D7), `confirmedAt`, `dispatchedAt` | F-300 range (Builder B1) | F-702, F-715, F-720 |
| "Assign to" action with Evenly or Weighted, "Region is X" condition (decision O4) | F-500 range (Builder B1, workflows) | F-708, F-709 |
| Region list on checkout forms, order forms (from the store country) | F-300 and F-400 ranges (Builder B1) | F-708 |
| Customers refusal rule (G6), customer cost text | F-350 range (Builder B1) | F-721 |
| Stock locations, counts, returns | F-650, F-653, F-656 in `06-products-stock.md` | F-706 |
| Agent app failed reasons and proof | F-805, F-806 in `09-agent-app.md` | F-705, F-711 |
| Suggestion cards host, problem finders | F-1300 range (Builder A) | F-717 |
| Delivery leaderboard and rewards | F-1100 range (Builder C) | F-702 |

---

## 4. Coverage table

### 4.1 Section 1.9 Deliveries (16 rows)

| Matrix row | Covered by |
|---|---|
| DL-01 Partner list (agents and 3PLs) | F-700 |
| DL-02 KPI tiles | F-701 |
| DL-03 Performance columns | F-700, F-702 |
| DL-04 Fee rule per partner | F-703 |
| DL-05 Days to pay, oldest unpaid | F-704 |
| DL-06 Data source | F-700 |
| DL-07 Failed and returned by reason | F-705 |
| DL-08 Returns missing units | F-706 (data: F-656) |
| DL-09 Edit agent | F-707 |
| DL-10 Add delivery partner | F-708 |
| DL-11 Agent availability toggle | F-709 |
| DL-12 Date range on list | F-710 |
| DL-13 Admin view of delivery proof | F-711 |
| DL-14 Upload CSV | F-712 |
| DL-15 Delivery attempts history | F-713 |
| DL-16 Route lookup | DROP: matrix verdict DROP (no UI); the endpoint is removed in F-719 |

### 4.2 Related rows

| Row | Covered by |
|---|---|
| §3 #22 Dead service methods (delivery part) | F-719 (other parts belong to other areas) |
| §3 #29 Delivery routes have no role or ownership check | F-716 |
| §3 #42 `Tenant.defaultDeliveryFee` never read | F-703 |
| §3 #11 Failed delivery GL entry not posted (delivery fee side) | F-720 (ledger posting: F-900 range) |
| §4 #17 Customers card says GH₵40 per refused order | F-721 |
| §4 #19 Drawer text differs by page; Accra Central 18% | F-717 |
| §4 #24 Region lists use 6 or 7 regions | F-708 (region normalisation); F-714 removed (O4) |
| §4 #25 Dead buttons (Upload CSV, Add delivery partner, partner tabs, card buttons) | F-700, F-708, F-712, F-717 |
| §4 #30 Reports "Failed 402" counts failed and returned | F-705 (this page shows 354 and 48; Reports: Builder C) |
| §2.7 Fee per outcome per partner | F-703 |
| §2.7 Days to pay per partner | F-704 |
| §2.3 Default days to pay | F-704 (setting: F-1200 range) |
| Design decision 7 Logiswift connector; §8.1 | Replaced by O1; the generic partner key it left (F-718) was removed by O7 |
| Design G7 coverage; D3 By region assign | G7 replaced by O4; By region is a Workflow (F-511); F-714 removed |
| Design §4.5 Waiting to dispatch; confirmed to dispatched; dispatched to delivered | F-715, F-702 |

Counts: matrix section 1.9 has 16 rows. This table covers 16 (15 by an F-ID, 1 DROP). Related rows listed: 15. F-IDs in this file: 22 (F-700 to F-721).

## 5. Open items

1. Data source for the three agents (CSV or App). (F-700)
2. Return fee per partner (0 assumed, now one field of the fee rule, F2; owner enters the real value). (F-703)
3. Removed (O4): the region map for the sample partners is no longer needed.
4. Colour bands for success rate; "waiting too long" limit of 2 days. (F-702, F-715)
5. CSV columns for partner files. (F-712)
6. Removed (O1): the app does not read partner status words.
7. Conflict: Kofi's oldest cash is 4 days in `agent.html` and 3 days here. RESOLVED (decision R1): both screens read one function; the mockup sample is illustration only.
8. Conflict: `DESIGN-SPEC.md` still lists the old 40% delivery target. NUMBERS.md says 60%. RESOLVED (decision R1): use 60%.
9. Resolved by decisions: several agents can serve one region through a Workflow, split Evenly or Weighted (O4, replaces P8); the return fee is a field of the one fee rule (F2).
