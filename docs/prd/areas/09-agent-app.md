# Area 09: Delivery agent app

Part of the CodAdmin rebuild PRD. Builder B2. Date: 2026-10-18.
Range: F-800 to F-849.

Terms:
- Delivery agent: a person who delivers orders and collects cash. 3PL companies have no app login.
- Cash held: cash the agent collected on delivered orders, minus the delivery fees the agent kept, minus cash the agent deposited (decision F4).
- Delivery fee: what we pay the agent for each outcome, by the agent's fee rule in Settings (decisions F1, F2). The agent keeps it from the cash they collect. Fees kept are called "fees you kept" in the app.
- Delivery success rate: delivered ÷ (delivered + failed + returned), closed orders only. Target 60%.
- GUESS: the source did not prove the statement. The text says how to check it.

---

## 1. Scope

This file covers gap-matrix section 1.16 Delivery agent app (AG-01 to AG-16) and the mockup fixes for `agent.html`. Mockup: `agent.html` (phone app: Home, Deliveries, Detail, sheets, Stock, Cash, Inbox, More). It replaces the `/m` pages (`MobileDeliveries`, `MobileDeliveryDetail`, `MobileCollections`, `AgentMyInventory`, mobile dashboard).

Role: delivery agent (`delivery_agent`), a person. The owner and managers see the same data in Deliveries, Inventory and Finance.

Decisions that apply:
- D1, O3: English only. No other language is planned.
- D9: cash tiers only. Delivery: 100% GH₵250; 120% GH₵400 plus a paid day off. No lower tier. No other reward type anywhere.
- F1 to F4: the delivery fee replaces G3. The agent keeps the fee from the cash they collect and hands in the rest. No fee is paid out. The app shows earned fees as "fees you kept".
- G4: a target reward is earned at month close, on delivery-date numbers.
- G10: nothing here is written by AI in the first release.
- Decision 13: agents have their own inbox.

The app is a phone web app (PWA), mobile first, one hand use, large touch targets. It must work on a mid-range Android browser on a slow network.

---

## 2. Requirements

