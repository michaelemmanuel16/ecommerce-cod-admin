# Area 08: Rep screen (call reps)

Part of the CodAdmin rebuild PRD. Builder B2. Date: 2026-10-18.
Range: F-750 to F-799.

Terms:
- Call rep: a person (or an AI agent holding the Call rep role) who calls customers to confirm orders.
- Confirmation rate: confirmed ÷ orders placed (per rep: confirmed ÷ assigned). Target 70%.
- Delivered from confirmed: delivered ÷ closed orders the rep confirmed (closed = delivered + failed + returned). Sample Adwoa 253 ÷ 486 = 52%.
- Time to first call: median of (first contact − order placed), counted only inside operating hours.
- GUESS: the source did not prove the statement. The text says how to check it.

---

## 1. Scope

This file covers gap-matrix section 1.15 Rep screen (RE-01 to RE-14), the rep success-rate bug (§3 #16), the `Call` model fix (§3 #46), and the mockup fixes that touch `rep.html`. Mockup: `rep.html` (Today, Queue, My orders, Earnings, My numbers, Inbox).

Roles: call rep (`sales_rep`), a person or an AI agent holding the Call rep role. The call-centre manager and the owner see the same data in Orders, Reports and Staff (other files).

Decisions that apply:
- Decision 5 with P6: pay is GH₵8 per order the rep confirms by call that is delivered (auto-confirmed orders earn none), plus 10% of the extra value the rep adds at confirmation, paid on delivery. AI agents are scored under the role and get no payout.
- Decision 6: reps use basic phones. First: auto-confirm by WhatsApp or SMS, a queue timer and time to first call. Android tap-to-call comes later. Fix the rep success-rate bug.
- D6: time to first call target 15 minutes, alert at 30 minutes. G5: the clock runs only inside operating hours, which the owner enters in Settings → Operations (F-1200 range, Builder C).
- D9: cash reward tiers only. Rep: 100% GH₵300; 120% GH₵500 plus a paid day off. No lower tier. No other reward type anywhere.
- G4: a target reward is earned at month close, on delivery-date numbers.
- P7: the rep target counts confirmed orders that get delivered, counted at month close.
- P2, P4: a NO reply to auto-confirm does not cancel (the order goes to the call queue with a "said NO" flag; a rep calls once before any cancel). The auto-confirm message goes out at once, also outside operating hours; only the rep call clock waits for opening time.
- P5: reps reply to customers on WhatsApp from the Conversations page (file 05, F-454).
- R10: time to first call = time to the first rep call attempt, inside operating hours. A customer YES to auto-confirm closes the clock as "auto-confirmed".
- G9: call reps can create orders and add and edit customers. "New order" sits in the Queue.
- G10: suggestion cards never change data.

---

## 2. Requirements

### F-750: Rep shell and navigation
- Priority: P1. Milestone: M7.
- Description: A call rep gets a separate screen, not the admin app. It has five pages and an inbox. It shows a left rail on desktop and bottom tabs on a phone. It replaces the rep dashboard and Earnings History.
- Current app: `DynamicDashboard` (rep config), `Orders`, `EarningsHistory.tsx` (`/earnings-history`), onboarding tour and Help menu (to be dropped, SH-09, SH-10).
- Mockup: `rep.html` (shell).
- Acceptance criteria:
  - [ ] After login, a `sales_rep` lands on `/rep/today`. Rep users cannot open the admin shell routes (403 on the API as today).
  - [ ] Pages: Today, Queue (pill = number of pending orders), My orders, Earnings, My numbers. Inbox opens from the bell in the top bar, not from the rail.
  - [ ] Top bar: dark mode toggle, bell with unread count, avatar menu (Profile, Security, Sign out). "Back to CodAdmin" shows only for roles that may open the admin app (owner, admin, manager).
  - [ ] Rail on desktop. Bottom tab bar on phone width (760 px and below). Active tab is marked.
  - [ ] `EarningsHistory` and its route are removed (ST-17). Rep tour and Help menu are removed (SH-09, SH-10).
  - [ ] Realtime: new orders in the queue and order moved to me appear without reload (existing socket events, tenant-scoped).
  - [ ] Every button works or is removed (fix #25): Search, Open order, Call, WhatsApp, Send WhatsApp, Mark all read, Save, filters.
- Data: none.
- API: `GET /api/rep/me/summary` (tiles, counts, pending pill).
- Permissions: `sales_rep` and AI agents holding the role. Manager and owner may open it with "view as" (read-only, GUESS: not in the mockup; skip if the owner does not want it).
- Edge cases and errors: no orders assigned shows the empty states from the mockup.
- Tests: e2e (login as rep lands on Today; admin routes blocked); component (tab bar at 390 px).

### F-751: Basic phone support
- Priority: P1. Milestone: M7.
- Description: Reps call from basic phones. The app does not place calls. The rep reads the number on screen, dials by hand and logs the result. Tap-to-call on Android comes later (non-goal). The screen must still work on a cheap smartphone browser or a shared desktop.
- Current app: none.
- Mockup: `rep.html` (Call and WhatsApp buttons are links).
- Acceptance criteria:
  - [ ] The customer phone and alternate phone show in large type with a "Copy" button. They are written in the local form (for example 024 123 4567) and in the international form for WhatsApp.
  - [ ] The Call button is a `tel:` link. On a device that cannot dial it still shows the number. No call is placed or timed by the app.
  - [ ] The WhatsApp button opens `wa.me/<number>` with an optional draft text. A rep sends it themselves.
  - [ ] Call length is typed by the rep and optional (seconds or minutes). It is never required to save.
  - [ ] Pages load with no heavy chart library on Queue and Call card (the numbers page may draw small bars with plain CSS).
  - [ ] The text size is 16 px or larger on forms. Touch targets are 44 px or larger.
  - [ ] Pages work on a 360 px wide screen with no horizontal scroll.
  - [ ] No feature needs the camera, location or contacts.
- Data: none.
- API: none.
- Permissions: rep.
- Edge cases and errors: a number in an unknown format shows as typed with a tag "Check number".
- Tests: component (phone formatting both forms); e2e at 360 px.

### F-752: Today page
- Priority: P1. Milestone: M7.
- Description: The home page shows today's progress, the next reward, three numbers and live cards from the queue.
- Current app: rep dashboard config in `DynamicDashboard`.
- Mockup: `rep.html#today`.
- Acceptance criteria:
  - [ ] Hero "Confirmed today": the count of calls saved as Confirmed today (sample 19), an activity count. The hero carries the note "Your target counts confirmed orders that get delivered, at month close." (P7). The count moves when a call is saved as Confirmed.
  - [ ] "Confirmed" counts orders the rep confirmed today (confirmation time inside the day in the business time zone).
  - [ ] KPI tiles: Confirmation rate (confirmed ÷ assigned, target 70%, sample 73%); Delivered from my confirmed (delivered ÷ closed, sample 52%, "253 delivered of 486 closed"); Time to first call (median this month, sample 12 min).
  - [ ] Reward card: F-753.
  - [ ] Suggestion cards: F-770.
  - [ ] The rep sees only their own numbers. Ranks show in My numbers (F-762).
  - [ ] Labels use only the three named rates. The tile name is "Delivered from my confirmed".
- Data: personal monthly target comes from `Target` (Builder C, F-1100 range). If none is set, the "Next reward" card shows the role target (723) and a note.
- API: `GET /api/rep/me/today`.
- Permissions: rep.
- Edge cases and errors: no target set shows "No target set" and hides the bar.
- Tests: unit (daily share); integration (saving a Confirmed call increments today's count).

### F-753: Target reward progress (cash tiers)
- Priority: P1. Milestone: M7.
- Description: A card shows progress to the next cash reward. It reads the tiers from Settings → Rewards (one setting, fix #1). There is no 80% tier.
- Current app: none.
- Mockup: `rep.html#today` (card "Next reward"). The mockup shows an 80% tier line and an inbox row about reaching 80%. Remove both (D9).
- Acceptance criteria:
  - [ ] Tiers shown: 100% GH₵300; 120% GH₵500 plus a paid day off. Values come from Settings → Rewards, not from the page.
  - [ ] The tag reads "N more to GH₵300", where N = target − confirmed orders that get delivered, counted at month close (decision P7; sample 423 − 253 = 170). During the month the tag counts delivered so far and shows "final at month close".
  - [ ] A line says: "The reward is paid after month close." (G4).
  - [ ] AI agents holding the role show no reward card (no payout).
  - [ ] No page, toast or inbox row mentions an 80% reward.
  - [ ] Attainment uses the same function as the leaderboard (Builder C).
- Data: reads `RewardTier`, `Target`.
- API: `GET /api/rep/me/reward`.
- Permissions: rep.
- Edge cases and errors: target reached shows "You reached 100%. Paid after month close." Above 120% shows the top tier.
- Tests: unit (distance); integration (card reads tiers from settings).
- Basis (decision P7): the rep target counts confirmed orders that get delivered, counted at month close, on delivery-date numbers (G4).

### F-754: Queue with wait timer
- Priority: P0. Milestone: M7.
- Description: The Queue lists orders waiting for the rep's call, in three tabs. Each row shows a timer that tells the rep what is urgent.
- Current app: Orders list filtered by status. No timer.
- Mockup: `rep.html#queue`.
- Acceptance criteria:
  - [ ] Header: "Orders waiting for your call. N waiting, oldest H h M min." (live).
  - [ ] Tabs with counts: Pending (orders in `pending_confirmation` assigned to the rep), Call backs (call-back-later calls with a due time), Re-delivery (orders that failed and need a re-call).
  - [ ] Search by name, phone, area or order number.
  - [ ] Pending row timer: "Waiting 2 h 20 min", counted from order placed in operating hours only (F-755). Colour: normal under 15 min; gold from 15 min; coral from 30 min.
  - [ ] Call backs row: "In 25 min" or "Overdue 18 min". Re-delivery row: "Failed 16 Oct".
  - [ ] Order of rows: Pending oldest first; Call backs by due time; Re-delivery by failed date.
  - [ ] Row content: customer name, area, package and add-ons, order value, buttons Call, WhatsApp, Open order.
  - [ ] Empty states: "Queue is clear. New orders appear here as they come in." and "Nothing here. Try another tab."
  - [ ] Unassigned orders (9 in the sample) are not in any rep queue. They show to the manager (Orders, file 03) with a card.
  - [ ] Button "New order" in the header (F-765).
  - [ ] The queue refreshes on socket events and every 60 seconds.
- Data: reads `Order`, `Call` (call-back due time stored on the call row: `Call.callbackAt`, see F-768).
- API: `GET /api/rep/me/queue?tab=&q=`.
- Permissions: rep sees only own assigned orders. Manager and owner see queues through Orders.
- Edge cases and errors: an order reassigned away leaves the queue at once. An order confirmed by auto-confirm (F-764) leaves the queue.
- Tests: unit (timer colour bands); integration (queue contents for a fixture rep); e2e (call back moves an order to the Call backs tab).

### F-755: Operating-hours clock and time to first call
- Priority: P0. Milestone: M1 (timestamps, formula), M7 (screen).
- Description: Time to first call measures speed. The clock runs only inside the operating hours that the owner enters (G5). The auto-confirm message is not held for opening time (P4); only this clock waits. The target is 15 minutes. The alert is at 30 minutes (D6). The same function drives the queue timer, the rep tile, the manager view and the MCP tools.
- Current app: `SystemConfig.operatingHours` (JSON, no UI). No `firstContactAt`.
- Mockup: `rep.html#today`, `#numbers` (12 min), `staff.html` (41 min Nana, 2 min Confirm agent).
- Acceptance criteria:
  - [ ] Function `workingMinutesBetween(start, end, hours, timeZone)` counts only minutes inside operating hours. Days off and hours come from Settings → Operations (Builder C owns the screen; F-1200 range).
  - [ ] An order placed outside hours starts its clock at the next opening time. Example: hours 08:00 to 20:00; an order at 22:30 and a first call at 08:12 next day gives 12 minutes.
  - [ ] `Order.firstContactAt` = the time of the first rep call attempt for the order: the first logged `Call` row by a rep, any outcome (manual or tap-to-call). A customer YES to auto-confirm also closes the clock and the order counts as "auto-confirmed", not as a rep call (decision R10). The auto-confirm message by itself never counts. The per-rep stat uses that rep's own first call attempt.
  - [ ] Time to first call = median of `workingMinutesBetween(createdAt, firstContactAt)` over orders in the period. Samples: Adwoa 12 min, Confirm agent 2 min, Nana 41 min, all 9 min.
  - [ ] Target (15) and alert (30) come from Settings → Operations. An order waiting past the alert raises a notification to the call-centre manager and the owner, once per order.
  - [ ] If no operating hours are set, the clock counts every minute and the page shows "Set operating hours in Settings".
  - [ ] Back-fill: GUESS: `firstContactAt` can be built from `Call` rows. Check how many past orders have no call row; they stay empty and are excluded from the median.
- Data: `Order.firstContactAt` (design §5.3). Settings `operatingHours`, `timeToFirstCallTarget`, `queueWaitAlert`.
- API: `GET /api/rep/stats/time-to-first-call?from=&to=&repId=` (KPI service, Builder A/C range M1).
- Permissions: rep sees own; manager and owner see all.
- Edge cases and errors: daylight saving does not apply in Ghana; use the business time zone setting. First call before order placed (clock error) is clamped to 0.
- Tests: unit (hours across midnight, days off, 22:30 case, median even/odd); integration (alert fires once).

### F-756: Call card
- Priority: P0. Milestone: M7.
- Description: Opening an order shows a call card with everything a rep needs on a call: customer, order, history. On desktop it is a right panel. On a phone it is full screen with a back button.
- Current app: `OrderDetails` page, `LogCallModal`, `CallHistoryModal`.
- Mockup: `rep.html#queue` (call card).
- Acceptance criteria:
  - [ ] Header: name, order id, area, status tag, Order value (live, changes with upsell).
  - [ ] Buttons: Call, WhatsApp, Team notes (opens the Inbox thread for the order).
  - [ ] Customer block: phone, alternate phone, email, address, payment ("Cash on delivery, unpaid"), assigned rep, assigned delivery agent. The rep can edit address and phone on the call (the audit of order edits: Orders, file 03).
  - [ ] Order block: package line, add-on lines, "Cash to collect".
  - [ ] Previous orders: date, amount, Delivered or Failed. If none: "First order from this customer."
  - [ ] Call history: outcome tag, time, rep, note, length.
  - [ ] A re-delivery hint on Re-delivery orders ("Kofi Appiah could not reach him...") from the last attempt reason.
  - [ ] Refusal count and risk tag from the customer record show when above 0 (G6; owned by Customers, file 02).
  - [ ] "How did the call go?" section: F-757.
  - [ ] Saving moves to the next order in the same tab and shows a toast.
  - [ ] Link to the customer detail view (RE-14) opens a read view with all orders of the customer.
- Data: reads `Order`, `Customer`, `Call`.
- API: `GET /api/rep/orders/:id/card`.
- Permissions: rep sees only own assigned orders. Reading another rep's order returns 403.
- Edge cases and errors: order cancelled while open: the card shows the new status and disables the outcome buttons. Two reps open the same order: the second save fails with "Already handled".
- Tests: integration (403 for other rep's order); e2e (open, call card shows history).

### F-757: Call outcomes
- Priority: P0. Milestone: M7.
- Description: The rep picks one of five outcomes. Each outcome has a fixed effect on the order. The `CallOutcome` enum changes.
- Current app: `CallOutcome` = confirmed, rescheduled, no_answer, cancelled, other. `POST /api/calls`.
- Mockup: `rep.html#queue` ("How did the call go?").
- Acceptance criteria:
  - [ ] Outcomes and effects:
    - Confirmed: order to `confirmed`; sets `confirmedAt`, `confirmedById` and starts commission (F-769). Optional "Change the order" (F-759).
    - Not reachable: logs the attempt. Order stays `pending_confirmation` and stays in the queue. It is a call outcome, not an order status (fix #10, E3).
    - Call back later: chips In 30 min, In 1 hour, Today 16:00, Tomorrow 09:00, or a time input. Order stays pending and moves to the Call backs tab.
    - Declined: order to `cancelled` with the decline reason (F-758).
    - Wrong number: order to `cancelled` with reason "wrong number" (E3). The customer phone is flagged "wrong number".
  - [ ] Fields: Call note (text), Call length (optional).
  - [ ] The Save button text follows the outcome: "Save as confirmed", "Save, not reachable", "Save call back", "Save as declined", "Save, wrong number". It is disabled until an outcome is picked and the needed time or reason is set.
  - [ ] After saving Confirmed, the toast reads "You earn GH₵8 if delivered" or "GH₵8 plus GH₵X if delivered".
  - [ ] Enum becomes: confirmed, not_reachable, call_back_later, declined, wrong_number. Old values map: confirmed to confirmed, rescheduled to call_back_later, no_answer to not_reachable, cancelled to declined, other to declined with reason Other (GUESS: check old `other` rows).
  - [ ] Status changes go through the order status service (state machine). A rep cannot move an order to any other status.
  - [ ] Each save writes one `Call` row with `source = manual`, `startedAt` = when the card opened (GUESS: used only for a rough length when none is typed; check if wanted).
  - [ ] Not reachable three times in a row for one order opens a note for the manager (GUESS: the limit of 3; check).
- Data: `CallOutcome` change; `Call.callbackAt`, `Call.declineReason`, `Call.source`, `Call.startedAt` (F-768).
- API: `POST /api/calls` accepts the new outcomes and returns the next queue order id.
- Permissions: `calls:create` for rep, manager, admin, owner.
- Edge cases and errors: Confirmed on an already confirmed order: rejected. Declined without a reason: rejected. Call back time in the past: rejected.
- Tests: unit (outcome to status map); integration (each outcome's effect); e2e (confirm an order and see the next one open).

### F-758: Decline reasons
- Priority: P1. Milestone: M7.
- Description: A decline needs a reason. The reasons feed Reports (decline share) and the fake-order check.
- Current app: none.
- Mockup: `rep.html#queue` (reason chips).
- Acceptance criteria:
  - [ ] Reasons: Price too high, Prank or ordered by mistake, Changed mind, Bought elsewhere, Other. One must be chosen.
  - [ ] Sample shares (NUMBERS.md, 301 declined): price 34%, prank 22%, changed mind 20%, bought elsewhere 14%, other 10%.
  - [ ] "Other" asks for a short note.
  - [ ] The reason is stored on the order (`Order.declineReason`) and on the call.
  - [ ] Prank or mistake counts toward the fake-order check (Builder B1, Customers).
- Data: `Order.declineReason` enum (`price_too_high`, `prank_or_mistake`, `changed_mind`, `bought_elsewhere`, `other`).
- API: `POST /api/calls` field `declineReason`.
- Permissions: rep.
- Edge cases and errors: reason on a non-declined outcome is ignored.
- Tests: unit (shares); integration (required on decline).

### F-759: Upsell panel and upsell lines
- Priority: P0. Milestone: M7.
- Description: When the rep confirms, they may change the order: a bigger package or add-ons. The value added earns the rep 10%, paid only if the order is delivered. A live box shows what the rep earns.
- Current app: none (rep cannot edit items in a call flow).
- Mockup: `rep.html#queue` (Confirmed panel).
- Acceptance criteria:
  - [ ] Package tiers come from the order's checkout form packages: 1 set GH₵249; 2 sets GH₵449 (saves GH₵49); 3 sets GH₵629 (saves GH₵118). Add-ons: Refill pens +GH₵40, Pencil grip trainer +GH₵35, Smart Parent's guide +GH₵59. The panel reads these from the form, not from code.
  - [ ] Extra value = new order total − order total when the card opened. Examples: 1 set to 2 sets = GH₵200; adding refill pens = GH₵40; both = GH₵240. Only changes made on the call count.
  - [ ] One `UpsellLine` is written per change with kind `more_units`, `higher_package` or `add_on`, and its value.
  - [ ] Live earn box: "You earn GH₵X extra if this order is delivered (10% of GH₵Y)" or "No extra value added. You still earn GH₵8 if it is delivered."
  - [ ] Reward = 10% × extra value, rounded to the nearest pesewa, paid only on `delivered` (F-769).
  - [ ] If the order fails, is returned or is cancelled, the upsell entry becomes void. No reward.
  - [ ] Lowering the order (removing items) reduces extra value but never below 0 for the lines the rep added; removing a line the customer chose at checkout is not an upsell and lowers the total only.
  - [ ] The order total, items and stock reserve update when the call is saved (Orders service). The panel is not shown on Re-delivery and My orders (read-only; note: only the delivery agent changes those).
  - [ ] Upsell rate = orders with at least one upsell line ÷ confirmed orders. Sample Adwoa 24%, Confirm agent 15%, Nana 9%, all 20%.
  - [ ] Sample extra value on delivered orders: Adwoa GH₵6,100 (reward GH₵610), Confirm agent GH₵2,200 (no payout), Nana GH₵300 (GH₵30), all GH₵8,600.
  - [ ] AI agents write upsell lines too, but get no payout (entries are created with status `void_no_payout` or no entry; GUESS: pick one in the build; the owner only said no payout).
  - [ ] The guide is a digital item. If it is added to a COD order, it is delivered as a paid line only when the order is delivered (D8: a free bundled digital item does not count as revenue; a paid add-on does). Check delivery of the link with Products (file 06, F-601).
- Data: new `UpsellLine` {id, tenantId, orderId, repUserId, kind, valueAdded Decimal(19,4), addedAt, status (`pending`, `earned`, `void`)}.
- API: `POST /api/calls` accepts `orderChanges {packageId, addOnIds}`; the server computes extra value. The client never sends the value.
- Permissions: rep (own orders), manager, admin, owner.
- Edge cases and errors: the form no longer offers a package: the panel shows the tiers that remain. Two reps editing the same order: last save wins with a warning.
- Tests: unit (extra value cases above; reward rounding); integration (void on failed); e2e (upsell then deliver then see the reward).

### F-760: My orders
- Priority: P1. Milestone: M7.
- Description: A list of orders the rep has handled, with search and the same call card. It is read-mostly.
- Current app: Orders list.
- Mockup: `rep.html#orders`.
- Acceptance criteria:
  - [ ] List of orders the rep confirmed, declined or called, newest first. Search by name, phone, area, order number.
  - [ ] Status labels are views of the one order status (fix #10): Waiting to dispatch, Out for delivery, Delivered, Failed, Declined. They map to real statuses (confirmed/preparing/ready_for_pickup, out_for_delivery, delivered, failed_delivery or returned, cancelled).
  - [ ] The call card shows history, previous orders and a note field. No package editing.
  - [ ] Filters: status, date range.
  - [ ] Pagination 25 per page.
- Data: none. API: `GET /api/rep/me/orders?status=&q=&page=`.
- Permissions: rep sees own.
- Edge cases and errors: none new.
- Tests: integration (list limited to own orders).

### F-761: Earnings (rep pay view)
- Priority: P0. Milestone: M7.
- Description: The rep sees what they are owed and why. Pay is GH₵8 per confirmed order that is delivered, plus the upsell reward, minus payments made. This replaces Earnings History.
- Current app: `EarningsHistory` (payments only), `GET /api/users/me/payout-history`.
- Mockup: `rep.html#earnings`.
- Acceptance criteria:
  - [ ] Card "You are owed GH₵X" with lines: Commission (delivered × GH₵8), Upsell reward (10% of extra value), Paid (payments), Owed now.
  - [ ] Sample Adwoa: 253 × 8 = GH₵2,024; upsell 10% of 6,100 = GH₵610; paid on 9 Oct GH₵600; owed now = 2,024 + 610 − 600 = GH₵2,034. The 1 Oct payment of GH₵840 was for September and is not in October lines.
  - [ ] Sample Nana: 13 × 8 = 104; upsell 30; owed 134. Commissions payable total (all reps) GH₵2,168 = 2,034 + 134.
  - [ ] Note: "N of your confirmed orders are still open, each adds GH₵8 when delivered." Sample 154.
  - [ ] Target reward line: "GH₵300 at 423 confirmed and delivered (100%)" with the tag "253 of 423". Paid after month close.
  - [ ] Payment history table: Date, Amount, Status, For. Header "2 payments, GH₵1,440 paid". Sample: 9 Oct GH₵600 Paid October commission; 1 Oct GH₵840 Paid September balance.
  - [ ] Amounts come from `CommissionEntry` and `Payout`. The one payout record is the same one Finance and Staff use (fix #5; Builder C owns the payout form).
  - [ ] Each line can expand to the orders behind it (order number, date, amount).
  - [ ] The currency is the store currency, not hard-coded GHS.
  - [ ] An AI agent holding the role sees "No payout for AI agents" and no amounts owed.
  - [ ] The rep's own rate is GH₵8 for all reps by default. A per-person override (Staff) is allowed.
- Data: reads `CommissionEntry`, `Payout` (F-769).
- API: `GET /api/rep/me/earnings`.
- Permissions: rep sees own only.
- Edge cases and errors: a delivered order later returned reverses its entry, and the line shows a reversal. Owed below 0 shows "Overpaid GH₵X".
- Tests: unit (the Adwoa and Nana numbers); integration (return reverses commission); e2e (view as Adwoa).

### F-762: My numbers
- Priority: P1. Milestone: M7.
- Description: The rep sees their own results and rank.
- Current app: rep stats in `repPerformanceService`.
- Mockup: `rep.html#numbers`.
- Acceptance criteria:
  - [ ] KPI row: Confirmed (activity count), Confirmation rate, Delivered from confirmed (with delivered count), Upsell rate, Extra value added (on delivered orders), Time to first call (median).
  - [ ] Sample Adwoa: 640 confirmed (activity), 73%, 52% (253), 24%, GH₵6,100, 12 min; target progress 253 of 423 (60%).
  - [ ] Ranks: rank in Call reps; rank in Upsell (sample 1st of 3 each). AI agents rank under the role they hold.
  - [ ] "Where my 640 confirmed orders are": stacked bar Delivered 253, Failed or returned 233, Still open 154 (= 640 − 486).
  - [ ] "My calls": Today, This week, This month, Average a day (sample 41, 480, 1,360, 80).
  - [ ] "Call outcomes this month": Confirmed 640, Not reachable 300, Declined 190, Call back 150, Wrong number or other 80 (sum 1,360).
  - [ ] "Calls a day, last 14 days" bar chart. Today is marked "still counting".
  - [ ] The metric "confirmed per call %" is not shown (removed). Calls per confirmation shows for managers (2.25 overall), not on this page.
  - [ ] No reach, likes or other vanity numbers.
- Data: none.
- API: `GET /api/rep/me/numbers`.
- Permissions: rep sees own.
- Edge cases and errors: a new rep with no data sees zeros and "—".
- Tests: unit (stack sums); integration (fixture reproduces the Adwoa numbers).

### F-763: Rep inbox
- Priority: P1. Milestone: M9.
- Description: The rep has an inbox of reminders, notifications and team notes. It uses the shared inbox service (Builder B1, F-550 range) with a rep filter.
- Current app: none.
- Mockup: `rep.html#inbox`.
- Acceptance criteria:
  - [ ] Header: unread summary, "Mark all read". Tabs: All, Reminders, Team notes (unread counts).
  - [ ] All and Reminders: rows grouped Today, Yesterday, Earlier. Row types: Call back <name> (link "Open call card"); WhatsApp reply from a customer ("Open call card" and "Open conversation", where the rep replies on WhatsApp, decision P5); Order moved to you ("Open call card"); "Delivered: <name>. You earned GH₵X" ("Open in My orders"); "Failed: <name> refused the order" ("Open re-delivery call"); "Payout paid: GH₵600" ("Open Earnings"); team note ("Open note").
  - [ ] The row "You reached 80% of your target ... earned" is removed. A row "You reached 100% of your target" appears at month close (G4).
  - [ ] Team notes tab: thread list with unread dots; thread pane with title, status tag, "Open call card", messages, a reply box and Send.
  - [ ] Empty state: "Nothing here. You are caught up."
  - [ ] Reminders created by "Call back later" appear here at the due time (GUESS: the mockup builds these from the call-back; confirm they are Reminder rows).
  - [ ] A rep sees only their own items.
- Data: `Notification`, `Reminder`, `Thread`, `Comment` (design §5.3, Builder B1).
- API: shared inbox endpoints filtered by user.
- Permissions: rep sees own.
- Edge cases and errors: mention of a rep in a note notifies them once.
- Tests: integration (call back creates a reminder); e2e (reply to a thread).

### F-764: Auto-confirm by WhatsApp or SMS
- Priority: P1. Milestone: M7.
- Description: When an order is placed, the system sends the customer a message to confirm. A customer reply can confirm the order without a call. This is the first answer to slow first calls on basic phones (decision 6). The messaging provider work is in Messages (Builder B1).
- Current app: none (order SMS exist on status changes; no reply handling).
- Mockup: not in mockup (RE-11: only the timer and rank show). Build a settings block and queue tags in v2 style.
- Acceptance criteria:
  - [ ] Setting block (placed in Settings → Operations, F-1200 range): Auto-confirm on/off; channel (WhatsApp first, SMS if WhatsApp fails); send delay in minutes (default 0; GUESS: check with the owner); message template (editable in Messages templates).
  - [ ] Message: order summary and a request to reply YES to confirm or NO if they do not want it. The message goes out at once, also outside operating hours (decision P4). Reply keywords are matched without case. Anything else goes to the rep as a customer reply (Inbox).
  - [ ] A YES reply sets the order to `confirmed` with a `Call` row `source = auto_confirm`, outcome `confirmed`. The order leaves the queue.
  - [ ] A NO reply keeps the order pending and sends it to the call queue with a "said NO" flag (decision P2). A rep calls once before any cancel. It does not cancel by itself.
  - [ ] Pay rule (decision P6): commission is paid only for orders a rep confirms by call. An order confirmed only by auto-confirm earns no GH₵8, for the AI agent or the assigned rep. If a rep also called and confirmed, the rep earns.
  - [ ] A customer YES closes the time-to-first-call clock as "auto-confirmed" (decision R10, F-755).
  - [ ] Opt-out customers are not messaged (existing flag).
  - [ ] Each message has tracked status (sent, delivered, read, failed, replied) from `MessageEvent`.
  - [ ] Messages respect WhatsApp's 24-hour rule: outside it, use an approved template; if none, fall back to SMS.
- Data: `Call.source` includes `auto_confirm`. Settings keys: `autoConfirmEnabled`, `autoConfirmChannel`, `autoConfirmDelayMinutes`.
- API: inbound webhook handler in communications (Builder B1) calls `orderService.confirmByCustomer`.
- Permissions: setting: owner and admin.
- Edge cases and errors: customer replies YES twice: second is ignored. Reply after the order is cancelled: ignored and logged.
- Tests: unit (keyword match); integration (YES confirms once; NO tags); e2e (message sent after order creation).

### F-765: Rep creates an order
- Priority: P1. Milestone: M7.
- Description: Reps take phone and WhatsApp orders. The button "New order" in the Queue header opens the New order form from Orders (Builder B1, F-300 range). It assigns the order to the rep who made it.
- Current app: reps have `orders:create`.
- Mockup: not in mockup (RE-12). Build the button and a right-side drawer in v2 style.
- Acceptance criteria:
  - [ ] "New order" is visible to reps in the Queue header.
  - [ ] The drawer has the same fields as Orders New order: customer (search or add), phone, alternate phone, region (one of 16), town, address, items, editable total.
  - [ ] The new order is assigned to the rep (`customerRepId`) and enters at `pending_confirmation`, or at `confirmed` if the rep marks "Customer already confirmed".
  - [ ] A rep-created order marked confirmed by the rep earns commission on delivery like any order the rep confirms by call (P6).
  - [ ] Source is `manual`; `createdById` is the rep.
  - [ ] Duplicate check: same phone and same package in 30 minutes warns (as public checkout does).
- Data: none new.
- API: `POST /api/orders` (exists) with rep guard.
- Permissions: rep, manager, admin, owner.
- Edge cases and errors: product archived: not selectable. Stock check as checkout (available to sell).
- Tests: integration (rep order assigned to rep); e2e.

### F-766: Rep adds and edits customers
- Priority: P1. Milestone: M7.
- Description: Reps can add and edit customers (G9). They cannot delete.
- Current app: Customers CRUD allowed for reps (`customers:*`).
- Mockup: not in mockup (RE-13). Build "Edit customer" on the call card and an "Add customer" step inside New order.
- Acceptance criteria:
  - [ ] Add: first name, last name, phone, alternate phone, email (optional), address, region, town. Phone must be unique per tenant (existing rule).
  - [ ] Edit: same fields from the call card.
  - [ ] Reps cannot delete a customer or change risk, refusal count or COD block (owner and manager only).
  - [ ] Edits write an audit row.
- Data: none new. API: `POST /api/customers`, `PUT /api/customers/:id` (exist).
- Permissions: rep: create, view, update. No delete.
- Edge cases and errors: duplicate phone opens the existing customer.
- Tests: integration (rep cannot delete).

### F-767: Rep success-rate fix
- Priority: P0. Milestone: M1.
- Description: Today the rep success rate counts only delivered orders whose commission is unpaid (`!order.commissionPaid`). After a payout the rate falls. The fix counts delivered orders by status. Pay state has no effect.
- Current app: `backend/src/services/repPerformanceService.ts` lines 110 to 117; `successRate = deliveredCount / totalAssigned`, `mtdSuccessRate` the same with the month filter.
- Mockup: `rep.html#today`, `#numbers`.
- Acceptance criteria:
  - [ ] Delivered counts use `status = delivered` (and `deliveryDate` in the period for revenue views). `commissionPaid` is not read.
  - [ ] Two named values replace `successRate`: `confirmationRate` = confirmed ÷ assigned, and `deliveredFromConfirmedRate` = delivered ÷ (delivered + failed + returned) of the rep's confirmed orders.
  - [ ] Earnings are no longer computed in this service; `CommissionEntry` is the source (F-769).
  - [ ] A regression test: pay a rep, then check the rate is unchanged.
  - [ ] All callers update: `GET /api/users/reps/performance`, `CustomerReps` (dropped, ST-16), Reports team tab (Builder C), MCP tools `reps_performance` and `reps_status`.
  - [ ] No field or label uses an unnamed rate; the two fields above are the only ones.
- Data: none. API: response fields renamed (breaking; MCP schema resource regenerated in M2).
- Permissions: as before.
- Edge cases and errors: a rep with no closed orders shows "—".
- Tests: unit (fixture: 640 confirmed, 486 closed, 253 delivered gives 52%); integration (rate unchanged after payout).

### F-768: Call and order timestamp changes
- Priority: P0. Milestone: M0 (tenant) and M1 (columns).
- Description: `Call` has no `tenantId`, so call data can leak across tenants (§3 #46). Time to first call needs call start and source. Order needs timestamps.
- Current app: `Call` {orderId, customerId, salesRepId, outcome, duration, notes}.
- Mockup: n/a.
- Acceptance criteria:
  - [ ] `Call.tenantId` required, filled for existing rows from the order or customer, and added to the tenant-scoped list.
  - [ ] New `Call` columns: `startedAt`, `source` (`manual`, `auto_confirm`, `tap_to_call`), `declineReason`, `callbackAt`.
  - [ ] New `Order` columns: `confirmedAt`, `confirmedById`, `firstContactAt`, `declineReason` (the shared design columns are owned by Builder B1's order model; this file needs these three to exist).
  - [ ] Back-fill `confirmedAt` from `OrderHistory` (status change to `confirmed`) and `firstContactAt` from the first `Call`. GUESS: enough history; check counts before M1.
  - [ ] Two-tenant test: tenant A cannot read tenant B calls.
- Data: as above. API: none new.
- Permissions: n/a.
- Edge cases and errors: calls with no resolvable tenant are listed and fixed by hand before the not-null rule.
- Tests: integration (isolation); migration test.

### F-769: Rep pay ledger (CommissionEntry)
- Priority: P0. Milestone: M7.
- Description: Pay lines are rows, not a counter on the user and a flag on the order. A delivered order creates a base entry and an upsell entry. The rep screen and Finance read the same rows. The posting to the books (payable GL 2100 in the design; live code 2020, see E1) is Builder C's.
- Current app: `User.commissionAmount` per delivered order, `Order.commissionPaid`, `Order.payoutId`, `payoutService`.
- Mockup: `rep.html#earnings`, `finance.html` (rep commissions).
- Acceptance criteria:
  - [ ] On `delivered`, create `CommissionEntry` base for the rep who confirmed it by call (no entry for an auto-confirmed order, decision P6): amount GH₵8 (Settings → Rewards; per-person override allowed), status `earned`. And one `upsell` entry per `UpsellLine` at 10% of its value.
  - [ ] AI agents holding the role get no entry (or a void entry; decide with F-759). Auto-confirmed orders get no entry (P6).
  - [ ] On return after delivery, entries are voided or reversed; if already paid, a negative entry is created for the next payout.
  - [ ] A payout links the entries it paid (`Payout` id on each entry), so the rep sees which orders were paid. This replaces `commissionPaid` and the "pick delivered orders" modal (ST-13; the picker lives in the Finance payout form, Builder C).
  - [ ] Old data: back-fill entries for delivered orders in the last 3 months from current rules (GUESS: older history stays as booked, D5). Payments already made stay as `Payout` rows.
  - [ ] Commissions payable total = sum of earned and unpaid entries (sample GH₵2,168).
- Data: new `CommissionEntry` {id, tenantId, orderId, userId, kind (`base`, `upsell`), amount Decimal(19,4), status (`pending`, `earned`, `paid`, `void`), earnedAt, payoutId?}. `User.commissionAmount` and `Order.commissionPaid` are not used after this milestone.
- API: `GET /api/commission-entries?userId=&status=`.
- Permissions: rep sees own; owner, admin, finance clerk see all.
- Edge cases and errors: an order confirmed by one rep and delivered after reassignment pays the confirming rep.
- Tests: unit (amounts); integration (return voids; payout links).

### F-770: Rep suggestion cards
- Priority: P3. Milestone: M11.
- Description: Today shows one to three cards built from the queue. They help the rep act. They change no data.
- Current app: none.
- Mockup: `rep.html#today`.
- Acceptance criteria:
  - [ ] Card "<name> is waiting for your call": a call back is N minutes late. Button "Open order" opens the call card on Call backs.
  - [ ] Card "N customers did not pick up": button "Send WhatsApp" opens the Queue filtered to those customers with a WhatsApp link and a draft text for each. The rep presses send in WhatsApp. (The mockup toast is replaced; nothing is sent by the app.)
  - [ ] Cards come from the problem finders (`slow_queue`). Numbers equal the Queue header.
  - [ ] No card if nothing is late.
- Data: none. API: `GET /api/rep/me/suggestions`.
- Permissions: rep.
- Edge cases and errors: none.
- Tests: unit (card rules); e2e (click Open order).

### F-771: One order id format and one set of labels
- Priority: P2. Milestone: M7.
- Description: The mockups show three id formats (#24xxx, CA-482xx, #MG-104xx), one id for different customers, and different status words per screen (fixes #10, #11, #12). The rebuild uses one id and one status source everywhere.
- Current app: numeric `Order.id`.
- Mockup: `rep.html` (CA-482xx).
- Acceptance criteria:
  - [ ] The rep screen shows the same order number as Orders. One format for the whole app (defined by Builder B1, F-300 range).
  - [ ] Rep labels map to real statuses (F-760). "Not reachable" is never an order status.
  - [ ] One order table feeds the rep screen. No sample ids in the build.
- Data: none. API: none.
- Permissions: n/a.
- Edge cases and errors: none.
- Tests: component (label map).

---

## 3. Cross-area dependencies

| Need | Where | Used by |
|---|---|---|
| Order status service, state machine, New order form, order id format, order timestamps | F-300 range (Builder B1) | F-757, F-765, F-771 |
| Customers, refusal count and risk (G6) | F-350 range (Builder B1) | F-756, F-766 |
| Inbox, reminders, threads, notifications | F-550 range (Builder B1) | F-763 |
| Messages: provider, templates, `MessageEvent`, inbound reply handling | F-450 range (Builder B1) | F-764 |
| Checkout form packages and add-ons | F-400 range (Builder B1) | F-759 |
| Settings → Rewards (tiers, GH₵8, 10%), Settings → Operations (hours, 15/30 min) | F-1200 range (Builder C) | F-753, F-755, F-761, F-764 |
| Targets, attainment, leaderboard, month-close rewards | F-1100 range (Builder C) | F-752, F-753, F-762 |
| Payout form, ledger posting, commissions payable | F-900 range (Builder C) | F-761, F-769 |
| Staff: per-person rate override, roles | F-1150 range (Builder C) | F-769 |
| KPI service, suggestion cards, MCP tools | F-200 and F-1300 ranges (Builder A) | F-755, F-767, F-770 |
| Agent delivery reasons feed re-delivery | F-806 in `09-agent-app.md` | F-754 |

---

## 4. Coverage table

### 4.1 Section 1.15 Rep screen (14 rows)

| Matrix row | Covered by |
|---|---|
| RE-01 Today | F-752, F-753 |
| RE-02 Queue with wait timer | F-754, F-755 |
| RE-03 Call card | F-756 |
| RE-04 Outcomes | F-757 |
| RE-05 Upsell panel | F-759 |
| RE-06 Decline reasons | F-758 |
| RE-07 My orders | F-760 |
| RE-08 Earnings | F-761, F-769 |
| RE-09 My numbers | F-762 |
| RE-10 Rep inbox | F-763 |
| RE-11 Auto-confirm, queue timer, time to first call | F-764, F-754, F-755 |
| RE-12 Rep creates an order | F-765 |
| RE-13 Rep adds or edits a customer | F-766 |
| RE-14 Rep sees customer detail and past orders | F-756 |

### 4.2 Related rows

| Row | Covered by |
|---|---|
| §3 #16 Rep success rate counts only commission-unpaid orders | F-767 |
| §3 #46 `Call` has no `tenantId` | F-768 |
| §4 #1 Rewards in two places; the lower reward tier (rep screen lines) | F-753, F-763 |
| §4 #5 Payouts recorded in two places (rep view) | F-761 (record: F-900 range) |
| §4 #10 Order statuses differ per screen; "Not reachable" shown as status | F-757, F-760, F-771 |
| §4 #11 Order ID formats | F-771 |
| §4 #12 Same ID maps to different customers | F-771 |
| §4 #25 Dead buttons (rep Send WhatsApp, Mark all read, card buttons) | F-750, F-770 |
| §4 E3 Declined and Wrong number map to Cancelled with reason | F-757 |
| §2.3 operatingHours, queue wait alert, time to first call target | F-755 (screens: F-1200 range) |
| ST-16 / ST-17 (Customer Reps table and Earnings History dropped) | F-750, F-761 (DROP verdicts in matrix 1.14) |
| Design §4.4 KPIs (confirmation rate, time to first call, upsell rate, extra value, decline reasons) | F-752, F-755, F-758, F-759, F-762 |

Counts: matrix section 1.15 has 14 rows. This table covers 14. Related rows: 12. F-IDs in this file: 22 (F-750 to F-771).

## 5. Open items

1. RESOLVED (decision P7): rep target counts confirmed orders that get delivered, counted at month close. (F-753)
2. RESOLVED (decisions R10, P6): an auto-confirm message does not count as first contact; a customer YES closes the clock as auto-confirmed; an auto-confirmed order earns no commission. (F-755, F-764)
3. Auto-confirm send delay. (F-764)
4. Old `CallOutcome.other` rows mapping. (F-757)
5. AI agent upsell entries: void entry or none. (F-759, F-769)
6. Back-fill depth for commission entries. (F-769)
7. Conflict: `DESIGN-SPEC.md` and the design doc §4.7 still list a lower reward tier. RESOLVED (decision D9): removed. The mockup `rep.html` still shows it in two places (Today card and an inbox row); relabel in the build.
8. Conflict: the personal target and the role target. RESOLVED (decision P7, 2026-10-19): the role target is 723 confirmed orders that get delivered, split Adwoa 423, Confirm agent 250, Nana 50 (sum 723). Confirmed counts stay as an activity column.
