# CodAdmin v2 mockups: screen and element inventory

Source: `/Users/mac/work/codadmin/docs/mockups/v2/*.html` (17 pages), read against `NUMBERS.md` and `DESIGN-SPEC.md`. Read-only inventory for the PRD. No mockup was changed.

Conventions
- Roles: Owner, Call rep, Delivery agent (person or 3PL), Finance, Marketer. In the mockups the Owner (Manny) holds Finance and Marketing too.
- "Dead" = the button has no handler in the mockup (no toast, no navigation).
- "Toast" = the button only shows a confirmation message ("Sample only").
- Link lines use the form `Link: source element → target screen`. Shared sidebar links are listed once in the shell section.
- Admin pages share one shell. Rep (`rep.html`) and delivery agent (`agent.html`) are separate role apps with their own shell.

---

## Shared shell (every admin page)
- Who: Owner, Finance, Marketer (admin app).
- Sidebar groups: Dashboard; Inbox (pill 5); Sell: Orders (pill 38), Customers, Checkout forms, Messages; Stock: Products, Inventory & stock, Deliveries; Money: Finance (pill 2), Marketing, Reports; Team: Targets, Leaderboard, Staff & roles; Setup: Workflows, Connections, Settings, Set up North Star.
- Store chip "Manny Dynamics, Ghana · 2 stores": dead (no store switcher anywhere). Me chip "Manny, Owner · all roles": dead.
- Top bar: search button (opens the command palette, ⌘K); dark-mode toggle; bell (dot) → Inbox; "Ask agent" button (opens agent drawer); avatar (dead).
- Agent drawer: header "CodAdmin agent, Read-only, sees your live data"; one sample Q&A ("Why are we behind on October?" with a tool line and 3 short paragraphs); two suggestion chips (dead); "Ask about orders, cash, stock or targets…" is a static box, not an input. Text differs per page (see Known issues).
- Command palette (⌘K): input; "Ask the agent" item ("How much cash is still with Logiswift?"); "Go to" Orders (G O), Leaderboard (G L), Targets (G T); "Actions" Record a 3PL payout, Start a stock count (both dead on every page). The key hints G O / G L / G T are labels only.
- "Mockup · sample data" pill bottom right.
- Link: sidebar Dashboard → Dashboard (index#dash)
- Link: sidebar Inbox and top-bar bell → Inbox (inbox.html)
- Link: sidebar Orders → Orders (index#orders)
- Link: sidebar Customers → Customers
- Link: sidebar Checkout forms → Checkout forms (list)
- Link: sidebar Messages → Messages (Conversations)
- Link: sidebar Products → Products
- Link: sidebar Inventory & stock → Inventory & stock
- Link: sidebar Deliveries → Deliveries
- Link: sidebar Finance → Finance (Overview)
- Link: sidebar Marketing → Marketing
- Link: sidebar Reports → Reports (Overview)
- Link: sidebar Targets → Targets (index#targets)
- Link: sidebar Leaderboard → Leaderboard (index#board)
- Link: sidebar Staff & roles → Staff & roles
- Link: sidebar Workflows → Workflows (list)
- Link: sidebar Connections → Connections
- Link: sidebar Settings → Settings (North Star & targets)
- Link: sidebar Set up North Star → North Star setup (index#onboard)
- Link: ⌘K "Go to" Orders / Leaderboard / Targets → Orders / Leaderboard / Targets
- No sidebar link reaches the rep app or the delivery agent app. They are reached only from Staff & roles.

---

# index.html (Dashboard, Orders, Targets, Leaderboard, North Star setup)

## Dashboard
- File: `index.html#dash`. Who: Owner (Finance and Marketer glance).
- Header: "Good evening, Manny"; "You need GH₵2,100 more delivered revenue today to stay on pace." Buttons: This month (dead), Download report (dead).
- Target ladder card
  - North Star 2026: GH₵1.38M of GH₵1,800,000; chips "3 pts behind the year's pace", "Margin 12% year to date · target 35%".
  - Q4 target: GH₵92k of GH₵540,000, 75 days left, tag Behind, progress bar with pace marker.
  - October target: GH₵92k of GH₵180,000, 14 days left, tag Off track.
  - Today's target: GH₵4.2k of GH₵6,300, 17 delivered so far, tag In progress.
- Today's targets card: header "On target 14 of 17 days this month"; three quests: New orders 64 of 58 (Hit); Delivered revenue GH₵4.2k of GH₵6,300 (67%); Failed delivery calls 6 of 15 done (40%).
- KPI tiles
  - Orders today 64: orders placed today; target 58; ▲18% vs last Friday.
  - Confirmation rate 71%: confirmed ÷ placed; target 70%.
  - Delivery success rate 48%: delivered ÷ closed; target 60%, yield 34%, ▼12 pts.
  - Cash still with agents GH₵23.4k: delivered cash not yet paid in; "38 orders over 8 days".
- Chart card "Delivered revenue vs target" (legend Delivered / Target pace; chart is a drawn placeholder). Drivers: Projected October GH₵164k (91% of target); Needed per day GH₵6.3k for 14 days; Biggest lever Delivery success, +5 pts = +GH₵22k.
- Agent card "Agent found 3 things" (updated 06:42), all buttons dead:
  - Logiswift paid GH₵840 less than its order list (11 Oct payout, 41 orders, 3 missing). Actions: Show the 3 orders, Dismiss.
  - Magic Groove stock is 12 units short (Logiswift 88 vs our 100). Actions: Start a stock count, Dismiss.
  - ₦41,000 Meta spend has no product (campaign MG_Oct_Retarget). Actions: Map to Magic Groove, Dismiss.
- Recent orders table: Order, Customer (initials, name, city), Status tag, Amount. 4 rows (#24117 to #24114). Button View all.
- Top this month: ranked list of 3 (Esi Badu 92%, Kofi Appiah 90%, Adwoa Darko 84% of target). Button Leaderboard.
- Link: Recent orders "View all" → Orders
- Link: Top this month "Leaderboard" → Leaderboard

## Orders (list)
- File: `index.html#orders`. Who: Owner; the same list is what Call rep and Finance work from (they have their own apps/pages).
- Header: "1,445 orders in October. The agent flags orders that need you." Buttons: Import (opens Import modal), Export (toast "Exported 1,445 orders to orders-17-oct.csv"), New order (opens New order drawer).
- Agent card (1): "9 new orders have no call rep". Actions: Assign all 9 to Adwoa (assigns every unassigned row, toast), Dismiss (dead).
- Tabs with counts: All 1,445; Pending confirmation 64; Confirmed 21; Preparing 41; Ready for pickup 38; Out for delivery 148; Delivered 376; Failed delivery 354; Returned 48; Cancelled 355; Unpaid by agent 38. (Confirmed + Preparing + Ready = 100 waiting to dispatch.)
- Filters: search box (order, phone or name; live); buttons Product, Agent, Assigned to, Flagged by agent (all dead).
- Bulk bar (shows when rows are ticked): "n selected"; Change status (menu of the 9 statuses); Assign to call rep (Adwoa Darko, Nana Kyei, Confirm agent); Assign to delivery agent (Kofi Appiah, Esi Badu, Kwesi Amoah, Logiswift, Kasapa Express); Delete (no confirmation); Clear selection.
- Table columns: select checkbox (and select all), Order (#id, date), Customer (initials, name, phone), Product (first item × qty, "+ n more"), Status (tag; optional red flag line such as "Re-delivery Tue 20 Oct", "Not paid after 11 days"; chips "Reminder 20 Oct, 16:00" and "4 replies"), Call rep (or "Unassigned"), Delivery agent (or "Unassigned" / "—"), Amount, Assign (icon).
- Row assign menu (icon): Call rep list; Delivery agent list; "Unassign both".
- Footer: "Showing n of N orders"; "Click a row to open the order". Empty state: "No orders match."
- Statuses used: Pending confirmation, Confirmed, Preparing, Ready for pickup, Out for delivery, Delivered, Cancelled, Returned, Failed delivery.
- Link: row click → Order details drawer
- Link: New order button → New order drawer
- Link: Import button → Import orders modal

## Order details drawer
- File: `index.html#orders` (side sheet). Who: Owner, Call rep (admin-side), Finance.
- Header: order number, "date · from Meta ad, checkout form", payment tag (Paid / Cash with agent / Overdue from agent / Pay on delivery / No payment).
- Order status: select with the 9 statuses (changes immediately, toast).
- Follow up: Set reminder button opens a popover: What (text, default "Call back about this order"), When (text, default "18 Oct, 09:00"), Who (select: Me, Adwoa Darko, Nana Kyei, Kofi Appiah), Cancel, Set reminder. Result is a chip "Reminder <date>" and a chip on the Orders row.
- Items: line per product (name, "GH₵ each", × qty, line total) and a Total row.
- Customer: name, phone with Call and WhatsApp buttons (dead), address, region.
- Payment: status tag, method "Cash on delivery", amount, "Cash held by" (agent name, "Paid in", or "Nobody yet").
- Assigned to: Call rep select (Unassigned + 3 reps), Delivery agent select (Unassigned + 5 partners); change applies at once.
- Timeline: order placed, confirmed, packed, ready, out for delivery, delivered/failed/returned/cancelled with times and notes; a planned re-delivery step where set.
- Call history: Log call button opens a form: Outcome (Confirmed, Rescheduled, No answer, Cancelled, Other), Called by (Manny, Adwoa Darko, Nana Kyei), Note; Cancel, Save call. List of past calls (outcome tag, caller, time, note). Empty state "No calls yet. Log the first one."
- Team notes: threaded notes with replies and @mentions; "n replies" chip; textarea "Write a note. Type @ to mention a teammate."; quick-mention buttons @Adwoa, @Nana, @Kofi; Post note ("Mentioned teammates get a notification"). Empty state "No notes yet."
- Footer: Close, Save changes (toast "Order #id saved").
- Link: "Open in Inbox" (team notes) → Inbox

## New order drawer
- File: `index.html#orders` (side sheet). Who: Owner, Call rep. Purpose: add an order by hand (phone call or WhatsApp).
- Customer: Customer name; Phone; Delivery address (textarea); Region (select: Greater Accra, Ashanti, Western, Central, Eastern, Volta, Northern); Town or area.
- Products: lines of Product (select of 4 products), Qty, Price (defaults from catalogue, editable), remove line; button Add product line.
- Price and status: Order total (GH₵, adds up from lines, editable for a discount); Status (9 statuses, default Pending confirmation); Call rep (Assign later); Delivery agent (Assign later).
- Footer: Cancel, Create order (adds #24118 at the top, toast).

## Import orders modal
- File: `index.html#orders` (modal). Who: Owner.
- Template row: "Start from the template" with Download template (CSV with columns customer_name, phone, address, region, product, quantity, price, status).
- Drop zone: "Drop a .csv, .xlsx or .xls file here or browse. Up to 2,000 rows."
- Result row (sample): meta-leads-17-oct.xlsx, 42 rows read, 40 ready, 2 need a fix. Fix list: row 17 phone has 9 digits; row 31 region "Ashante" is not a region.
- Footer: Cancel, Import 40 orders (toast "Imported 40 orders. They are in Pending confirmation.").

## Targets
- File: `index.html#targets`. Who: Owner (read by Call rep, Delivery, Marketer through their own pages).
- Header: "The North Star splits into quarters and months, with revenue and margin at each level." Buttons: Edit North Star, Add target (dead).
- Card "2026 North Star: GH₵1,800,000 delivered revenue at 35% margin"; tag "77% done · 3 pts behind · margin 12% of 35%".
- Quarter tree: Q1 GH₵372k of 360k (Revenue hit, Margin 11% of 35%; Jan 118k, Feb 121k, Mar 133k); Q2 GH₵421k of 420k (Revenue hit, Margin 12%; Apr 131k missed, May 142k, Jun 148k); Q3 GH₵497k of 480k (Revenue hit, Margin 12%; Jul 158k, Aug 166k 12%, Sep 173k 12%); Q4 GH₵92k of 540k (Behind, Oct margin −13% of 35%; Oct 92k −13%, Nov 180k, Dec 180k).
- Table "October targets by role" (collapsible groups): columns Who, Their target, Progress, Status, Reward at 100%.
  - Call reps (3 holders, role target 1,300 confirmed; 1,026 of 1,300, 79%, "48% of confirmed delivered"). Rows: Adwoa Darko 760 (640, 52% delivered, Ahead, GH₵300 bonus); Confirm agent AI 450 (328, 44%, Ahead, No payout); Nana Kyei 90 (58, 30%, Ahead, GH₵300 bonus). Line "Feeds October GH₵180k: confirmed orders × delivery success × GH₵249".
  - Delivery (5 holders, role target 60% delivery success; 48% now, 80% of target). Rows: Kofi 54% (82 delivered, On track, GH₵250); Esi 55% (48, On track, GH₵250); Kwesi 54% (26, On track, GH₵250); Logiswift 45% (220, Behind, "Contract review"); Kasapa Express trial (no closed orders, 8 out, Too early, No payout). Line "every +5 pts of delivery success adds about GH₵22k".
  - Marketing (1 holder, CPA under max CPA ₦7,040 at 34% yield; ₦5,903 now, ₦1,137 under). Row: Manny, On track, "—".
- Link: Edit North Star → North Star setup

## Leaderboard: Call reps
- File: `index.html#board`, tab Call reps. Who: Owner (reps see their own rank in rep.html My numbers).
- Header: role tabs Call reps 3, Delivery 4, Upsell 3; Period select (Today, This week, October, 2026). The select only relabels the period text; data does not change.
- Podium (2nd Confirm agent AI, 1st Adwoa, 3rd Nana): of target %, confirmed, confirmation rate; badge icons.
- Full ranking table: Rank, Staff, Of role target (bar + %), Confirmed, Confirmation rate, Delivered from confirmed. Adwoa 84% / 640 / 73% / 52%; Confirm agent 73% / 328 / 70% / 44%; Nana 64% / 58 / 58% / 30%.
- Rewards card: 80% GH₵100 airtime (Adwoa reached it); 100% GH₵300 bonus (no one yet); 120% GH₵500 + paid day off (no one yet). "Distance to the next tier": Adwoa 120 more confirmed to 100% (GH₵300); Nana 14 more to 80% (GH₵100); Confirm agent 32 more to 80%, "AI agents get no payout".
- Badges card: Top of month (Adwoa, September); Hit target 3 months running (Adwoa, Confirm agent); Beat target by 20% (locked, no one yet).

## Leaderboard: Delivery
- File: `index.html#board`, tab Delivery. Who: Owner (agents see their reward progress in agent.html Home).
- Podium: 2nd Kofi, 1st Esi, 3rd Kwesi: of target, success, days to pay (Kofi 1.8, Esi 2.4, Kwesi 3.1); badges.
- Ranking table: Rank, Agent, Of 60% target, Success, Days to pay, Delivered. Esi 92% / 55% / 2.4 / 48; Kofi 90% / 54% / 1.8 / 82; Kwesi 90% / 54% / 3.1 / 26; Logiswift 75% / 45% / 9.2 / 220.
- Rewards: 80% GH₵100 airtime (Kofi, Esi, Kwesi reached it); 100% GH₵250 bonus; 120% GH₵400 + paid day off. Distance rows ("12 more deliveries with no failure to 100%" for Esi; 23 for Kofi; 7 for Kwesi; Logiswift "30 more to 80%. Companies get no bonus").
- Badges: Top of month (Kofi, September); Hit target 3 months running (Kofi); Beat target by 20% (locked); Zero unpaid over 8 days (Kofi, Esi, Kwesi).

## Leaderboard: Upsell
- File: `index.html#board`, tab Upsell. Who: Owner (rep sees rank in rep.html My numbers).
- Ranking table: Rank, Staff, Upsell rate, Extra value (delivered), Reward earned. Adwoa 24% / GH₵6,100 / GH₵610; Confirm agent 15% / GH₵2,200 / No payout; Nana 9% / GH₵300 / GH₵30; All reps 20% / GH₵8,600 / GH₵640.
- Card "How the reward works" (separate from the target): Reward 10% of the extra value added; Paid when the order is delivered; AI agents no payout; Packages 1 set GH₵249, 2 sets GH₵449, 3 sets GH₵629; Add-ons pens GH₵40, grip trainer GH₵35, guide GH₵59.

## North Star setup (wizard)
- File: `index.html#onboard`. Who: Owner (first-run wizard and the only place to edit the North Star).
- Step rail: Your store (done), Connect your 3PL (done), Set your North Star (current), Driver targets, Invite your team, Rewards. Steps 4 to 6 have no screen in the mockup.
- Fields
  - Annual North Star (delivered revenue): money input, GH₵1,800,000.
  - How should it grow?: segmented Even each month / Grow each quarter (selected) / Custom. Changing it does not change the tiles.
  - Quarter split tiles (read-only): Q1 GH₵360k (120k a month), Q2 GH₵420k (140k), Q3 GH₵480k (160k), Q4 GH₵540k (180k).
  - Driver: Average order, GH₵249 input, hint "Magic Groove today".
  - Driver: Confirmation rate, 70% input, hint "call rep or AI agent".
  - Driver: Delivery success rate, 60% input, hint "delivery target. Now 48%".
- Calculated tiles (live): "Orders a day you need" 58 (GH₵180k ÷ AOV ÷ confirmation ÷ success ÷ 30 days); "Max cost per order (moves with the yield)" ₦8,700 (₦20,720 profit per delivered order × 42% yield). GH₵180k and ₦20,720 are fixed in the code.
- Footer: Back (dead), Save and set driver targets (dead).

---

# rep.html (Call rep app: Today, Queue, My orders, Earnings, My numbers, Inbox)

Shell: left rail on desktop / bottom tab bar on phone with Today, Queue (pill = pending count, 9), My orders, Earnings, Numbers; top bar with "Back to CodAdmin", dark mode, bell (unread count) → Inbox, avatar "AD". Inbox is not in the rail or tab bar. Who: Call rep (Adwoa Darko in the sample).
- Link: top bar "Back to CodAdmin" → Dashboard (index.html)
- Link: bell → Rep Inbox

## Rep Today
- File: `rep.html#today`. Who: Call rep.
- Hero "Confirmed today" 19 of 25 (today's share of 760 ÷ 31 days) with progress bar; updates when a call is saved as Confirmed.
- Next reward card: tag "120 more to GH₵300"; 640 of 760 confirmed in October; bar; tier row 80% GH₵100 airtime (reached), 100% GH₵300 bonus (next, "120 more"), 120% GH₵500 + paid day off.
- KPI tiles: Confirmation rate 73% (confirmed ÷ assigned, target 70%); Delivered from my confirmed 52% (253 delivered of 486 closed); Time to first call 12 min (median, October).
- Agent suggestion cards (built live from the queue): "<name> is waiting for your call" (call back is N minutes late) with Open order; "N customers did not pick up" with Send WhatsApp (toast).
- Link: agent card "Open order" → Rep Queue (Call backs tab, call card open)

## Rep Queue (with call card)
- File: `rep.html#queue`. Who: Call rep.
- Header: "Orders waiting for your call. 9 waiting · oldest 2 h 35 min." (live).
- Tabs with counts: Pending (9), Call backs (3), Re-delivery (2). Search "Name, phone, area or order #".
- List rows: wait timer (Pending: "Waiting 2 h 20 min", coloured gold/coral by age; Call backs: "In 25 min" or "Overdue 18 min"; Re-delivery: "Failed 16 Oct"), customer name, sub line (area · package + add-ons · order value), quick buttons Call (tel link), WhatsApp (wa.me link), Open order.
- Empty states: "Queue is clear. New orders appear here as they come in." / "Nothing here. Try another tab."
- Call card (right panel; full screen on phone with a back button): name, order id, area, status tag, Order value (live); buttons Call, WhatsApp, Team notes; re-delivery hint on Re-delivery orders ("Kofi Appiah could not reach him…"); Customer block (phone, alt phone, email, address, payment "Cash on delivery · unpaid", assigned rep and delivery agent); Order block (package line, add-on lines, "Cash to collect"); Previous orders (date, amount, Delivered/Failed) or "First order from this customer."; Call history (outcome tag, time, rep, note, length).
- "How did the call go?" outcomes: Confirmed, Not reachable, Call back later, Declined, Wrong number.
  - Confirmed: optional "Change the order": package tiers 1 set GH₵249, 2 sets GH₵449 (saves GH₵49), 3 sets GH₵629 (saves GH₵118); add-ons Refill pens +GH₵40, Pencil grip trainer +GH₵35, Smart Parent's guide +GH₵59; live earn box "You earn GH₵X extra if this order is delivered (10% of GH₵Y)" or "No extra value added. You still earn GH₵8 if it is delivered." On Re-delivery and My orders the order is not editable (note for the delivery agent only).
  - Not reachable: "Logs this attempt. The order stays in your queue."
  - Call back later: chips In 30 min, In 1 hour, Today 16:00, Tomorrow 09:00, or a time input; moves the order to the Call backs tab.
  - Declined: reason chips Price too high, Prank or ordered by mistake, Changed mind, Bought elsewhere, Other (required).
  - Wrong number: "Marks this number as wrong."
- Fields: Call note (textarea), Call length (sec, optional).
- Save button label follows the outcome ("Save as confirmed", "Save, not reachable", "Save call back", "Save as declined", "Save, wrong number"); disabled until an outcome (and time/reason where needed) is picked. After saving, the next order opens and a toast shows (for Confirmed: "You earn GH₵8 if delivered" or "GH₵8 + extra").
- Link: Team notes button → Rep Inbox (Team notes thread)
- Link: Call / WhatsApp buttons → phone dialer / wa.me (external)

## Rep My orders
- File: `rep.html#orders`. Who: Call rep.
- List of orders already handled, search box, same list and call-card layout. Statuses seen: Out for delivery, Delivered, Waiting to dispatch, Failed, Declined. Call card is read-mostly (history, previous orders, note field); no package editing.
- Link: Team notes button → Rep Inbox (Team notes thread)

## Rep Earnings
- File: `rep.html#earnings`. Who: Call rep.
- Card "You are owed GH₵2,034" with lines: Commission 253 delivered × GH₵8 = GH₵2,024; Upsell reward 10% of GH₵6,100 extra value = GH₵610; Paid on 9 Oct (October commission) − GH₵600; Owed now GH₵2,034. Note "154 of your confirmed orders are still open, each adds GH₵8 when delivered." Target reward line: GH₵300 at 760 confirmed (100%), tag "640 of 760".
- Payment history table: Date, Amount, Status, For. 9 Oct GH₵600 Paid October commission; 1 Oct GH₵840 Paid September balance. Header "2 payments · GH₵1,440 paid".

## Rep My numbers
- File: `rep.html#numbers`. Who: Call rep.
- KPI row: Confirmed 640 (target 760); Confirmation rate 73% (target 70%); Delivered from confirmed 52% (253 delivered); Upsell rate 24% of your orders; Extra value added GH₵6,100 on delivered orders; Time to first call 12 min (median).
- Ranks: Rank in call reps 1st of 3; Rank in Upsell 1st of 3.
- "Where my 640 confirmed orders are": stacked bar Delivered 253, Failed or returned 233, Still open 154.
- "My calls": Today 41, This week 480, This month 1,360, Average a day 80.
- "Call outcomes this month": Confirmed 640, Not reachable 300, Declined 190, Call back 150, Wrong number or other 80.
- "Calls a day, last 14 days" bar chart ("Today is still counting").

## Rep Inbox
- File: `rep.html#inbox`. Who: Call rep.
- Header: unread summary; Mark all read.
- Tabs: All, Reminders, Team notes (unread counts).
- All / Reminders: grouped Today / Yesterday / Earlier rows, each with a title, detail and a link: Call back <name> (reminder, link "Open call card"); WhatsApp reply from a customer ("Open call card"); Order moved to you ("Open call card"); "Delivered: <name>. You earned GH₵28" ("Open in My orders"); "Failed: <name> refused the order" ("Open re-delivery call"); "You reached 80% of your target … GH₵100 airtime earned" ("Open Earnings"); "Payout paid: GH₵600" ("Open Earnings"); team note from Kofi or Manny ("Open note"). Empty state "Nothing here. You are caught up."
- Team notes tab: thread list (Abena Owusu CA-48213; Yaw Mensah CA-48220) with unread dots; thread pane (title, status tag, Open call card), messages, Write a reply + Send.
- Link: row links "Open call card" / "Open in My orders" / "Open re-delivery call" → Rep Queue or Rep My orders (call card open)
- Link: row links "Open Earnings" → Rep Earnings
- Link: row link "Open note" and Team notes tab → Rep Inbox (Team notes thread)
- Link: thread "Open call card" → Rep Queue / My orders

---

# agent.html (Delivery agent phone app)

Phone frame with bottom tabs Home, Deliveries (badge 3), Stock, Cash, More. Header bell on Home → Inbox. Who: Delivery agent (Kofi Appiah, Kumasi, in the sample). Language switch English / Twi / Ga (Twi and Ga strings are placeholders). Top strip links "Back to CodAdmin".
- Link: page header "Back to CodAdmin" → Dashboard (index.html)

## Agent Home
- File: `agent.html#home`. Who: Delivery agent.
- Today card: "3 left", "5 of 8 delivered", bar; button Go to deliveries.
- Hero: "Your October target" 90% of target; 54% delivery success, target 60%; chip "Reward now: GH₵100 airtime".
- Next reward card: "23 deliveries away", "Deliver your next 23 orders to reach 100% and earn GH₵250"; tier row 80% GH₵100 airtime, 100% GH₵250, 120% GH₵400 + day off.
- Cash you hold GH₵2,900 (12 orders collected, oldest 4 days) with button Deposit.
- "From the team" (3 new): Manny 08:40 "Please collect from Abena today."; Reminder 14:00 "Deposit cash before the bank closes."; Adwoa yesterday "Yaw Mensah confirmed. Call before you go."
- Link: Go to deliveries → Agent Deliveries
- Link: Deposit → Agent Cash
- Link: bell → Agent Inbox

## Agent Deliveries
- File: `agent.html#deliveries`. Who: Delivery agent.
- Header summary "3 of 8 delivered today"; search "Name, phone, area, order #"; tabs All 8, To pick up, Out, Done, Failed (with counts).
- List cards: customer name, "area · order id", COD amount, status tag (To pick up / Out / Done / Failed). Empty: "No orders here."
- Link: delivery card → Agent Delivery detail

## Agent Delivery detail
- File: `agent.html#detail`. Who: Delivery agent.
- Header: back, name, "order · area", status tag. Progress steps Picked up, Out for delivery, Delivered.
- Buttons: Call (tel link to a fixed number), WhatsApp (dead), Maps (dead).
- Cards: Deliver to (address, phone); items (1 × copybook set GH₵249, optional 1 × Refill pens GH₵40) and "Cash to collect"; Past attempts (date, reason, note) or "No failed attempts."
- CTA by state: To pick up → Start delivery (marks Out, toast); Out → Complete delivery, Report failed; Done/Failed → none.
- Link: back → Agent Deliveries (or Agent Inbox if opened from there)
- Link: Complete delivery → Sheet: Complete delivery
- Link: Report failed → Sheet: Report failed

## Agent sheet: Complete delivery
- Fields: Who received it (text); Cash collected (GH₵, default = COD amount); Photo (Take a photo, toggles to "Photo added"). Button Confirm delivered (marks Done, toast "Delivered. Cash added to your balance.").

## Agent sheet: Report failed
- Reason chips: Not reachable, Refused, Wrong address, Rescheduled (one selected); Note (textarea "Add details for the team"). Button Report failed (adds a past attempt, toast).

## Agent Stock
- File: `agent.html#stock`. Who: Delivery agent.
- Header "My stock, 99 units on hand".
- Incoming stock card (tag "n to confirm"): per item product, "Sent by Manny · 17 Oct", quantity, button Confirm received. Empty: "Nothing waiting. Stock sent to you shows up here."
- Stock list: Copybook set (MG-CB-SET) 36; Refill pens 18; Grip trainer 45.
- History (last 7 days) with tabs All, Allocated, Delivered, Transferred, Returned, Adjusted, Received; rows: type · product, reference, date, quantity (+20 allocated 14 Oct, −1 delivered ×2, −5 transferred to Esi, +1 returned, −2 adjusted).
- Link: Confirm received → Sheet: Confirm received

## Agent sheet: Confirm received
- Fields: Units received (number, default = units sent); if fewer than sent: "Short by n" message and required Reason chips Short in package, Damaged, Not received. Button Confirm received (adds to on-hand, logs "Received" with the short note, toast).

## Agent Cash
- File: `agent.html#cash`. Who: Delivery agent.
- Card "You still hold GH₵2,900", tags "1 pending", "12 orders"; button New deposit.
- Toggle Collections / Deposits. Collections rows: customer, order id, date, amount, status (Pending, Draft, Verified, Reconciled). Deposits rows: method (Cash, MoMo, Bank transfer), date, amount, status (Pending, Deposited, Reconciled, Rejected "receipt unclear").
- Link: New deposit → Sheet: New deposit

## Agent sheet: New deposit
- Fields: Amount (GH₵, default 2,900.00); How did you pay (chips Cash, Bank transfer, MoMo); Receipt photo (Take a photo of the receipt); Notes (optional). Button Submit deposit (toast "Deposit sent for checking").

## Agent Inbox
- File: `agent.html#inbox` (from the Home bell). Who: Delivery agent.
- Header: unread summary, Mark all read. Rows grouped Today / Yesterday / Earlier: Reminder to deposit cash (link "Go to Cash"); "Abena Owusu moved her delivery time" (Open delivery); team note from Manny (Open delivery, Reply); "20 copybook sets are waiting for you" (Go to My stock); two "New delivery" rows (Open delivery); note from Adwoa (Open delivery, Reply); "Payout paid: GH₵800 … GH₵184 is still owed for your 82 deliveries".
- Reply opens a sheet.
- Link: row "Open delivery" → Agent Delivery detail
- Link: row "Go to Cash" → Agent Cash
- Link: row "Go to My stock" → Agent Stock
- Link: Reply → Sheet: Reply

## Agent sheet: Reply
- Field: Your reply (textarea). Button Send reply (toast "Reply sent to <name>").

## Agent More
- File: `agent.html#more`. Who: Delivery agent.
- Profile card (Kofi Appiah, Delivery agent · Kumasi, phone).
- Notification switches: New orders, Reminders, Team messages (on); Reward updates (off).
- Language: English / Twi / Ga (changes the incoming-stock and inbox strings only).
- Sign out (dead). Footer "CodAdmin · Manny Dynamics".
- Not present in the app: an Earnings/pay screen (pay owed shows only as text in an inbox row).

---

# inbox.html, customers.html, checkout-forms.html, messages.html

## Inbox: feed (All, Mentions, Alerts, Done)
- File: `inbox.html` (default `#all`; also `#mentions`, `#alerts`, `#done`). Who: Owner (also Finance, Marketer).
- Header buttons: Mark all read; New reminder (opens Reminders view with the form focused); Notification settings (opens Notification settings view).
- Left rail views with unread counts: All, Mentions, Assigned to me, Reminders, Team threads, Alerts, Done.
- Agent card (All only): "The GH₵840 Logiswift shortfall has no owner". Actions: Remind me Monday 09:00 (opens Reminders with the form pre-filled: what, linked payout, date 19 Oct), Start a team thread (opens Team threads).
- Feed rows grouped Today / Yesterday / Earlier. Each row: unread dot, icon by type (order, money, stock, target, reply, agent, mention, assign), bold title, link to the source, "who · time", red "Alert" tag. Row hover actions: Open (link), Mark done (or Move back), Snooze (menu: 1 hour, This evening 17:00, Tomorrow 09:00, Monday 09:00), Set reminder (opens Reminders pre-filled). Header shows view title and count. Empty state: "Nothing here. You are caught up."
- Sample items (14): Logiswift payout short GH₵840; Kofi mentioned you (#24114 thread); Delivery failed #24114 (brother refused); Order assigned to you: approve a GH₵30 discount (#24120); Abena Owusu replied; Magic Groove 12 short at Logiswift; Adwoa reached 80% (640 of 760) and "earns the GH₵100 airtime tier"; 38 orders unpaid over 8 days (GH₵23.4k); finding: Accra Central delivery success 18%; Efua Mensah replied; #24071 delivered; Kasapa Express accepted 5 trial orders; Re-count at Kofi matched 36 (done); September Logiswift payout matched (done).
- Link: payout alert → Finance
- Link: mention row → Inbox Team threads (order #24114 thread)
- Link: order rows (#24114, #24120, #24071) → Orders
- Link: customer reply rows → Messages (Conversations)
- Link: stock alert and re-count rows → Inventory & stock
- Link: unpaid alert → Finance (cash with agents)
- Link: target row → Targets
- Link: finding row and Kasapa row → Deliveries
- Link: agent card "Remind me Monday 09:00" and row "Set reminder" → Inbox Reminders
- Link: agent card "Start a team thread" → Inbox Team threads

## Inbox: Reminders
- File: `inbox.html#reminders`. Who: Owner and any teammate who receives a reminder.
- Agent card: "3 reminders are overdue; 2 are Kofi's". Actions: Nudge Kofi on WhatsApp (toast), Reschedule all to tomorrow (dead).
- Lists: Overdue, Today, Upcoming, Done (10 sample reminders). Row: tick button (complete/reopen), text, "<by> set for <to>", linked item (link, dead `#`), channel icons, repeat tag, due "Fri 16 Oct, 17:00" with "Overdue by 1 day", Snooze button (moves to Upcoming, 18 Oct 09:00).
- New reminder form: What (text); Linked item (None, Order #24114 · Yaw Boateng, Order #24098 · Abena Owusu, Customer · Efua Mensah, Payout · Logiswift 1–15 Oct, Product · Magic Groove copybook set); Due date; Time; Repeat (Does not repeat, Every day, Every week, Every month); For (Me / A teammate + select Kofi, Esi, Kwesi, Adwoa, Nana); Notify by chips In-app, WhatsApp, Email, SMS; button Create reminder.

## Inbox: Team threads
- File: `inbox.html#threads`. Who: Owner and all teammates.
- Thread list (4): Order #24114 · Yaw Boateng (2 unread); Delivery team (general, 4 members); Payout · Logiswift 1–15 Oct; Product · Magic Groove copybook set. "New" button (dead).
- Thread pane: title, member avatars, "Open item"/"Open members" button (dead), context chips (e.g. Delivery failed · refused, GH₵249 · 1 copybook set, Re-delivery Tue 20 Oct), messages with attachment, reactions, Reply link, "Seen by".
- Composer: textarea ("Type @ to mention a teammate"); Attach (dead); Mention (opens @ list: Kofi, Esi, Kwesi, Adwoa, Nana); "Set reminder from this message" (opens Reminders pre-filled with the thread linked); Send.
- Link: "Set reminder from this message" → Inbox Reminders

## Inbox: Assigned to me
- File: `inbox.html#assigned`. Who: Owner.
- Table: Item, Assigned by, Due, Status, Action. 4 sample rows: Approve GH₵30 discount (Order #24120, Kofi, Today 12:00, Due soon); Call customer about a wrong address (#24131, Nana, Sun 18 Oct); Pay Adwoa's GH₵100 airtime reward (Target reward · Call rep 80%, CodAdmin agent); Record Kasapa Express trial payout (Esi, Overdue). Row buttons: Open order / Open reward / Open payout (dead), Done (dead).

## Inbox: Notification settings
- File: `inbox.html#settings`. Who: Owner (role defaults are set by the Owner; each person edits their own).
- Agent card: "Kwesi gets no alert when a payout is short". Actions: Turn on for Delivery (dead), Ignore (dead).
- Switch "My alerts / Role defaults".
- My alerts matrix (events × In-app, WhatsApp, Email, SMS): Order assigned to me; Delivery failed; Customer replied; Mentioned in a thread; Reminder due; Payout short or late; Stock gap; Target milestone ("80%, 100% or 120% reached"); Agent finding.
- Role defaults matrix (Call rep, Delivery, Finance clerk, Marketing × the same 4 channels) with button Apply to team (dead).
- Quiet hours card: switch on; From 21:00; To 07:00; switch "Still send short payouts and failed deliveries".
- Digest and nudges card: Daily digest switch; Send at 08:00; Send by (WhatsApp / Email); "Remind me if not done after" (4 hours, 1 day, 2 days, Never).

## Customers
- File: `customers.html`. Who: Owner, Call rep (admin-side).
- Header buttons: Export (dead), Add customer (dead).
- KPI tiles: Total customers 6,420 (+312 in Oct); First-time 4,980 (78%, 1 order); Repeat customers 1,440 (22%, 2 or more orders); Blocked for refusing delivery 23 ("Refused 3 times", COD off).
- Agent card (2): "9 customers refused 2+ deliveries" (Ask for prepayment, Show the 9); "212 repeat customers have not ordered in 60 days" (Draft the offer, Dismiss). All dead.
- Tabs with counts: All 6,420; Repeat 1,440; First-time 4,980; Refused before 612; Not reachable 318 (filter the 11 sample rows).
- Filters: Search name or phone, City, Risk, Flagged by agent (all are buttons, dead).
- Table columns: Customer (initials, name, phone), City, Orders, Delivered, Refused, Delivered value, Last order, Risk (Low / Watch / High; extra tags Not reachable, Blocked). Footer "Showing 11 of 6,420 customers" and risk rule "low means no refusals, watch means 1, high means 2 or more". Rows are not clickable (no customer detail screen).

## Checkout forms: list
- File: `checkout-forms.html` (list view). Who: Owner, Marketer.
- Header button: New form.
- KPI tiles: Forms 4 (3 live); Orders from forms in October 1,445; Visit to order 6.8% (21,250 visits); Most picked package "2 sets" 47% of orders.
- Agent card (2): "The 3 set package is picked by only 9%" (Test GH₵599 opens the editor Packages tab, marks unsaved); "Mobile converts at 5.9%, desktop at 9.4%" (Move it up opens the editor Fields tab).
- Table columns: Form (name, product), Link (`/form/<slug>` + copy button), Orders this month, Conversion, Active (switch), Actions (Clone, Preview, Edit, Delete). Rows: Magic Groove copybook set (1,198, 7.4%); Magic Groove, Meta retargeting (142, 9.1%); Home study guide (63, 4.2%); Refill pens (42, 5.0%, off).
- Clone copies fields, packages, upsells and design; the copy starts off. Delete asks for confirmation (browser confirm).
- Link: Edit / row action → Checkout form editor
- Link: Preview → Checkout form preview modal
- Link: New form → Checkout form editor (blank)
- Link: agent card "Test GH₵599" → Checkout form editor (Packages)
- Link: agent card "Move it up" → Checkout form editor (Fields)

## Checkout form editor
- File: `checkout-forms.html` (editor view). Who: Owner, Marketer.
- Header: Forms (back), form name, "Unsaved changes" tag; buttons Copy link, Copy embed code (iframe snippet), Save form (enabled only when changed).
- Left tabs: Basics, Fields, Packages, Upsells, Payment, Tracking, Design. Right: live preview with Mobile / Desktop toggle (updates with every change).
- Basics: Form name; Product (4 products); Link (`pay.codadmin.com/form/` + slug); Description; Default country (Ghana, Nigeria); Thank you page (URL, empty = built-in); Embed on your site (allowed domains, one per line, sample `trustcartgh.com`).
- Fields: list of fields (label, type · "sends to" target, width tag, edit icon). Sample: Full name, Phone number, WhatsApp number, Delivery address, City or town, Region. Edit popover: Label; Sends to (Customer name, Phone, Alternate phone, Address, City, Region, Email, Order notes, Custom field only); Required switch; Width Full/Half; Remove; Done. Add a field types: Text input, Email, Phone number, Number, Text area, Dropdown, Checkbox, Multi select, State.
- Packages: table Sets, Name, Discount (GH₵), Final price (sets × GH₵249 − discount), Badge, Default (radio), remove; button Add package. Sample: 1 set; 2 sets (discount 49, "Best deal", default); 3 sets (discount 118).
- Upsells: switch on; Product (Magic Groove refill pens / Pencil grip trainer); Price (GH₵40); Headline ("Add 5 refill pens"); a second upsell (Pencil grip trainer GH₵35, off); button Add upsell (dead). Hint "35% of copybook buyers also buy pens".
- Payment (max two methods on): Cash on delivery; Pay a deposit (Paystack) with % paid online (30); Pay in full (Paystack, "Needs your Paystack keys in Connections").
- Tracking: Facebook Pixel ID (482915073361842); Google Analytics 4 ID; Meta Conversions API access token (shows Connected); Meta test event code; TikTok Pixel ID; Google Tag Manager ID.
- Design: Primary and button colour (5 swatches); Button shape (Square / Rounded / Pill); Button size (S / M / L); Button style (Flat / Outlined / Filled); Button label ("Place order"); Show order summary switch; Offer position (Top / Bottom).
- Link: Forms (back) → Checkout forms list
- Link: Payment tab text "Paystack keys in Connections" → Connections (text only, not a link)

## Checkout form preview modal
- File: `checkout-forms.html` (modal from the list). Customer-facing form preview in a mobile frame (title, packages, fields, add-on, summary, payment buttons, Place order); close button.

## Messages: Conversations
- File: `messages.html` (`#p-conv`, default). Who: Owner, Call rep, Marketer.
- Header buttons: Workflows (link), New bulk send.
- KPI tiles: Messages sent in October 2,860 (1,940 WA · 920 SMS, GH₵312); Delivered 94% (63% of WhatsApp read); Customer replies 312 (reply rate 11%, 14 not answered); Failed today 9 (6 no WhatsApp · 3 network, Resend).
- Agent card (3): "14 customers replied and nobody answered" (Show the 14; Give them to Adwoa, toast); "6 WhatsApp messages went to numbers without WhatsApp" (Resend 6 as SMS opens Failed filter; Dismiss); "41 Delivery tomorrow reminders go out at 17:00" (See what goes out opens Scheduled).
- Page tabs: Conversations 38, Bulk send, Campaigns 6, Templates 8, Opt-outs 27.
- Inbox pane filters: status switch All / Unreplied / Failed / Scheduled 41; channel chips All channels, WhatsApp, SMS.
- Thread list: customer, last message, time, channel, order number, tag Replied/Failed. Empty: "No conversations match."
- Thread pane: customer header (name, phone · city · channel); Set reminder popover (What, When select Today 17:00 / Tomorrow 09:00 / 18 Oct 09:00 / Pick a time, Who Me / A teammate); bubbles with status (Sent, Delivered, Read, Failed, Replied, "by <team member>"); failed note with "Resend as SMS" / "Try again" (toast); compose row: channel switch WhatsApp/SMS, Insert template (dead), reply input, Send.
- Side pane: Linked order (number, status, product, delivery partner, Open order); Assigned to (Adwoa Darko, Nana Kyei, Manny); Customer (phone, region, orders, messages channel); Team notes (link with "n replies" or "Add a note").
- Link: Workflows button → Workflows
- Link: Open order → Orders
- Link: Team notes link → Inbox
- Link: agent card "See what goes out" → Messages Scheduled view

## Messages: Scheduled
- File: `messages.html#sched`. Who: Owner.
- Table: Goes out, Workflow (link), Template, Channel, Customers, Status (Scheduled / Paused), Actions (Preview expands message and recipients, Pause/Resume). 5 sample rows (Delivery tomorrow 41, Missed call follow-up 17, Out for delivery 22, Review request 63, Reorder pens 118). Note: opted-out customers are removed; "Edit when and to whom in Workflows".
- Link: Workflow name and note → Workflows

## Messages: Bulk send
- File: `messages.html#bulk`. Who: Owner, Marketer.
- Fields: Channel (SMS via Arkesel sender ID MagicGroove / WhatsApp from +233 24 555 0100 / Email via SendGrid); Message source (Use a template + template select / Write my own); Email subject (email only); Text (insert tags: Customer name, Store name, Customer email, Unsubscribe link); Custom link (WhatsApp only); Who gets it: Region (All regions, Greater Accra, Ashanti, Western, Central, Northern), Bought (Any product, Copybook set, Refill pens, Pencil grip trainer, Home Study Guide), Has ordered before (Anyone / Yes, bought again / No, one order only).
- Summary card: Will be sent to (count), Match your filters, Removed: opted out, Parts per message (SMS), Cost estimate (SMS GH₵0.06 per part, WhatsApp GH₵0.15, email free), Expected orders (1.1% average), phone preview ("Preview as Ama Mensah"), character count hints.
- Buttons: Send now, Schedule, Send a test to me (all toast "Sample only").

## Messages: Campaigns
- File: `messages.html#camp`. Who: Owner, Marketer.
- Filters: channel, status, date selects. Table: Campaign, Channel, Date, Sent, Delivered, Read, Replied, Failed, Orders after (orders from the same customers within 3 days, with GH₵ value). 6 rows (Reorder pens 15 Oct, Back to school copybook offer, Kumasi delay apology, Guide giveaway, Missed-call win-back Accra, Weekend flash sale draft with "Finish and send").
- Link: draft "Finish and send" → Messages Bulk send

## Messages: Templates
- File: `messages.html#tpl`. Who: Owner.
- Grid of 8 template cards (name, channel tag, body with {{tags}}, where used, Edit, Use in bulk send); button New template.
- Link: "Use in bulk send" → Messages Bulk send
- Link: Edit / New template → Template modal

## Messages: Template modal
- Fields: Template name; Channel (WhatsApp / SMS / Email); Message body with insert tags (Customer name, Order number, Order total, Store name). Buttons Cancel, Save template (toast).

## Messages: Opt-outs
- File: `messages.html#opt`. Who: Owner.
- Search by name or phone; table Customer, Region, Opted out (date), Reason (Replied STOP, Unsubscribe link, Asked on a call), SMS off (switch), WhatsApp off (switch). "Showing 8 of 27".

---

# products.html, inventory.html, deliveries.html

## Products: list
- File: `products.html` (tab Products). Who: Owner (Finance for cost; Stock keeper if filled).
- Header buttons: Add shipment (opens Add shipment modal), Add product (opens Product drawer, empty). Page tabs: Products 6; Incoming shipments (3 pending).
- KPI tiles: Active products 4 (2 archived); Best seller this month "Copybook set" (328 delivered); Average margin 66% (after product cost, before delivery); Low stock 2 (under 14 days of cover).
- Agent card (2): "Refill pens sell with 35% of copybook orders" (Make a bundle, Dismiss: dead); "The copybook set runs out in 7 days" (See the shipment → Incoming shipments tab; Dismiss).
- Tabs: Active 4, Archived 2, All 6 (default).
- Table columns: Product (expand chevron, image, name, note), SKU, Price, Cost, Margin, Stock (units + days of cover), Delivered in Oct, Delivery success, Status (Low stock / Active / Digital / Archived), Actions (Edit icon). Rows: Magic Groove copybook set MG-CB-SET GH₵249 / GH₵30 / 88% / 158 / 328 / 48% / Low stock; Refill pens MG-PEN-REF GH₵40 / GH₵12 / 70% / 80 / 116 / 52% / Low stock; Pencil grip trainer MG-GRIP-01 GH₵35 / GH₵11 / 69% / 225 / 58 / 50%; Smart Parent's Home Study Guide SPH-GUIDE-DIG GH₵59 / GH₵3 / 95% / no stock / 63 / Digital; archived Magic Groove starter pack GH₵199; Disappearing ink 3-pack GH₵30.
- Expanded row "Stock by holder" (physical products): table Holder, Allocated, In transit (with "Awaiting agent" tag), Delivered, Returned, On hand, Value (at cost), Actions (Allocate / Transfer / Return). Copybook: Logiswift 300/0/176/24/100, Kofi 160/20/98/6/36, Esi 90/0/70/8/12, Kwesi 60/0/44/6/10, total 610/20/388/44/158. Buttons in the header of the expansion: Allocate stock, Transfer to another agent, Return to warehouse, Transfer history. Notes: "Our records say 100 on hand at Logiswift. They count 88: the 9 Oct shipment arrived 12 short (300 sent, 288 counted)." and "Kasapa Express holds none of this product". Digital product expansion: "Digital product, no stock to track … link expires after 72 hours. 63 sent in October. File smart-parents-study-guide-v3.pdf".
- Footer: stock adds up across the four holders; delivery success target 60%; margin = price minus product cost.
- Link: Add shipment → Add shipment modal
- Link: Add product / Edit icon → Product drawer
- Link: agent card "See the shipment" → Products: Incoming shipments
- Link: Allocate / Transfer / Return buttons → Stock modals (Allocate, Transfer, Return)
- Link: Transfer history → Transfer history modal

## Products: Incoming shipments
- File: `products.html` (tab Incoming shipments). Who: Owner, Finance.
- KPI tiles: Pending shipments 3 (next copybook set 22 Oct); Units on the way 1,500 (3 products); Cost to land them GH₵24,950 (product, shipping, customs, other).
- Button Add shipment. Tabs All 5 / Pending 3 / Arrived 2.
- Table columns: Product, Supplier, Qty, Unit cost, Shipping, Customs, Other, Total, Landed per unit, Expected, Received at, Counted, Short, Status, Actions (pending rows: Mark arrived → Receive modal). Rows: copybook 400 from Accra Print House (22 Oct, landed GH₵30.00); pens 600 and grip 500 from Guangzhou Stationery (costs entered in GH₵); arrived copybook 300 (counted 288, 12 short) and pens 400.
- Footer: landed cost per unit = total ÷ units counted on arrival; updates the product cost when the shipment arrives.
- Link: "Mark arrived" → Receive shipment modal

## Product drawer (add / edit)
- File: `products.html` (side sheet). Who: Owner.
- Product type: Physical / Digital.
- Basics: Product name; Description (optional); SKU; Category; Images (drop zone).
- Pricing: Selling price (GH₵); Cost per unit (GH₵); live "Margin before delivery".
- Physical: Starting stock (disabled when editing; "Change stock with Allocate stock or Adjust quantity"); Low stock alert at (days of cover, default 14).
- Digital: File URL; File type (PDF, EPUB, MP3, MP4 video, ZIP); Link expires after (hours, 72). Note: the customer gets the link by WhatsApp once the order is paid.
- Checkbox "Product is active and can be ordered". Footer Cancel, Save product.

## Add shipment modal
- Fields: Product; Supplier; Quantity; Unit cost (GH₵); Shipping (GH₵); Customs and duties (GH₵); Other costs (GH₵); Expected arrival; Notes; live "Landed cost per unit". Buttons Cancel, Save shipment.

## Receive shipment modal
- Fields: Received at (Own store Accra, Logiswift warehouse Tema, Kofi, Esi, Kwesi, Kasapa Express trial); Received date; Units shipped (read-only); Units counted; "Short or damaged" (live); Note; "Landed cost per unit" (recalculated on counted units). Buttons Cancel, Save and add to stock (toast; flags a supplier claim if short).

## Stock modals: Allocate, Transfer, Return, Adjust
- Files: `products.html` and `inventory.html` (the same four modals are coded in both). Who: Owner (Stock keeper when filled).
- Allocate stock to agent: Product; From (Logiswift warehouse, fixed) with "n available"; To (Kofi, Esi, Kwesi, Kasapa Express trial); Quantity; Hand over on (date text); Note. Units show as in transit until the agent confirms. Button Allocate stock.
- Transfer to another agent: Product; From agent (with "n on hand"); To agent; Quantity; Note. Button Transfer stock.
- Return to warehouse: Product; From agent (with on hand); Quantity; Reason (Failed deliveries, Customer refused, Damaged, Agent stopped delivering, Other); Note. Button Return stock.
- Adjust quantity: Holder (4 agents + Logiswift warehouse); Product; New quantity (live "Now 36. Change of …"); Reason (Physical count correction, Damaged goods, Lost or stolen, Found extra stock, Other); Note. Button Save adjustment. Every change is logged.
- All four finish with a toast; none changes the tables.

## Transfer history modal
- Files: `products.html`, `inventory.html`. Who: Owner.
- Tabs All 6, Allocation 2, Order fulfilled 1, Agent transfer 1, Return 1, Adjustment 1 (counts static); filters Holder, Product; table Date, Type, From, To, Product, Qty, Order, By, Note; footer "Showing n moves · Last 30 days".

## Inventory & stock
- File: `inventory.html`. Who: Owner (Stock keeper).
- Header buttons: Transfer history (modal); Move stock (menu: Allocate to an agent, Transfer between agents, Return to warehouse, Adjust a quantity); Start stock count (dead).
- Location cards: Logiswift warehouse (3PL · Tema; On hand 342, Reserved 59, Products 3; tag "12 units off"; note "Logiswift count, 15 Oct"; buttons Allocate stock, Adjust quantity); Kofi Appiah (99 on hand, 18 reserved, 20 coming; Matches; Return, Transfer, Adjust quantity); Esi Badu (12, 3 reserved; Matches); Kwesi Amoah (10, 2 reserved; Matches); Own store (Coming soon; button Set up own store, dead).
- Table "Stock by location": Product, Location, On hand, Reserved, In transit, Our records vs Logiswift count, Difference (tag −12 units / Matches), Actions (icons: Allocate, Return, Transfer, Adjust). 8 rows (copybook ×4 locations, pens ×2, grip ×2).
- Recent transfers table: Date, Move, Items, Status (In transit, Pickup planned, Received, Received 12 short, Received 2 short) with button "View all with filters".
- Agent card (2): "Magic Groove stock is 12 units short at Logiswift" (Start a stock count, Dismiss); "20 copybooks reach Kofi tomorrow" (Remind Kofi, Dismiss). All dead.
- Link: Transfer history / "View all with filters" → Transfer history modal
- Link: Move stock menu items and card/row buttons → Stock modals
- Link: Start a stock count (header and agent card) → none (dead)

## Deliveries
- File: `deliveries.html`. Who: Owner (Finance for cash held). Delivery agents and 3PLs share one list.
- Header buttons: Upload CSV (dead), Add delivery partner (dead).
- KPI tiles: Out for delivery now 148 (across 5 partners); Waiting to dispatch 100 (oldest 3 days); Delivered this month 376 (GH₵92k); Delivery success 48% (target 60%, ▼12 pts); Cash still with agents and 3PLs GH₵23.4k (38 orders over 8 days).
- Delivery partners table (tabs All partners 5 / Agents 3 / 3PLs 2; tabs only highlight): Partner (type tag), Region, Assigned, Delivered, Failed or returned, Out now, Delivery success (target 60%, bar), Confirmed to dispatched, Dispatched to delivered, Cash held, Oldest unpaid, Partner fee rule, Data source. Rows as NUMBERS.md: Logiswift 590/220/270/100, 45%, 1.4 d, 3.8 d, GH₵17,300, 18 days, "GH₵35 per delivered, no charge on failed", Logiswift dashboard; Kofi 172/82/70/20, 54%, GH₵2,900, 3 days, "GH₵25 per delivered, GH₵5 fuel on failed", CSV upload; Esi 102/48/40/14, 55%, GH₵2,100, 4 days, GH₵25; Kwesi 54/26/22/6, 54%, GH₵1,100, 5 days, "GH₵30 per delivered, GH₵5 on failed"; Kasapa Express 8/0/0/8, no closed orders, GH₵0, GH₵30; All partners 926/376/402/148, 48%, GH₵23,400.
- Footnote separating "Partner fee rule" (what the partner keeps) from "Agent pay" (what we pay the person, set in Staff & roles).
- Card "Failed and returned by reason" (402): Not reachable 41% (165), Refused 24% (96), Wrong address 21% (84), Rescheduled 14% (57); notes on calling before dispatch and Returns (Logiswift sent back 41, we received 36, 5 missing).
- Agent card (3): "Logiswift delivery success is 45%…" (Move 40 Accra orders to Esi Badu); "Accra Central delivery success is 18%" (Queue 15 call-backs); "Logiswift holds GH₵17.3k, 38 orders over 8 days" (Send payout reminder). Dismiss on each. All dead.

---

# finance.html, marketing.html, reports.html

## Finance: header and shared actions
- File: `finance.html`. Who: Finance (Owner).
- Header: "Cash and profit for October. 3PLs and agents owe you GH₵23.4k." Buttons: Add expense (modal), Record payout (partner payout modal), Export (menu: Profit and loss CSV, Agent aging and collections CSV, General ledger CSV, Cash-flow forecast CSV; each shows a toast; link "More in Reports").
- Page tabs: Overview, Agent collections (4), Accounting, Rep commissions (2), Cash-flow forecast.
- Link: Export menu "More in Reports" → Reports (Products & profit tab)

## Finance: Overview
- File: `finance.html#t-overview` (default). Who: Finance, Owner.
- KPI tiles: Delivered revenue (Oct) GH₵92k (target 180k, Off track); Cash received GH₵68.6k (75% of delivered revenue); Cash outstanding GH₵23.4k (38 orders over 8 days); Net margin (Oct) −13% (target 35%, loss GH₵11.5k); Profit per delivered order (Oct) −GH₵31 (copybook −GH₵57); Cash runway 9 days (GH₵41.9k cash ÷ GH₵4,500 ads a day).
- Payout reconciliation table: Date, Paid by, Paid, Order list, Result. Rows: 11 Oct Logiswift GH₵9,880 vs 41 orders GH₵10,720 "Short GH₵840" with button "Show the 3 orders" (expands #24098 Ama Nkrumah, #24071 Kojo Osei, #24063 Akosua Amoah, GH₵280 each, with buttons Send to Logiswift, Mark as received: dead); 9 Oct Kofi GH₵3,486 Matched; 8 Oct Esi GH₵2,988 Matched; 4 Oct Logiswift GH₵11,454 Matched; 2 Oct Kasapa Express GH₵1,992 Matched.
- Card "Unpaid delivered orders" by age: 0–3 days 31 orders GH₵8,100; 4–7 days 25 / GH₵6,200; 8–14 days 26 / GH₵6,600; 15+ days 12 / GH₵2,500; total GH₵23,400 across 94 orders.
- Agent card (3): Logiswift paid GH₵840 less (Show the 3 orders, Dismiss); 38 orders unpaid after 8 days, all Logiswift, oldest 18 days, GH₵17.3k (Send reminders, Dismiss); "At 60% delivery success, October would be about GH₵4,900 profit" (Show failed orders, Dismiss). All three buttons are dead; the same "Show the 3 orders" button inside the reconciliation table works.
- Card "October order cohort" (placed 1–17 Oct, projected at 34% yield): Delivered 491; Revenue GH₵120,300; Product cost −GH₵14,700; 3PL and agent fees −GH₵15,900; Meta ad spend −GH₵76,200 (₦112 = GH₵1); Profit before other expenses GH₵13,500 (11%).
- Card "Cost of failed deliveries": Fuel fee on failed (Kofi 70 × GH₵5, Kwesi 22 × GH₵5) GH₵460; Returned units lost (5 × GH₵30) GH₵150; Total GH₵610.
- Card "Monthly profit and loss": columns Aug, Sep, 1–17 Sep, 1–17 Oct; rows Delivered revenue, Product cost, 3PL and agent fees, Meta ad spend (converted, ₦112 = GH₵1), Other expenses, Net profit, Net margin (target 35%); Export CSV button.

## Finance: Agent collections
- File: `finance.html#t-collections`. Who: Finance.
- KPI tiles: Cash with agents and 3PLs GH₵23.4k (94 delivered orders unpaid); Overdue, 8 days or more GH₵9,100 (38 orders, all Logiswift); Collections to verify 4 (GH₵14,860); Blocked from deliveries 0.
- Card "Cash exposure by partner": stacked bars by age bucket; note "Logiswift holds 74% of the cash".
- Agent card (2): Logiswift owes GH₵17,300 (Send reminder → toast; See aging scrolls); "Esi Badu sent a collection with no receipt" (Review collection opens Review modal; Ask for receipt toast).
- Table "Agent aging": switch "Show overdue only (8 days or more)"; Export CSV; columns Partner, Cash held, 0–3 days, 4–7, 8–14, 15+, Oldest, Status (Active/Blocked), Actions (Send reminder → WhatsApp toast; Block/Unblock toggles status and the blocked count). 5 partners plus total.
- Table "Collections to verify": Select-all checkbox, bulk button "Reconcile selected"; columns Date, From, Orders, Amount, Receipt (file type chip or "No receipt"), Status (Pending / Verified / Rejected + reason), Action (Review). Rows: Kofi 16 Oct 9 orders GH₵2,241; Esi 16 Oct 6 orders GH₵1,494 (no receipt); Kwesi 15 Oct 5 orders GH₵1,245; Logiswift 11 Oct 41 orders GH₵9,880 (short 840); Kofi 9 Oct and Esi 8 Oct Verified.
- Link: Review → Review collection modal

## Finance: Review collection modal
- Shows receipt (file name), facts (partner, date, orders, amount, order list, short amount), optional rejection box: Rejection reason (Amount does not match the order list, Receipt is unclear or edited, No receipt attached, Payment not found in MoMo or bank, Other) and Note to the partner. Buttons Reject, Close, Verify and reconcile (toasts).

## Finance: Accounting: General ledger
- File: `finance.html#t-accounting` sub-tab General ledger. Who: Finance.
- Sub-tab switch: General ledger, Statements, Profit by product, Expenses; button New journal entry.
- Chart of accounts (pick one): 1000 Cash at bank and MoMo; 1100 Cash with delivery partners; 1200 Inventory; 2000 Supplier payables; 2100 Commissions payable; 3000 Owner's equity; 4000 Sales revenue; 5000 Cost of goods sold; 5100 3PL and agent fees; 5200 Meta ad spend; 5300 Other expenses; each with balance. A trial-balance note under the list.
- Account ledger table: Date, Entry (JE-xxxx / EXP-xxx), Description, Debit, Credit, Balance.

## Finance: Accounting: Statements
- Cards: Income statement (1–17 Oct: revenue GH₵92,000, product cost −12,000, gross profit GH₵80,000 87%, fees −12,200, Meta −76,200, other −3,100, net −GH₵11,500 −13%) with Export; Balance sheet at 17 Oct (cash GH₵41,900, cash with partners 23,400, inventory 41,600 = assets 106,900; supplier payables 9,800, commissions payable 2,168, owner's equity 106,432, October result −11,500) with Export; Monthly P&L (same as Overview).

## Finance: Accounting: Profit by product
- Card "Profit by product, last 3 months" (chart: Copybook set, Add-ons, Dictamni). Agent card (1): "The copybook set lost GH₵20,400 in October … add-ons still earn GH₵10,200" with link "Open profit report" and Dismiss.
- Table "Profit by product" (1–17 Oct): Product, Delivered, Revenue, Product cost, Fees, Meta ads, Profit, Margin. Copybook 306 / 76,100 / 9,200 / 10,500 / 73,700 / −17,300 / −23%; Refill pens 172 / 6,900 / 1,100 / 900 / 0 / 4,900 / 71%; Grip trainer 89 / 3,100 / 600 / 400 / 0 / 2,100 / 68%; Guide 58 / 3,400 / 200 / 0 / 0 / 3,200 / 94%; Dictamni 10 / 2,500 / 900 / 400 / 2,100 / −900 / −36%; Meta spend with no product −400; Other expenses −3,100; Net 376 / 92,000 / 12,000 / 12,200 / 76,200 / −11,500 / −13%.
- Link: agent card "Open profit report" → Reports (Products & profit)

## Finance: Accounting: Expenses
- Table: Date, Category, Description, Paid from, Amount, Actions (edit, delete). 7 sample expenses totalling GH₵3,100; button Add expense; category bars. Categories: Packaging, Software, Office and internet, Transport, Airtime and rewards, Photography, Bank charges, Other.

## Finance: Add expense modal
- Fields: Date; Amount (GH₵); Category (8 options); Paid from (MoMo, Bank, Cash); Description. Footer note "Posts to account 5300 Other expenses". Buttons Cancel, Save expense / Save changes.

## Finance: New journal entry modal
- Fields: Date; Reference (JE-0413); Description; lines table (Account, Debit, Credit, remove) with Add line; live Debit/Credit totals and state tag (Empty / Balanced / Out of balance). Buttons Cancel, Post entry (disabled until balanced, at least two lines).

## Finance: Rep commissions
- File: `finance.html#t-commissions`. Who: Finance.
- KPI tiles: Commission owed GH₵2,168 (2 reps, account 2100); Paid this month GH₵1,440 (2 payouts, 1 and 9 Oct); Per delivered confirmed order GH₵8 (plus 10% upsell reward); Target rewards earned GH₵100 (Adwoa Darko, 80% airtime).
- Table: Rep (type tag), Delivered, Commission, Upsell reward, Earned, Paid in Oct, Owed, Target reward (Adwoa "GH₵100 airtime 84% of target"; Nana "None yet 64%"), Last payout, Action (Record payout). Rows: Adwoa 253 / GH₵2,024 / GH₵610 / GH₵2,634 / GH₵600 / GH₵2,034; Nana 13 / GH₵104 / GH₵30 / GH₵134 / GH₵0 / GH₵134; Confirm agent 110 "No payout for AI agents".
- Payout history: 9 Oct Adwoa GH₵600 October commission; 1 Oct Adwoa GH₵840 September balance.
- Link: Record payout → Record rep payout modal

## Finance: Record rep payout modal
- Fields: Amount (GH₵, prefilled with owed); Method (MoMo, Bank transfer, Cash); Date; Reference; checkbox "Also pay target reward (GH₵100 airtime)"; Note. Footer "Posts to 2100 Commissions payable". Buttons Cancel, Record payout.

## Finance: Record partner payout modal
- Fields: Paid by (Logiswift, Kofi, Esi, Kwesi, Kasapa Express); Amount (GH₵); Date; Reference or receipt. Note "matched to the oldest unpaid orders". Buttons Cancel, Record payout.

## Finance: Cash-flow forecast
- File: `finance.html#t-forecast`. Who: Finance, Owner.
- Switch: "Today's pace, 48% delivery success" / "If delivery success reaches 60%"; Export CSV.
- KPI tiles: Cash at bank and MoMo today GH₵41.9k; Expected in, 30 days; Expected out, 30 days; Cash on 16 Nov (lowest point and tag Safe / Tight / Runs out).
- Chart "Cash balance, next 30 days"; agent card (1, text depends on the scenario; Chase Logiswift now = WhatsApp toast; Review ad budget link). Assumptions text: ads GH₵4,500 a day; Logiswift pays GH₵9,300 on 27 Oct; agents within 4 days; new deliveries paid after 7 days; supplier payables GH₵5,000 on 31 Oct; rep commissions on 25 Oct.
- Table "Week by week": Week, Money in, Money out, Net, Cash at end.
- Link: agent card "Review ad budget" → Marketing

## Marketing
- File: `marketing.html`. Who: Marketer (Owner).
- Header: "Meta account: connected, pulled 06:42" chip (not a link); button This month (dead).
- KPI tiles: Ad spend this month ₦8.53M (about GH₵76k, ₦112 = GH₵1); CPA against max CPA ₦5,903 (max ₦7,040 at 34% yield, ₦1,137 under); Projected cost per delivered ₦17,360 (break-even ₦20,720, ₦3,360 under; "Actual so far ₦22,686, by delivery date"); Order-to-cash yield 34% (campaigns range 29% to 36%).
- Funnel card: scope bar ("All campaigns, click a row to look at one" or the campaign name + "Show all campaigns"); 7 steps: Impressions (CPM), Link clicks (CTR, CPC), Landing page views (% of clicks, cost per view), Checkouts started, Orders (CPA), Confirmed, Delivered projected (yield, cost each); footnote with delivered so far.
- Campaigns table (click a row to scope the funnel and expand its ads): Campaign (+ product, or a "Map to product" select for unmapped), Spend, Orders, Confirmed, Delivered, CPA, Max CPA, Yield, Projected cost per delivered, Actual so far, Status (Winning, On track, Over max CPA, Not mapped, Paused). Rows: MG_Oct_Teacher_UGC, MG_Oct_Mom_POV, MG_Oct_Benefit_Stack, MG_Oct_Retarget (not mapped), DT_Oct_Dignity, All campaigns.
- Expanded ads table: Ad, Spend, Orders, CPA, Hook rate (3-second views ÷ impressions), Hold rate (ThruPlays ÷ impressions), Frequency (static ads show n/a).
- Card "Daily spend vs orders" (chart placeholder; Best day 16 Oct ₦5,450 per order; Worst day 13 Oct ₦6,329; Average ₦502k a day, 85 orders).
- Agent card (3): Benefit Stack over its ₦6,010 max CPA (Cut budget by 30%, Dismiss); Teacher UGC has room to scale (Raise budget by 20%, Dismiss); ₦41,000 Meta spend has no product (Map to Magic Groove, Dismiss). All dead.
- Link: none out of this page (the "Map to product" select does nothing)

## Reports: shared header
- File: `reports.html`. Who: Owner, Finance, Marketer.
- Header: Saved reports menu (list of 3 saved views; "Save this view" name input + Save; saves tab, dates, compare); Export menu (CSV, Excel, PDF for this report; Download all reports (Excel); Custom export… → Export dialog).
- Date range card: presets Today, Last 7 days, This month (default), Last month, Custom (two date inputs); switch "Compare to previous period"; range label "1–17 Oct 2026" and "Previous period: 1–17 Sep 2026".
- Agent cards (2): "Explain this month" (Explain this month toggles a 3-paragraph read; Add to export); "Logiswift closes only 45% as delivered" (Open Delivery report switches tab; link See partners).
- Tabs: Overview, Sales & revenue, Delivery & operations, Team performance, Products & profit, Marketing.
- Bottom card "Recent exports" (Files stay for 7 days): table File, Report, Dates, Format, Made by, When, Size, Download (toast).
- Link: agent card "See partners" → Deliveries
- Link: Export menu "Custom export…" → Export dialog

## Reports: Overview
- Tab `#t-overview`. KPI tiles: Orders 1,445 (▲5% vs 1,380); Confirmed 1,026 (confirmation 71%, target 70%); Delivered 376 (success 48%, target 60%, ▼3% vs 387); Delivered revenue GH₵92,000 (▼4% vs GH₵96,000). Charts: Orders and deliveries per day; "Where 1,445 orders ended up" (Delivered 376, Failed 354, Returned 48, Out for delivery 148, Waiting to dispatch 100, Pending call 64, Cancelled 355; note on 48% and 34%). Table Daily breakdown: Date, Orders, Confirmed, Delivered, Revenue (17 days).

## Reports: Sales & revenue
- Tab `#t-sales`. KPI tiles: Delivered revenue GH₵92,000; Average order value GH₵245 (computed, copybook set is GH₵249); Cash received GH₵68.6k; Cash still with partners GH₵23.4k. Charts: Delivered revenue per day (with September overlay), Revenue by product (donut). Table Revenue by region: Region, Delivered, Revenue, Average order, Share (Accra 176, Tema 92, Kumasi 82, Takoradi 26, Cape Coast 0; total 376).

## Reports: Delivery & operations
- Tab `#t-delivery`. KPI tiles: Delivery success 48% (376 of 778 closed); Failed deliveries 402 (41% not reachable); Out for delivery now 148; Logiswift pays in 9.2 days. Charts: Delivered per day; Failed deliveries by reason (same four reasons as Deliveries). Table Delivery partners (as NUMBERS.md, plus Pays in: Logiswift 9.2, Kofi 3.1, Esi 3.6, Kwesi 4.2). Chart Delivery success by region; "Waiting and returns" (100 orders oldest 3 days; 48 returned, 5 missing).

## Reports: Team performance
- Tab `#t-team`. KPI tiles: Orders confirmed 1,026; Calls made 2,310 (2.25 per confirmation); Not reachable 540 (23% of calls); Pending in the queue now 64 (oldest 3 h 10 min, 9 with no rep). Charts: Call outcomes (donut); Why customers decline (301: Price too high 34%, Prank or mistake 22%, Changed mind 20%, Bought elsewhere 14%, Other 10%). Table Call reps: Rep, Calls, Confirmed (role target 1,300), Confirmation rate, Delivered from confirmed, Time to first call, Upsell rate, Extra value, Target hit, Not reachable; rows Adwoa, Confirm agent, Nana, All call reps. Bars "Delivery partners ranked" (Esi 55%, Kofi 54%, Kwesi 54%, Logiswift 45%, Kasapa n/a).

## Reports: Products & profit
- Tab `#t-products`. KPI tiles: Net result −GH₵11.5k (−13%, target 35%); Delivered revenue GH₵92,000 (5 products); Meta ad spend GH₵76,200 (83% of revenue); Profit per delivered order −GH₵31 (copybook −GH₵57). Card "Two ways to read October": by delivery date −GH₵11.5k (−13%) vs by order cohort GH₵13.5k (11%). Charts: Profit by product last 3 months; October profit by product. Table "Profit by product" (same as Finance).

## Reports: Marketing
- Tab `#t-marketing`. Same content as the Marketing page: KPI tiles (Meta spend with previous period, CPA, projected cost per delivered, yield), Funnel, Campaigns table with expandable ads; plus charts Meta spend per day and CPA against max CPA.

## Reports: Export dialog
- Checkboxes for the 6 reports with Select all; Dates select (1 to 17 Oct, 1 to 30 Sep, Last 7 days, Custom dates); Format (CSV, Excel, PDF); switch "Include the previous period"; hint on file output; count "n report(s)". Buttons Cancel, Export (adds a row to Recent exports).

---

# staff.html, workflows.html, connections.html, settings.html

## Staff & roles: Roles
- File: `staff.html`. Who: Owner.
- Header buttons: New role (dead), Invite person (opens Person modal).
- Agent card (3): "Stock keeper role is vacant. The 12-unit gap has no owner" (Assign an AI agent opens the Stock keeper detail with the AI form; Take it myself opens the person form); "You hold 3 roles, and 38 orders are unpaid over 8 days" (Hand Finance clerk to an agent; Dismiss dead); "Kwesi Amoah is owed GH₵312 and has had no payout in October" (Pay Kwesi opens the payout modal; See balances scrolls to Pay).
- Legend: Human, AI agent, Company.
- Role cards (6): Owner; Call rep (holders Adwoa, Nana, Confirm agent AI; target 1,300 confirmed, 1,026 of 1,300, Ahead); Delivery (Logiswift, Kofi, Esi, Kwesi, Kasapa Express; target 60% delivery success, 48% now, Behind); Finance clerk (Manny; "Under 10 orders unpaid over 8 days", 38 now); Marketing (Manny; CPA under max CPA ₦7,040, ₦5,903 now); Stock keeper (vacant; "Stock gap under 2 units", 12 short). Each card: holders with type tags, October target, progress bar, "n of 16 tools allowed".
- Role detail panel (for the selected card): Assign menu (Invite a person: email/phone + Send invite; Connect an AI agent: agent name + Create MCP key limited to the role's tools; Add a company: name + Add company; all toast text); Monthly target block; for Delivery a "Phone view" box and for Call rep a "Call-rep view" box; "Reward rule" (tier rows, e.g. Call rep 80% GH₵100 airtime, 100% GH₵300 bonus, 120% GH₵500 + paid day off; Delivery 80% GH₵100 airtime, 100% GH₵250 bonus, 120% GH₵400 + paid day off; note text; button Edit rule, dead); "Allowed tools": Read switches (View orders, customers, stock, payouts, reports, targets, Export data) and Write switches (Update order status, Assign orders, Call customers, Message customers, Edit products, Adjust stock, Record payout, Edit targets, Manage team). Owner switches are locked. Toggling updates the "n of 16" count.
- Link: Call rep card / detail "Open call-rep view" → Rep Today (rep.html)
- Link: Delivery card / detail "Open delivery agent phone view" → Agent Home (agent.html)

## Staff & roles: Team and pay
- File: `staff.html` (lower cards). Who: Owner, Finance.
- Team table with tabs All, Active, Invited, Deactivated (counts): Name (+ contact), Roles (chips), Type (Human / AI agent / Company), Pay, Last active, Status (Active, Working, Idle 1 day, On trial, Payout short GH₵840, Invited, Deactivated), row menu (Edit, Record payout [people paid through the app], Manage key [AI agents] or Reset password, Deactivate/Reactivate, Delete). 12 sample rows (Manny, Adwoa, Nana, Confirm agent, Manny's Claude, Kofi, Esi, Kwesi, Kasapa Express, Logiswift, Akua Serwaa invited, Yaa Pokua deactivated).
- Pay card (October, people only) with tabs Call reps, Delivery agents, Payout history (5).
  - Call reps: Call rep, Delivered orders, Commission (GH₵8 each), Upsell reward, Earned, Paid, Owed, Record payout. Adwoa 253 / GH₵2,024 / GH₵610 / GH₵2,634 / GH₵600 / GH₵2,034; Nana 13 / 104 / 30 / 134 / 0 / 134; Confirm agent "No payout". Note on commission and upsell, "Target bonuses are separate, see Rewards in Settings".
  - Delivery agents: Delivery agent, Vehicle, Location, Rate per delivery, Delivered, Earned, Paid, Owed, Record payout. Kofi GH₵12 × 82 = 984, paid 800, owed 184; Esi GH₵10 × 48 = 480, paid 400, owed 80; Kwesi GH₵12 × 26 = 312, paid 0, owed 312. Note separating agent pay from the partner fee rule, with links to Deliveries and Finance.
  - Payout history: Date, Person, Amount, Method, Notes, Recorded by (5 rows).
- Link: Pay note "Rewards in Settings" → Settings (Rewards)
- Link: Pay note "Deliveries" → Deliveries
- Link: Pay note "Finance" → Finance
- Link: row menu "Manage key" → Connections
- Link: "Record payout" → Staff payout modal

## Staff: Person modal (invite / edit)
- Fields: Full name; Email; Phone; Role (Call rep, Delivery, Finance clerk, Marketing, Stock keeper); How are they paid? (GH₵8 per delivered confirmed order + upsell reward / Pay per delivery / No pay through the app); Amount (GH₵, default 8 or 12); for Delivery: Vehicle (Motorbike, Car, Tricycle, Bicycle, On foot), Vehicle number, Location (city, "Orders in this city can be assigned to them"). Buttons Cancel, Send invite / Save changes.

## Staff: Record payout modal
- Fields: Pay (select person), preview (rate, delivered, upsell reward, earned, already paid, owed now), Amount (GH₵, prefilled with owed), Method (Bank, MoMo, Cash), Notes. Buttons Cancel, Record payout.

## Workflows: list
- File: `workflows.html` (list view). Who: Owner.
- Header: "5 are on and ran 1,084 times this week." Buttons: Browse templates (scrolls to templates), New workflow.
- KPI tiles: Active 5; Inactive 2; Runs this week 1,084 (98% passed); Failed runs this week 23 (16 SMS, 7 HTTP).
- Agent card (2): "Describe a workflow and I'll build it" (input prefilled "When an order is confirmed in Accra, assign it to Esi and send her a WhatsApp"; Build it opens the builder at Actions step); "Failed delivery follow-up is off" (Turn it on switches the row on; Review first opens the builder).
- Toolbar: search workflows; tabs All 7 / Active 5 / Inactive 2.
- Table columns: Workflow (name + description), Trigger, Actions (count), Last run (time + Passed / "1 failed" / Never run), Runs this week, Active (switch), Edit / Delete (confirm). Rows: Auto-assign by region (612 runs), Send confirmation SMS (388), High-value order alert (14), Daily delivery reminder (7, 1 failed), Shopify order import (63), Failed delivery follow-up (off, never run), VIP customer priority (off).
- "Start from a template" gallery of 8 cards (each opens the builder).
- Link: Edit / template / New workflow / Build it → Workflow builder

## Workflows: builder
- File: `workflows.html#builder`. Who: Owner.
- Top bar: Workflows (back), name, state tag, Test run (jumps to Review), Save workflow (toast then back to the list).
- Step rail (click to jump): 1 Basic info, 2 Trigger, 3 Conditions, 4 Actions, 5 Review; Back / Continue footer.
- Step 1 Basic info: Name; Description; Active switch ("Runs on every new match as soon as you save").
- Step 2 Trigger (pick one): Order created; Status change (From status select, To status select); Payment received (Paystack or manual); Schedule (Repeat Every day / Every week, Time Ghana); Manual (run from an order); Webhook (read-only URL `https://app.codadmin.com/hooks/wf_…`, POST JSON).
- Step 3 Conditions: Run when All match / Any match; rows Field (Order total, Product, Customer type, Status, Payment method, Region, Country, Item count) + Operator (is, is not, is greater than, is less than, contains) + Value; Add condition; remove.
- Step 4 Actions (ordered, expandable, removable): Assign user (role Call rep / Delivery agent; share Evenly / Weighted % / By region with a region table Kumasi → Kofi, Accra → Esi, Takoradi → Kwesi, Everywhere else → Logiswift; switch "Also assign orders that have no one yet (38 would be assigned now)"); Send WhatsApp (Send to The assigned agent / The customer / A fixed number; Message with {{orderNumber}} {{customerName}} {{customerAddress}} {{total}}); add-action buttons Assign user, Send SMS, Send WhatsApp, Send email (Subject, Body), Change status, Wait (value + hours/minutes/days), HTTP request (URL, POST/GET, header).
- Step 5 Review: summary (Name, Trigger, Conditions chips, Actions, Status); Test run (select a sample order, Run test: "No messages are sent", shows the steps and who it would assign); Run history table (Order, Result, When) with a failure reason.

## Connections
- File: `connections.html`. Who: Owner.
- Header buttons: Messages (link); Add connection (toast "Pick from SMS, WhatsApp, email, Paystack or Meta Ads").
- Agent card (2): "Your WhatsApp token expires in 3 days" (Reconnect with Meta opens the WhatsApp config; Remind me on 19 Oct dead); "A Meta campaign has no product" (Map to Magic Groove toast; Dismiss).
- Connection cards (each with status tag, key facts, actions):
  - Arkesel SMS (Connected): Sender ID MagicGroove, API key masked, Credit left 3,420 SMS, Last message. Edit; Send a test.
  - WhatsApp Business (Expires in 3 days): phone number, business account, Connected by Meta login, Templates 5 approved; warning strip. Reconnect with Meta; Use a token.
  - Email (Connected): Provider SendGrid, From, From name, Sent this month 1,860. Edit; Send a test.
  - Paystack (Test mode): mode, public key, webhook URL; warning "Real customers cannot pay yet". Edit keys; Copy webhook URL.
  - Meta Ads (Connected): Ad accounts 2 of 3 on, Pulled every hour, Last pull, Spend in October ₦8.53M; strip "1 campaign has no product". Choose ad accounts.
  - Checkout website (Connected): Site magicgroove.shop, Orders arrive Live, Last order, Tracking "Pixel and server events on". Edit; Send a test order (toast).
  - CSV upload (Manual): Matches by phone and order number; last upload and result (24 matched, 2 not found). Upload CSV; Download template (toasts).
  - AI agent keys (MCP): list of 3 keys (Confirm agent, Manny's Claude, Stock-count agent) each with role, tool count, masked key, last used, Revoke; Create key form (Name, Role select, Create key; shows the key once); link "Roles and tools".
- Configuration modal (opened by Edit / Reconnect / Choose ad accounts / Send a test): per connection.
  - SMS: API key (show/hide), Sender ID (11 characters max), Send a test to (number + Send test).
  - WhatsApp: mode Connect with Meta (strip, Reconnect with Meta, Phone number select) or Use a token (Access token, Phone number ID, Business account ID, Webhook verify token).
  - Email: Provider (SendGrid / Resend / SMTP), API key or SMTP host, port, username, password, From name, From email.
  - Paystack: Mode Test / Live, Public key, Secret key, Webhook URL + Copy.
  - Meta Ads: switches per ad account (Magic Groove GH ₦6.9M, Manny Dynamics NG ₦1.63M, Old test account), Connect another account.
  - Checkout website: Site address, Meta pixel ID, switch "Send server events".
  - Buttons Cancel, Save (toast).
- Webhooks card: description; New webhook (Name, Product select, Create webhook); table Name (+ product), Import URL (copy), Key (copy), Last request, Today, Status switch; row selects the detail below. Rows: Magic Groove checkout, Landing page B (failing: phone field missing), Guide order form.
- Webhook detail card (selected row) with tabs: Field mapping (their field → CodAdmin field select [Customer name/phone/email, Delivery address, City or region, Landmark, Product SKU, Quantity, Order total, Notes] + example value; Add a field; Save mapping toast; "Name and phone are required"); Logs (All / Failed; Time, Status, Request, Response, Error; row expands request/response); How to send (POST URL, X-Webhook-Key header, copy buttons, warning).
- Activity card (last 6 days): tabs All 9 / Failed 2 / Warnings 2; table Time, Connection, What happened, Result, Detail.
- Link: Messages button → Messages
- Link: AI keys "Roles and tools" → Staff & roles

## Settings (sections)
- File: `settings.html`. Who: Owner. Header: "Your profile, business, targets, rewards and plan." Button Save changes (toast "Saved. Sample only.").
- Agent card (3): "Delivery success of 48% keeps Q4 behind its 60% target … A re-plan keeps the North Star and moves the driver targets" (Show a revised Q4 plan, Dismiss: dead); "You will pass your Growth limit in about a day" (Compare plans → Billing & plans section); "Your FX rate is 16 days old" (Check the rate → Currencies & FX section).
- Left section menu: Profile, Security, Business details, North Star & targets (default), Rewards, Currencies & FX, Order statuses, Notifications, Billing & plans. The menu item "North Star & targets" shows the North Star card AND the Rewards card together on one screen.
- Link: agent card "Compare plans" → Settings: Billing & plans
- Link: agent card "Check the rate" → Settings: Currencies & FX

## Settings: Profile
- Only you see this. Change photo (toast). Fields: Full name (Michael Emmanuel); Display name (Manny; "Shown to your team in notes and assignments"); Email; Phone; Language (English); Time zone (Africa/Accra GMT). Button Save profile.

## Settings: Security
- Password card: Current password; New password (at least 8 characters); Repeat new password; Change password.
- "Where you are signed in": 3 sessions (This device, iPhone Safari, Windows PC Edge) with Sign out each and "Sign out everywhere else".
- Danger zone: Export my data; Delete account (opens a confirm box: type DELETE, Delete everything enabled only when typed, Cancel). Text: removes login, both stores, all orders, customers and messages.

## Settings: Business details
- "Shown on invoices and customer messages." Fields: Business name; Main product; Contact person; Contact email; Customer support WhatsApp (hint "Customers see this number in delivery messages"); Tax ID (TIN); Business address; Selling country (Ghana); Currency customers pay in (select GH₵ Ghana cedi / ₦ Nigerian naira); Time zone (Africa/Accra GMT); Average order value (GH₵249; hint "Used to turn orders into delivered revenue"). Button Save.

## Settings: North Star & targets
- Card with button "Edit in setup". Growth split note ("Grow each quarter. The four quarters add up to GH₵1,800,000"). North Star 2026 GH₵1,800,000 ("Set on 2 Jan 2026", chips 77% done · 3 pts behind, Margin 12% YTD target 35%). Quarter tiles Q1 to Q4 (Revenue hit / Behind, margin 11% / 12% / 12% of 35%). Driver targets (read-only): Orders a day 58 (now 64 today); Confirmation rate 70% (now 71%); Delivery success rate 60% (now 48%); Max cost per order ₦8,700 (moves with yield, now ₦7,040 at 34%).
- Link: "Edit in setup" → North Star setup

## Settings: Rewards
- Shown inside the North Star & targets screen and also from its own menu item. Button Edit rules (dead).
- Target tiers (list; rule per role): Call rep hits 80% GH₵100 airtime (humans only); 100% GH₵300 bonus; 120% GH₵500 + paid day off. Delivery hits 80% GH₵100 airtime; 100% GH₵250 bonus; 120% GH₵400 + paid day off. 3PL below 80%: Contract review (companies get no bonus).
- Call rep pay: Commission input GH₵8 per confirmed order that is delivered; Upsell reward input 10%.
- "What reps can offer" tags: 1 set GH₵249, 2 sets GH₵449, 3 sets GH₵629, Refill pens GH₵40, Pencil grip trainer GH₵35, Smart Parent's guide GH₵59 (taken from the checkout form).
- Result badges: Top of month (September: Adwoa Darko); Hit target 3 months running (Confirm agent, Adwoa Darko); Beat target by 20% (September: Kofi Appiah).

## Settings: Currencies & FX
- Tiles: Sales and revenue GH₵ (what customers pay); Ad spend ₦ (what Meta charges); Exchange rate 1 GH₵ = ₦112. Header note "Rate updated 1 Oct".
- Field: Naira per cedi (112) with button "Use today's rate"; helper text "CPA ₦5,903 is GH₵52.7. The max CPA ₦7,040 (at 34% yield) is GH₵62.9." Button Save (dead).

## Settings: Order statuses
- Button Add status (dead). List of 6 statuses with meaning: New (Waiting for a call), Confirmed (Customer said yes), Out for delivery (With a rider or 3PL), Delivered (Counts toward delivered revenue), Not reachable (After 3 calls, try WhatsApp), Failed (Refused, wrong address or cancelled). Note: payment is tracked apart from order status (unpaid, paid by 3PL, paid to you).

## Settings: Notifications
- Link card "Notification settings live in Inbox" with button "Open Inbox settings".
- Link: Open Inbox settings → Inbox: Notification settings

## Settings: Billing & plans
- Plan summary: Growth, ₦10,000 a month, next bill 1 Nov, Active tag; Update card (toast). Usage: Orders this month 1,445 of 1,500 (96% used), resets on 1 Nov, "Over the limit, new orders wait until you upgrade". Rows: Payment method (card ending 4821); Stores (2 of 2 used).
- Change plan (billed in ₦, no free trial): Free ₦0 (50 orders, 1 store, manual order entry; Switch to Free); Growth ₦10,000 (1,500 orders, 2 stores, messages and workflows, 3 AI agent keys; current); Scale ₦20,000 (6,000 orders, 5 stores, unlimited AI keys, priority support; Upgrade to Scale); Enterprise (Contact sales). Cancel subscription opens a confirm strip ("Cancelling moves you to Free on 1 Nov…": Yes, cancel on 1 Nov / Keep my plan).

---

## Known mockup issues

### Owner-approved fixes (recorded, not applied)

**1. Rewards live in two places in Settings; airtime tier removed.**
- Today: `settings.html` shows the full Rewards card (target tiers, rep pay, upsell, badges) on the "North Star & targets" screen (the menu item maps to both sections) and again as its own "Rewards" menu item.
- Fix: Rewards exist only in Settings → Rewards. Settings → North Star & targets keeps a one-line link ("Rewards are set in Rewards") and no tier list.
- Cash tiers only. Call rep: 100% GH₵300; 120% GH₵500 + paid day off. Delivery agent: 100% GH₵250; 120% GH₵400 + paid day off. The 80% GH₵100 airtime tier is removed.
- Places that show or depend on the 80% airtime tier and need rewriting: Leaderboard Call reps and Delivery (Rewards cards, "reached it" lines, "Distance to the next tier" rows); Settings Rewards; Staff role detail reward rule (CALL_TIERS and the delivery tiers); Rep Today (tier row "GH₵100 airtime reached"); Rep Inbox ("You reached 80% … GH₵100 airtime earned"); Agent Home (hero chip "Reward now: GH₵100 airtime", tier row); Inbox feed (item "Adwoa reached 80% … earns the GH₵100 airtime tier"), Assigned to me ("Pay Adwoa's GH₵100 airtime reward"), Reminders (#6 "Pay Adwoa the GH₵100 airtime reward"); Finance Rep commissions (KPI "Target rewards earned GH₵100", Target reward cell, payout checkbox "Also pay target reward GH₵100 airtime", expense "Call rep airtime reward, September" GH₵500, category "Airtime and rewards"); Inbox notification event "Target milestone: 80%, 100% or 120% reached"; `NUMBERS.md` ("Reward tiers on target unchanged (80% GH₵100 airtime …)") and `DESIGN-SPEC.md` (Round 2 sample data).
- The reward rule is also displayed (read-only) in Targets ("Reward at 100%" column), Leaderboard, Staff, Rep and Agent apps. All of these should read from the single Rewards setting.

**2. Average order value is a typed field.**
- Today: `settings.html` Business details has "Average order value GH₵249" (hint "Used to turn orders into delivered revenue"). North Star setup also has a typed "Average order" driver (GH₵249, "Magic Groove today"). Reports shows the actual AOV as GH₵245 (computed).
- Fix: remove the AOV field from Business details. AOV is computed (Finance / Reports). North Star & targets and the setup wizard show "planned AOV", default = last 30 days actual, editable. The "Orders a day you need" calculation uses planned AOV.

**3. Currencies and FX.**
- Today: Business details has editable "Selling country" and "Currency customers pay in" (GH₵ / ₦); Settings → Currencies & FX has one manual rate "Naira per cedi 112", "Use today's rate", "Rate updated 1 Oct", and an agent card "Your FX rate is 16 days old". The single rate ₦112 = GH₵1 is printed on Finance, Marketing, Reports and the General ledger ("Meta daily spend, ₦530k at ₦112"). Supplier costs on Products shipments are entered in GH₵ only. Checkout forms have their own "Default country" (Ghana, Nigeria). Sidebar shows "2 stores" with no store switcher.
- Fix: store currency is set once at setup and locked after the first sale (a different currency means a new store, SaaS phase). Extra currencies: ₦ ad spend comes automatically from the Meta account; supplier currencies are entered per shipment. Rate is fetched daily and automatically, with a manual override. Keep a per-day rate history (the ledger and P&L use the rate of each day). The stale-rate warning shows only when the rate is a manual one.

### Other inconsistencies found (list only)

Duplicates and screens in two places
1. Stock modals (Allocate, Transfer, Return, Adjust, Transfer history) are coded in both Products and Inventory & stock, and the holder-by-product table appears in both (Products "Stock by holder", Inventory "Stock by location").
2. Payouts are recorded in two places: Finance → Rep commissions and Staff & roles → Pay. The histories differ (Finance shows 2 payments, GH₵1,440; Staff shows 5, including delivery agents). Delivery-agent pay (Kofi owed GH₵184, Esi GH₵80, Kwesi GH₵312) appears nowhere in Finance P&L, ledger or balance sheet; only rep commissions are in GL 2100.
3. Reports repeats other screens: Marketing tab = Marketing page; Products & profit table = Finance → Accounting → Profit by product; Delivery partners table = Deliveries; Call reps table overlaps Leaderboard and Staff pay; Finance repeats the same monthly P&L on Overview and on Accounting → Statements.
4. Tracking is set in two places with different values: Checkout forms → Tracking pixel 482915073361842 versus Connections → Checkout website pixel 318204419037722; Conversions API token only in Checkout forms, "Send server events" switch only in Connections.
5. Time zone appears in Profile and Business details. Country and currency overlap in Business details and Checkout form "Default country".
6. Notifications: Settings → Notifications is only a pointer to Inbox settings (fine), but the delivery agent app has its own separate notification switches.
7. Order statuses differ per place: Orders has 9 (Pending confirmation … Failed delivery); Settings → Order statuses lists 6 (New, Confirmed, Out for delivery, Delivered, Not reachable, Failed) and "Not reachable" shows as an order status on the Dashboard; rep app uses Waiting to dispatch / Declined / Failed; agent app uses To pick up / Out / Done / Failed.

Numbers that disagree
8. Order ids use three formats (#24xxx admin, CA-482xx rep and agent, #MG-104xx Workflows), and one number maps to different customers: #24098 is Ama Nkrumah (Orders, Finance) but "Abena Owusu, Kumasi" in Inbox reminders; #24109 is Selina Tetteh (Orders) but "Maame Serwaa, Kumasi" in Inbox; #24120 Akosua Frimpong is Kumasi in Inbox but #24111 Akosua Frimpong is Cape Coast in Orders; Messages thread order numbers map to other customers than Orders.
9. Abena Owusu: agent app COD GH₵249; Inbox reminder "Collect GH₵498 from Abena Owusu".
10. Copybook delivered: 306 (Finance, Reports) vs 328 (Products KPI and insight). Pens delivered 172 (Finance) vs 116 (Products); grip 89 vs 58; guide 58 vs 63.
11. Finance insight "copybook set lost GH₵20,400" vs table −GH₵17,300.
12. Finance Logiswift missing orders are GH₵280 each (3 × 280 = 840) but the copybook price is GH₵249 and AOV GH₵245.
13. Agent app Home says "5 of 8 delivered, 3 left" and Deliveries header "3 of 8 delivered today" (list: 3 Done, 1 Failed, 2 Out, 2 To pick up; tab badge shows 3).
14. Customers agent card: "Each refused order costs about GH₵40 in delivery fees"; fee rules elsewhere are GH₵0 to GH₵5 on a failed order (Finance cost of failed deliveries GH₵610 in total).
15. Messages: KPI "2,860 sent in October" (1,940 WA + 920 SMS) is lower than the WhatsApp and SMS campaigns alone (1,240 + 2,100 + 310 + 420 = 4,070); Conversations tab says 38 but the sample list has 26.
16. Agent drawer text differs by page and is partly stale: five pages (Customers, Checkout forms, Connections, Messages, Workflows) still say "If delivery gets back to 35% this week"; others say 53%; several say "Accra Central is worst at 18%" while others say "Logiswift is lowest at 45%". Accra Central 18% is not in `NUMBERS.md`.
17. Dashboard daily target "Failed delivery calls 6 of 15" has no matching setting in Targets or Settings.
18. Targets shows Delivery as 5 holders; Leaderboard Delivery tab shows 4 (Kasapa Express left out). Leaderboard badge "Beat target by 20%: No one yet" vs Settings Rewards "September: Kofi Appiah".
19. `DESIGN-SPEC.md` Round 1 rule 7 still lists delivery rate 26% (target 40%) and CPA ceiling ₦6,400; `NUMBERS.md` replaces them (no mockup still shows them).
20. Staff header strings ("10 on the team · 1 deactivated") are static; the table renders 12 people (10 active, 1 invited, 1 deactivated).
21. Region lists: New order and Messages use 6 to 7 regions (Ghana has 16); Reports "regions" are cities.

Dead or partial controls
22. Agent suggestion buttons are dead on: Dashboard (3 cards), Customers, Deliveries, Marketing, Inventory, Products (Make a bundle), Staff (Dismiss only), Settings (Show a revised Q4 plan), Inbox (Reschedule all to tomorrow, Turn on for Delivery). Finance Overview cards are dead too (only the "Show the 3 orders" button inside the reconciliation table works). Cards work on: Orders (Assign all 9), Checkout forms, Messages, Workflows, Inbox (Remind, Thread, Nudge), Finance Agent collections (reminders, review), Staff (assign AI / take it / hand over / pay), Connections (reconnect), Rep, Reports.
23. Dead on every admin page: store chip, avatar, "Start a stock count" and "Record a 3PL payout" in the ⌘K palette, agent drawer suggestion chips and the ask box.
24. Dead page-level buttons: Dashboard This month / Download report; Targets Add target; Customers Export / Add customer / all filter buttons / rows; Orders filters Product, Agent, Assigned to, Flagged by agent; Deliveries Upload CSV / Add delivery partner (tabs only highlight, no filtering); Settings Edit rules / Add status / Currencies Save and Use today's rate; Staff New role / Edit rule; Inbox New thread, Open item, Assigned-to-me row buttons; North Star setup Back and Save and set driver targets.
25. North Star setup: steps 4 (Driver targets), 5 (Invite your team), 6 (Rewards) have no screen; the "How should it grow?" switch does not change the quarter tiles; GH₵180k and ₦20,720 are hard-coded.
26. Agent app: WhatsApp and Maps buttons are dead; Call uses one fixed number; Twi and Ga text is a placeholder; no Earnings screen although Staff pay and an inbox row describe payouts.
27. Workflows has a "Shopify order import" workflow but Connections has no Shopify connection (only generic webhooks).
28. Orders: Delete in the bulk bar has no confirmation; Checkout forms and Workflows use the browser confirm for deletes; Staff Delete has no confirmation.
29. Customers "Search name or phone" is a button, not an input.
30. Reports: "Failed deliveries 402" tile counts failed + returned (354 + 48) while Orders tabs show them separately.