### F-800: Agent app shell
- Priority: P1. Milestone: M10.
- Description: A separate phone app for delivery agents. Five bottom tabs. It replaces the `/m` routes and the "Mobile View" switch in the admin sidebar.
- Current app: `/m/*` routes with `MobileLayout`, `MobileNav`, `MobilePlaceholder` (unrouted), `MOBILE_OPT_IN` switch (SH-18, dropped).
- Mockup: `agent.html` (phone frame; tabs Home, Deliveries with badge, Stock, Cash, More; bell on Home to Inbox).
- Acceptance criteria:
  - [ ] After login, a `delivery_agent` lands on `/agent/home`. The agent cannot open admin routes.
  - [ ] Bottom tabs: Home, Deliveries (badge = deliveries to do today), Stock (badge = incoming to confirm), Cash, More. The bell on Home opens the Inbox with an unread count.
  - [ ] The mockup phone frame and the "Back to CodAdmin" strip are mockup only. The real app fills the screen. "Back to CodAdmin" shows only to owner, admin and manager who open the app to preview.
  - [ ] The "Mobile View" switch and `MOBILE_OPT_IN` are removed.
  - [ ] All text is English. The language switch is not shown (D1). Strings live in one English file. No placeholder text in other languages from the mockup ships.
  - [ ] The app installs as a home-screen app and shows the existing update prompt when a new version is ready.
  - [ ] Realtime: new assigned orders, incoming stock and inbox items appear without reload (socket events scoped by tenant).
  - [ ] Every control works or is removed (fix #25). Sign out works (the mockup button is dead).
  - [ ] Layout works from 360 px up. No horizontal scroll. Touch targets 44 px or larger.
- Data: none. API: `GET /api/agent/me/home` and the routes in the sections below.
- Permissions: `delivery_agent` only.
- Edge cases and errors: a deactivated or blocked agent sees a message "Your account is paused. Call the office." on every tab and cannot start deliveries (blocked agents already cannot get new orders).
- Tests: e2e at 390 px (login lands on Home; admin route is blocked); component (tab badges).

### F-801: Home
- Priority: P1. Milestone: M10.
- Description: Home shows today's work, the month's target, cash held and notes from the team.
- Current app: delivery agent dashboard config in `DynamicDashboard`.
- Mockup: `agent.html#home`.
- Acceptance criteria:
  - [ ] "Today" card: "N left" and "X of Y delivered". Both come from the same list as the Deliveries tab. Y = deliveries assigned for today; X = those delivered today. The mockup shows 5 of 8 on Home and 3 of 8 in Deliveries (fix #16). One query feeds both.
  - [ ] Button "Go to deliveries" opens the Deliveries tab.
  - [ ] Target hero: "Your October target": attainment % (delivery success ÷ 60%), the success rate and the target. Sample Kofi 90%, 54%, target 60%.
  - [ ] Reward card: F-816.
  - [ ] "Cash you hold": amount, number of orders, age of the oldest, and a Deposit button (sample GH₵2,900, 12 orders, oldest 4 days; the Deliveries page shows 3 days for Kofi: both use one function, F-704 in file 07).
  - [ ] "From the team": the latest inbox items (up to 3) with a count of new ones.
  - [ ] No chip says "Reward now" with a lower tier. No text mentions a lower tier.
- Data: none new. API: `GET /api/agent/me/home`.
- Permissions: agent sees own data only.
- Edge cases and errors: new agent with no data sees zeros and a hint "Your deliveries show here."
- Tests: integration (Today numbers equal the list counts); e2e.

### F-802: Deliveries list
- Priority: P1. Milestone: M10.
- Description: The agent sees assigned orders in tabs, with search.
- Current app: `MobileDeliveries` (`GET /api/deliveries/agent-orders`; tabs All, Pending, Transit, Done; search; month to date; page size 20).
- Mockup: `agent.html#deliveries`.
- Acceptance criteria:
  - [ ] Header summary: "X of Y delivered today".
  - [ ] Search by name, phone, area, order number, with a clear button.
  - [ ] Tabs with counts: All, To pick up (`ready_for_pickup`), Out (`out_for_delivery`), Done (`delivered`), Failed (`failed_delivery`). The current app puts Done and Failed together; the mockup splits them. Use the mockup.
  - [ ] Card: customer name, "area · order number", cash to collect, status tag. Empty state: "No orders here."
  - [ ] Order numbers use the one app-wide format (fix #11). Status words are views of the real statuses (fix #10).
  - [ ] Page size 20 with "Load more".
  - [ ] The list shows only orders assigned to this agent.
- Data: none. API: `GET /api/agent/me/deliveries?tab=&q=&page=` (wraps `agent-orders`).
- Permissions: agent sees own.
- Edge cases and errors: an order reassigned away disappears on the next refresh and the agent gets an inbox item.
- Tests: integration (only own orders); e2e (search).

### F-803: Delivery detail
- Priority: P1. Milestone: M10.
- Description: One screen has everything for one stop: who, where, what, how much, and past attempts. The Call, WhatsApp and Maps buttons work (fix #27).
- Current app: `MobileDeliveryDetail` (`GET /api/deliveries/:id`, `/by-order/:orderId`).
- Mockup: `agent.html#detail`.
- Acceptance criteria:
  - [ ] Header: back, name, "order number · area", status tag. Progress steps: Picked up, Out for delivery, Delivered.
  - [ ] Call button is a `tel:` link to the customer's phone. The mockup used a fixed number (wrong). The alternate phone shows as a second link when set.
  - [ ] WhatsApp button opens `wa.me/<customer number>`.
  - [ ] Maps button opens a maps link built from the address and town (GUESS: a text search link; the order has no coordinates; check with the owner).
  - [ ] Card "Deliver to": address, phone.
  - [ ] Items: lines with price, and "Cash to collect".
  - [ ] "Past attempts": date, reason, note, or "No failed attempts." (data: F-713 in file 07).
  - [ ] Primary button by state: To pick up gives "Start delivery" (F-804); Out gives "Complete delivery" (F-805) and "Report failed" (F-806); Done and Failed show none.
  - [ ] The agent cannot edit items or prices (only the rep can before dispatch).
  - [ ] Opening from the Inbox returns to the Inbox on back.
- Data: none. API: `GET /api/agent/me/deliveries/:orderId`.
- Permissions: agent for own orders only (403 otherwise; see F-716 in file 07).
- Edge cases and errors: a customer without a phone number hides Call and WhatsApp and shows "No phone number. Call the office."
- Tests: integration (403 on others' order); e2e (links have the right href).

### F-804: Start delivery
- Priority: P1. Milestone: M10.
- Description: The agent marks that they picked up the parcel and are out.
- Current app: `PATCH /api/orders/:id/status` to `out_for_delivery`.
- Mockup: `agent.html#detail` ("Start delivery").
- Acceptance criteria:
  - [ ] "Start delivery" moves the order to `out_for_delivery` through the order status service and sets `dispatchedAt` if empty.
  - [ ] No stock change happens (units become reserved; stock falls once at delivery, F-657 in file 06).
  - [ ] The agent can start several orders. A toast confirms.
  - [ ] The customer gets the "out for delivery" message if the workflow is on (Messages, Builder B1).
- Data: `Order.dispatchedAt`. API: `POST /api/agent/me/deliveries/:orderId/start`.
- Permissions: assigned agent.
- Edge cases and errors: order not in `ready_for_pickup`: show the current status and stop.
- Tests: integration (status, no stock change); e2e.

### F-805: Complete delivery and cash collected
- Priority: P0. Milestone: M10.
- Description: The agent confirms delivery, who received it, and the cash taken. The cash goes into the agent's held balance.
- Current app: `PATCH /api/deliveries/:id/complete`, `PATCH /:id/proof`, `POST /api/upload`; sheet "Complete Delivery" (COD amount, recipient name, optional photo, `proofType` photo or otp).
- Mockup: `agent.html` (sheet "Complete delivery"). The mockup's button ignores what the agent types (fix: stale state, F-817).
- Acceptance criteria:
  - [ ] Fields: Who received it (text, required), Cash collected (default = cash to collect, editable), Photo (camera or gallery, optional, uploads to storage).
  - [ ] Button "Confirm delivered". It saves proof, cash and recipient, then calls the order status service for `delivered`. Fees (F-703), stock (F-657), collection and ledger run once (F-720).
  - [ ] Toast: "Delivered. Cash added to your balance."
  - [ ] A draft `AgentCollection` is created for the cash collected, and the held balance increases at once.
  - [ ] If cash collected differs from cash to collect, the sheet asks for a reason (customer paid less, paid more, other). A Finding opens for the office (Builder C). Order total is not changed by the agent.
  - [ ] OTP and signature proof stay in the API (enum values exist) but are not shown. No code sends an OTP today (GUESS: check `deliveryService`). Photo or name is enough in this release.
  - [ ] The sheet resets each time it opens.
  - [ ] A second tap does nothing (the button disables while saving).
- Data: `Delivery.recipientName`, `proofImageUrl`, `proofType`; `AgentCollection.amount`.
- API: `POST /api/agent/me/deliveries/:orderId/complete {receivedBy, cashCollected, photoUrl?, shortReason?}` (wraps `PATCH /deliveries/:id/complete`).
- Permissions: assigned agent.
- Edge cases and errors: no network: show "Not saved. Try again." and keep the typed values (no offline queue in this release; GUESS: owner may want offline mode; ask). Order already delivered: show Done.
- Tests: integration (collection created; held balance up; fees stamped once); e2e (complete with a photo).

### F-806: Report failed
- Priority: P0. Milestone: M10.
- Description: The agent says why a delivery failed. The reason feeds the "Failed and returned by reason" card (file 07, F-705), the customer refusal count and the next re-call.
- Current app: sheet "Report Failed Delivery" (reason, "Reschedule for tomorrow" toggle to `ready_for_pickup`, else `failed_delivery`).
- Mockup: `agent.html` (reason chips Not reachable, Refused, Wrong address, Rescheduled; note).
- Acceptance criteria:
  - [ ] Reason chips (one required): Not reachable, Refused, Wrong address, Rescheduled. Note field "Add details for the team".
  - [ ] "Rescheduled" moves the order to `ready_for_pickup` (comes back tomorrow). The other three move it to `failed_delivery`.
  - [ ] Each report writes one attempt row (date, reason, note) (file 07, F-713).
  - [ ] The failed fee is stamped from the partner's fee rule (file 07, F-703). Sample: Kofi GH₵5.
  - [ ] "Refused" adds one to the customer's refusal count (G6, Customers, file 02): at 2 the customer is High risk; at 3 COD turns off and the next order goes to a manual call.
  - [ ] Failed orders enter the rep's Re-delivery tab (file 08, F-754) with the reason.
  - [ ] The agent keeps the parcel in stock until it is returned (F-654 in file 06).
- Data: `Order.failureReason`. API: `POST /api/agent/me/deliveries/:orderId/fail {reason, note}`.
- Permissions: assigned agent.
- Edge cases and errors: a reason is required. Reporting on a delivered order is blocked.
- Tests: integration (each reason's status and refusal count); e2e.

### F-807: Stock page
- Priority: P1. Milestone: M10.
- Description: The agent sees what they hold, what is on its way to them and a short history.
- Current app: `AgentMyInventory` (`GET /api/agent-inventory/agent/:id`, transfers).
- Mockup: `agent.html#stock`.
- Acceptance criteria:
  - [ ] Header: "My stock, N units on hand" (sum over products, from the agent's `StockLevel`).
  - [ ] "Incoming stock" card with tag "n to confirm". Each item: product, "Sent by <name> · date", quantity, "Confirm received" (F-808). Empty: "Nothing waiting. Stock sent to you shows up here."
  - [ ] Stock list: product, SKU, units (sample Copybook set 36, Refill pens 18, Grip trainer 45).
  - [ ] History, last 7 days, tabs All, Allocated, Delivered, Transferred, Returned, Adjusted, Received. Each row: type and product, reference, date, quantity with sign (sample +20 allocated, −1 delivered, −5 transferred out, +1 returned, −2 adjusted).
  - [ ] The agent sees only their own stock and moves.
  - [ ] The agent cannot allocate, transfer, return or adjust. Those are office actions (file 06, F-655).
- Data: reads `StockLevel`, `InventoryTransfer`. API: `GET /api/agent/me/stock`.
- Permissions: agent sees own.
- Edge cases and errors: negative on hand shows the number and "Check with the office".
- Tests: integration (own stock only); e2e.

### F-808: Confirm received stock
- Priority: P0. Milestone: M10.
- Description: The agent confirms the units that arrived. If fewer arrived, the agent says why. This closes the transfer and opens a dispute when short.
- Current app: none (allocation adds stock to the agent at once).
- Mockup: `agent.html` (sheet "Confirm received").
- Acceptance criteria:
  - [ ] Field: Units received (default = units sent, maximum = sent, minimum 0).
  - [ ] If received is below sent: the sheet shows "Short by n. The office will see this." and requires a reason: Short in package, Damaged, Not received.
  - [ ] Button "Confirm received". It calls the transfer receive route (file 06, F-654). Received units are added to the agent's on hand. A short transfer becomes `disputed`.
  - [ ] History gets a "Received" row with the short note.
  - [ ] The office gets an inbox item and a Finding when short.
  - [ ] The agent can confirm only transfers addressed to them.
  - [ ] Toast: "<n> units added."
- Data: `InventoryTransfer` (file 06). API: `POST /api/agent/me/transfers/:id/receive {quantity, reason?}`.
- Permissions: receiving agent.
- Edge cases and errors: already confirmed: show Done. Transfer cancelled by the office: it disappears and an inbox item says so.
- Tests: integration (equal and short); e2e (confirm 18 of 20).

### F-809: Cash page
- Priority: P0. Milestone: M10.
- Description: The agent sees what they hold and their collections and deposits.
- Current app: `MobileCollections` (`GET /api/agent-reconciliation/agents/:id/balance`, collections, deposits).
- Mockup: `agent.html#cash`.
- Acceptance criteria:
  - [ ] Card "You still hold GH₵X": cash held (collected − fees you kept − deposited, from `AgentBalance`), tags "1 pending" (deposits not yet verified) and "12 orders" (orders in the held balance). Button "New deposit" (F-810).
  - [ ] Toggle Collections or Deposits.
  - [ ] Collections rows: customer, order number, date, amount, status (Pending, Draft, Verified, Reconciled). Words match the `CollectionStatus` enum states; "Approved" and "Deposited" show as Verified and Pending in the agent's words (GUESS: map; check).
  - [ ] Deposits rows: method (Cash, Bank transfer, MoMo), date, amount, status (Pending, Deposited, Reconciled, Rejected with the reject note, for example "receipt unclear").
  - [ ] After a deposit or a delivery, the numbers update at once (F-817).
  - [ ] The agent cannot change status of any row.
  - [ ] Currency is the store currency.
- Data: reads `AgentCollection`, `AgentDeposit`, `AgentBalance`. API: `GET /api/agent/me/cash`.
- Permissions: agent sees own.
- Edge cases and errors: a blocked agent sees "Your account is blocked until you deposit" (existing block rule).
- Tests: integration (balance equals collections − fees kept − deposits); e2e.

### F-810: New deposit with reference number
- Priority: P0. Milestone: M10.
- Description: The agent reports a deposit. The backend requires a unique reference number. The mockup has no field for it, so a real submit would fail (AG-10). Add the field.
- Current app: `POST /api/agent-reconciliation/deposits` (`referenceNumber` required and unique; `receiptUrl` must match a URL pattern; methods bank_transfer, cash, mobile_money, check). The current mobile form has the field.
- Mockup: `agent.html` (sheet "New deposit": Amount, How did you pay, Receipt photo, Notes). No reference field.
- Acceptance criteria:
  - [ ] Fields: Amount (default = cash held now, which is collected minus fees you kept; editable, above 0, not above cash held), How did you pay (chips Cash, Bank transfer, MoMo), Reference number (required), Receipt photo (take a photo), Notes (optional).
  - [ ] Reference number label: "Reference number (bank slip number, MoMo transaction ID, or the receipt number for cash)". Max 50 characters. Trimmed. Upper-cased.
  - [ ] The reference must be unique per tenant. A repeat shows "This reference was already used. Check the number on your slip." The database rule changes from global unique to unique per tenant (M0 tenant work).
  - [ ] Receipt photo uploads to storage; the form sends the stored URL (satisfies the URL rule). The photo is optional for cash and recommended for bank and MoMo (GUESS: should it be required for bank and MoMo? check with Finance).
  - [ ] Button "Submit deposit". Toast: "Deposit sent for checking". The deposit is `pending` until the finance clerk verifies it (Builder C, F-900 range).
  - [ ] The held balance does not drop until verification, but the Cash tab shows the pending deposit and tag "1 pending". The default amount of the next deposit subtracts pending deposits (cash held minus pending).
  - [ ] Submit is disabled while saving.
  - [ ] The sheet resets each time it opens.
- Data: `AgentDeposit.referenceNumber` unique per (tenantId, referenceNumber); add `tenantId`. API: `POST /api/agent/me/deposits` (wraps the reconciliation route).
- Permissions: agent for self.
- Edge cases and errors: amount above held: "You hold GH₵X. You cannot deposit more." Network failure keeps the form.
- Tests: unit (reference normalisation); integration (duplicate in the same tenant rejected, same reference in another tenant allowed; amount limit); e2e.

### F-811: Deposit method options
- Priority: P3. Milestone: M10.
- Description: The backend allows "check" as a method. The mockup shows Cash, Bank transfer and MoMo. Keep the three in the agent app.
- Current app: methods Mobile Money, Bank Transfer, Cash, Check in `MobileCollections`.
- Mockup: `agent.html` (three chips).
- Acceptance criteria:
  - [ ] The agent app offers Cash, Bank transfer, MoMo.
  - [ ] The API still accepts `check` for deposits entered by office staff. (GUESS: no agent uses checks; check history for any `check` deposits.)
- Data: none. API: none.
- Permissions: n/a.
- Edge cases and errors: none.
- Tests: component.

### F-812: Agent inbox and reply
- Priority: P1. Milestone: M9 (service), M10 (app).
- Description: The agent has an inbox for reminders, new deliveries, stock, payouts and team notes. The agent can reply to a note.
- Current app: none.
- Mockup: `agent.html#inbox`, sheet "Reply".
- Acceptance criteria:
  - [ ] Header: unread summary and "Mark all read". Rows grouped Today, Yesterday, Earlier.
  - [ ] Row types: reminder to deposit cash (link "Go to Cash"); customer moved delivery time ("Open delivery"); team note from the owner or a rep ("Open delivery", "Reply"); stock waiting ("Go to My stock"); new delivery ("Open delivery"); reward paid ("Reward paid: GH₵250 for September." link to Fees you kept, F-815).
  - [ ] Numbers in a reward row come from the books (F-815, F-816), not typed text.
  - [ ] Reply opens a sheet with a text field and "Send reply". Toast: "Reply sent to <name>". The reply is a comment in the order's team thread (Builder B1).
  - [ ] Opening a row marks it read. Back returns to the Inbox.
  - [ ] The agent sees only own items.
- Data: `Notification`, `Reminder`, `Thread`, `Comment` (Builder B1, F-550 range). API: shared inbox endpoints filtered by user.
- Permissions: agent own.
- Edge cases and errors: reply to a deleted thread: error "This note is closed."
- Tests: integration (reply creates a comment); e2e.

### F-813: More: profile, notification switches, sign out
- Priority: P2. Milestone: M10.
- Description: The More tab shows the agent's profile and notification switches. The switches use the one notification store (fix #9).
- Current app: `/m/settings` (the desktop Settings component reused).
- Mockup: `agent.html#more`.
- Acceptance criteria:
  - [ ] Profile card: name, "Delivery agent · town", phone. Edit of the phone number is allowed; name and role are read-only.
  - [ ] Switches: New orders, Reminders, Team messages, Reward updates. They read and write the same notification settings as Settings → Notifications and the Inbox (Builder B1/C). Defaults come from the role defaults.
  - [ ] Availability switch "Available for new orders" (file 07, F-709).
  - [ ] Change password link opens a simple form (Security, Builder A).
  - [ ] Sign out works and clears the session.
  - [ ] No language control (D1).
  - [ ] Footer shows the business name and app version.
- Data: user notification preferences. API: shared.
- Permissions: agent for self.
- Edge cases and errors: none.
- Tests: integration (switch persists; same store as Settings); e2e (sign out).

### F-814: Language switch
- Priority: n/a. Milestone: n/a.
- Description: Not built. The matrix verdict is DROP. D1, O3: English only. See F-800 for the one-file English strings rule.
- Current app: none. Mockup: `agent.html` (a language switch with placeholder strings in other languages).
- Acceptance criteria:
  - [ ] No language switch in the app. No other language text in the build.
- Data, API, Permissions, Edge cases, Tests: none.

### F-815: Fees you kept (agent earned fees)
- Priority: P0. Milestone: M10 (needs the delivery fee posting in M5, F-936).
- Description: The agent sees the delivery fees they earned and kept from the cash they collected (decisions F1 to F4). There is no "pay owed": the agent already holds the money and hands in the rest. Today earnings show only as a tile and as text in one inbox row (AG-15). Fees are booked once, when the outcome happens (F-936). Nothing is paid out through the payout form.
- Current app: "My Earnings" tile only (not posted to the books).
- Mockup: not in mockup (`agent.html` has no such screen). Build a "Fees you kept" page in the app style, opened from Home (a small link under the reward card) and from the Cash page.
- Acceptance criteria:
  - [ ] Card "Fees you kept GH₵X this month": lines Delivered (count × fee), Failed (count × fee), Returned (count × fee), Total fees kept.
  - [ ] Sample Kofi Appiah, fee rule GH₵25 per delivered and GH₵5 per failed (F-703 in file 07): 82 delivered × 25 = 2,050; 70 failed × 5 = 350. The sample agent-rate figures are removed.
  - [ ] Each line expands to the orders behind it (order number, date, fee).
  - [ ] The page shows how the deposit is worked out: cash collected, minus fees you kept, equals cash to hand in. The same number is the default amount in "New deposit" (F-810).
  - [ ] The label says "Fees you kept". No "pay owed" wording and no old pay-per-delivery wording appear anywhere (decision F1).
  - [ ] The fee comes from the agent's one fee rule. A change of rule does not change past orders.
  - [ ] A delivered order later returned: the delivered fee entry reverses and the returned fee from the rule applies (F-936).
  - [ ] Target reward is separate and paid after month close (F-816).
- Data: reads `Order.deliveryFee` and `AgentBalance`. No `CommissionEntry` for fees. No pay-rate field on the user.
- API: `GET /api/agent/me/fees`.
- Permissions: agent sees own.
- Edge cases and errors: no orders yet shows zeros. An agent with no fee rule sees fees 0 and a note "Ask the office to set your fee."
- Tests: unit (the Kofi sample); integration (return reverses; deposit default equals collected minus fees); e2e.

### F-816: Reward progress (agent)
- Priority: P1. Milestone: M10.
- Description: Home shows how close the agent is to the next cash reward. Tiers: 100% GH₵250; 120% GH₵400 plus a paid day off. There is no lower tier. The reward is earned at month close (G4). Tiers come from Settings → Rewards.
- Current app: none.
- Mockup: `agent.html#home` (hero and "Next reward" card). The mockup shows a chip "Reward now" with a lower tier and a row of three tiers. Remove the lower tier.
- Acceptance criteria:
  - [ ] Attainment = delivery success rate ÷ 60% (the role target). Sample Kofi 54 ÷ 60 = 90%.
  - [ ] "N deliveries away" = the number of extra consecutive successful deliveries needed to reach 100%: n = ceil((0.60 × closed − delivered) ÷ 0.40). Sample Kofi: closed 152, delivered 82: (91.2 − 82) ÷ 0.4 = 23. Text: "Deliver your next 23 orders to reach 100% and earn GH₵250."
  - [ ] For 120% the target rate is 72%: n = ceil((0.72 × closed − delivered) ÷ 0.28).
  - [ ] Above 100%, the card shows the next tier. At 120% or more it shows "Top reward reached".
  - [ ] Line: "The reward is paid after month close."
  - [ ] Attainment and tiers come from the same function as the Delivery leaderboard (Builder C): Esi 92%, Kofi 90%, Kwesi 90%, Logiswift 75%.
  - [ ] No text anywhere mentions a lower tier. Inbox rows about rewards say only "You reached 100% of your target" after month close.
  - [ ] Hidden for agents with no closed orders yet ("Your first results show after a few deliveries").
- Data: reads `RewardTier`, `Target`. API: `GET /api/agent/me/reward`.
- Permissions: agent own.
- Edge cases and errors: closed = 0 hides the card.
- Tests: unit (n for Kofi equals 23; rate already above 60); integration.

### F-817: Screen state stays current after each action
- Priority: P1. Milestone: M10.
- Description: In the mockup the sheets look stale: the Complete sheet ignores the fields, "Deposit sent" changes no number, and the header and Home counts differ. In the real app every action updates every screen that shows the number.
- Current app: n/a (mockup issue; fixes #16, #19, #27).
- Mockup: `agent.html` (sheets and counts).
- Acceptance criteria:
  - [ ] After Complete delivery: the list tab counts, Today card, cash held, collections list and reward card update without reload.
  - [ ] After Report failed: the same, plus the attempts list on the detail.
  - [ ] After Submit deposit: the Deposits list shows the new row as Pending and "1 pending"; the default amount for the next deposit drops by the pending amount.
  - [ ] After Confirm received: stock list, history, incoming card and Stock badge update.
  - [ ] Each bottom sheet resets its fields and errors when it opens or closes.
  - [ ] One text source: all counts in cards and in the inbox come from the API values, not typed strings (the mockup types "5 of 8", "GH₵2,900").
  - [ ] If another device changes data (office edits), the next focus or socket event refreshes the screen.
  - [ ] Where the admin app shows the AI drawer text for Deliveries, Products and Inventory, it is the one shared text source (fix #19; admin pages: files 06, 07).
- Data: none. API: all responses return updated counters.
- Permissions: agent.
- Edge cases and errors: stale write (order changed by office): show "This order changed. Reloaded."
- Tests: e2e (complete a delivery, check six numbers); component (sheet reset).

### F-818: Labels and ids in the agent app
- Priority: P2. Milestone: M10.
- Description: The agent app uses the same order number format, status words and customer data as every other screen (fixes #10, #11, #12).
- Current app: n/a.
- Mockup: `agent.html` (CA-482xx ids).
- Acceptance criteria:
  - [ ] One order number format app-wide (owned by Builder B1).
  - [ ] Agent statuses: To pick up, Out, Done, Failed map to `ready_for_pickup`, `out_for_delivery`, `delivered`, `failed_delivery`. "Rescheduled" is a failure reason that returns the order to To pick up.
  - [ ] Amounts for one order are the same on every screen.
- Data: none. API: none.
- Permissions: n/a.
- Edge cases and errors: none.
- Tests: component (label map).

---

## 3. Cross-area dependencies

| Need | Where | Used by |
|---|---|---|
| Transfer receive, disputes, `StockLevel` | F-654, F-651 in `06-products-stock.md` | F-807, F-808 |
| Stock decrement once at delivered | F-657 in `06-products-stock.md` | F-804, F-805 |
| Fee rules, attempts, delivery routes access, one path to delivered | F-703, F-713, F-716, F-720 in `07-deliveries.md` | F-805, F-806 |
| Cash held and oldest unpaid function | F-704 in `07-deliveries.md` | F-801, F-809 |
| Deposit verification, reconciliation, delivery fee posting (F1 to F4) | F-900 range (Builder C) | F-810, F-815 |
| Rewards setting, targets, month-close reward, delivery leaderboard | F-1100 and F-1200 ranges (Builder C) | F-816 |
| Delivery fee rule per partner (Settings), staff roles | F-703 in file 07; F-1150 range (Builder C) | F-815 |
| Inbox, reminders, threads, notification store | F-550 range (Builder B1) | F-812, F-813 |
| Order status service, order number format | F-300 range (Builder B1) | F-802, F-804, F-818 |
| Customers refusal rule (G6) | F-350 range (Builder B1) | F-806 |
| Messages: out-for-delivery message | F-450 and F-500 ranges (Builder B1) | F-804 |
| Auth, change password, tenant isolation | F-100 range (Builder A) | F-800, F-810, F-813 |

---

## 4. Coverage table

### 4.1 Section 1.16 Delivery agent app (16 rows)

| Matrix row | Covered by |
|---|---|
| AG-01 Home | F-801 |
| AG-02 Deliveries list | F-802 |
| AG-03 Delivery detail | F-803 |
| AG-04 Start delivery | F-804 |
| AG-05 Complete delivery | F-805 |
| AG-06 Report failed | F-806 |
| AG-07 Stock (list, history) | F-807 |
| AG-08 Confirm received stock | F-808 |
| AG-09 Cash | F-809 |
| AG-10 New deposit (reference number) | F-810 |
| AG-11 Deposit method "Check" | F-811 |
| AG-12 Inbox and reply | F-812 |
| AG-13 More | F-813 |
| AG-14 Language switch | DROP: matrix verdict DROP; D1, O3 English only (F-814 records it) |
| AG-15 Agent earnings (fees you kept) | F-815 |
| AG-16 Delivery-agent reward progress | F-816 |

### 4.2 Related rows

| Row | Covered by |
|---|---|
| §4 #1 Rewards in two places; lower tier chip (agent) | F-816 |
| §4 #9 Agent app has its own notification switches | F-813 |
| §4 #10 Order statuses differ per screen | F-818 |
| §4 #11 Order ID formats | F-818 |
| §4 #12 Same ID maps to different customers | F-818 |
| §4 #16 Agent Home "5 of 8" vs "3 of 8" | F-801, F-817 |
| §4 #19 Agent drawer text differs by page (stale text) | F-817 |
| §4 #25 Dead buttons (WhatsApp, Maps, Call, Sign out, Reply) | F-800, F-803, F-813 |
| §4 #27 Agent app: WhatsApp and Maps dead; fixed Call; other-language strings; no Earnings; reference number | F-803, F-810, F-814, F-815 |
| §3 #8 Agent deposit credits 1020 (accounting) | Not here: Builder C (F-900 range). F-810 only submits the deposit |
| IN-07, IN-10 (Inventory rows) | F-807, F-808 (rules: file 06) |
| Design §6 Delivery agent app row; delivery fee (F1 to F4, replaces G3) | F-800, F-815 |

Counts: matrix section 1.16 has 16 rows. This table covers 16 (15 by an F-ID, 1 DROP). Related rows: 12 (one points to Builder C). F-IDs in this file: 19 (F-800 to F-818).

## 5. Open items

1. Maps link has no coordinates (text search link). (F-803)
2. Offline mode is not built. Ask if agents work without network. (F-805)
3. Receipt photo required for bank and MoMo? (F-810)
4. Resolved (decision F2): failed-delivery fuel money is the failed fee in the partner's one fee rule (Kofi GH₵5). The agent keeps it from collected cash. (F-815)
5. Collection status words shown to agents. (F-809)
6. Conflict: `agent.html` shows Kofi's oldest cash as 4 days; Deliveries shows 3 days. RESOLVED (decision R1): one function feeds both; the mockup sample is illustration only.
7. Conflict: the deposit sheet has no reference field; the backend needs one. RESOLVED in F-810 (field added).
8. Conflict: `agent.html` Home has a lower reward tier and a chip about it. RESOLVED (decision D9): the tier is removed.
