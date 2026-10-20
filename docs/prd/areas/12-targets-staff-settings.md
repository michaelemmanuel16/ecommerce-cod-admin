# PRD area 12: Targets, staff and roles, connections, settings (F-1100 to F-1299)

Status: draft for owner review. Date: 2026-10-18. Writer: Builder C.
Sources: decisions.md (D3, D6, D8, D9, G1, G2, G4, G5, S1, S2, O1, O2, O3, O4, O5, O6), design doc sections 3 (decisions 4, 5), 4.7, 5.3, 8; gap-matrix 1.13, 1.14, 1.19, 1.20 and all of section 2; section 3 and 4 rows named in the coverage table; `NUMBERS.md`; mockups `index.html` (Targets, Leaderboard, North Star setup), `staff.html`, `connections.html`, `settings.html`, `inbox.html` (settings view); frontend inventory section 4; backend inventory sections 6 and 7.

## 1. Scope

- 1.13 Targets, Leaderboard, North Star (F-1100 to F-1149).
- 1.14 Staff and roles (F-1150 to F-1199).
- 1.19 Connections, 1.20 Settings and every row of gap-matrix section 2 (F-1200 to F-1299). All 93 rows of section 2 are in the coverage table.

Roles: Owner uses everything. Finance clerk, Marketer, Manager and Admin use the parts their tools allow. Call reps and delivery agents see their own reward progress in their own apps (read from the same settings).

Fixed numbers used (NUMBERS.md and decisions). All GH₵ and ₦ amounts in this file are sample values for the Manny Dynamics store. Money settings (rep commission, reward tiers, fee rules, North Star) are entered in the store currency (decision O3):
- North Star GH₵1,800,000 in 2026 at 35 percent net margin. Quarters 360k, 420k, 480k, 540k.
- Targets: confirmation rate 70 percent, delivery success rate 60 percent, call rep role target 723 confirmed orders that get delivered a month, planned yield 42 percent.
- Cash tiers only (D9): call rep 100 percent GH₵300, 120 percent GH₵500 plus a paid day off. Delivery 100 percent GH₵250, 120 percent GH₵400 plus a paid day off. No airtime tier. AI agents and companies get no payout.
- Rep commission GH₵8 for each order the rep confirms by call that is delivered (P6; auto-confirmed orders earn none). Upsell reward 10 percent of extra value, paid on delivery. A rep target counts confirmed orders that get delivered, counted at month close (P7).
- Delivery fee: one fee rule per partner in Settings (F1, F2). The partner keeps it from the cash it collects (F4). There is no second pay amount for agents (Removed (decision F1)).

---

# PART A. Targets, leaderboard, North Star (F-1100 to F-1149)

### F-1100: Target model and hierarchy
- Priority: P0. Milestone: M6.
- Description: One `Target` table holds the North Star, its quarters and months, role targets and person targets. A child target belongs to a parent. A role target is split between its holders. The system checks that children add up to the parent.
- Current app: none (monthly target GH₵180k is fixed in code).
- Mockup: `index.html#targets`.
- Acceptance criteria:
  - [ ] Scopes: `north_star` (year), `quarter`, `month`, `role`, `person`, `daily`.
  - [ ] Fixture: 2026 = 1,800,000; Q1 360,000, Q2 420,000, Q3 480,000, Q4 540,000; Oct, Nov, Dec = 180,000 each.
  - [ ] Children of a revenue target must sum to the parent. A save that breaks the sum is rejected with the difference shown.
  - [ ] Call rep role target 723 (confirmed orders that get delivered, P7) splits to people: Adwoa 423, Confirm agent 250, Nana 50 (sum 723). A split that does not sum is rejected.
  - [ ] Each target has: metric, unit, period, value, parent, owner (role or person).
  - [ ] Changing a parent shows a preview of children and asks to confirm.
  - [ ] Targets are tenant-scoped.
- Data: `Target` (id, tenantId, scope, metric, unit, periodStart, periodEnd, value Decimal, parentId, roleId nullable, userId nullable, closedAt). API: `GET /api/targets?scope&period`, `POST /api/targets`, `PUT /api/targets/:id`, `DELETE /api/targets/:id`.
- Permissions: view `targets:view`; edit `targets:update` (Owner).
- Edge cases and errors: Past, closed months cannot change (closed by F-916). A person removed from a role: their target goes back to the role pool with a notice.
- Tests: Unit: sum rule. Integration: fixture tree.

### F-1101: Targets page with margin at every level
- Priority: P0. Milestone: M6.
- Description: The page shows the North Star and a tree of quarters and months. Each node shows revenue and margin side by side, and a status.
- Current app: none.
- Mockup: `index.html#targets` header, North Star card, quarter tree.
- Acceptance criteria:
  - [ ] Header: "The North Star splits into quarters and months, with revenue and margin at each level." Buttons: Edit North Star (opens the wizard, F-1111), Add target (F-1103).
  - [ ] Card: "2026 North Star: GH₵1,800,000 delivered revenue at 35% margin", tag "77% done, 3 pts behind, margin 12% of 35%". Done % = year to date revenue / (year target x elapsed share is not used; it is revenue / North Star). Behind = difference between revenue share and time share (GUESS: formula behind pts = elapsed days share minus done share; check 77% done against ~80% of year elapsed on 18 Oct). Computed numbers follow the written formula, not the mockup sample (R1).
  - [ ] Quarter rows: Q1 GH₵372k of 360k (Revenue hit, margin 11% of 35%); Q2 421k of 420k (Revenue hit, margin 12%); Q3 497k of 480k (Revenue hit, margin 12%); Q4 92k of 540k (Behind, Oct margin -16% of 35%).
  - [ ] Status words: "Revenue hit, margin missed" when revenue is at or above target and margin is below target. Other states: Ahead, On track, Behind.
  - [ ] Month rows show revenue and margin (Aug 166k 12%, Sep 173k 12%, Oct 92k -16%).
  - [ ] Revenue and margin use delivery-date numbers (F-900, F-923). Margin includes the rep commission line and the one delivery fee line (R6; file 10). October margin is about -16 percent once the commission line is in (formula wins, R1); updated 2026-10-19.
  - [ ] Click on a month opens Finance for that month.
- Data: none new. API: `GET /api/targets/tree?year`.
- Permissions: `targets:view`.
- Edge cases and errors: A future month shows the target only. No margin data shows "n/a".
- Tests: Unit: status rules. Integration: tree on the fixture.

### F-1102: Role target groups
- Priority: P0. Milestone: M6.
- Description: A collapsible table "October targets by role": Who, Their target, Progress, Status, Reward at 100 percent. Groups: Call reps, Delivery, Marketing. The reward cell reads the one Rewards setting (F-1231).
- Current app: none.
- Mockup: `index.html#targets` table.
- Acceptance criteria:
  - [ ] Call reps: role target 723 confirmed orders that get delivered (P7); 376 of 723 (52 percent), "48% of confirmed delivered". Rows: Adwoa 423 target, 253 done (60 percent); Confirm agent (AI) 250, 110 (44 percent), "No payout"; Nana 50, 13 (26 percent). Confirmed (Adwoa 640, Confirm agent 328, Nana 58) stays as an activity column. Reward at 100 percent: GH₵300 for people.
  - [ ] Line "Feeds October GH₵180k: confirmed orders x delivery success x GH₵249" shows the planned AOV (F-1113).
  - [ ] Delivery: role target 60 percent delivery success; 48 percent now, 80 percent of target. Rows: Kofi 54 percent (82 delivered, On track, GH₵250); Esi 55 percent (48, On track, GH₵250); Kwesi 54 percent (26, On track, GH₵250); Logiswift 45 percent (220, Behind, "Contract review"); Kasapa Express (no closed orders, 8 out, "Too early", No payout). All five holders show here and on the leaderboard (section 4 item 21).
  - [ ] Delivery line "every +5 pts of delivery success adds about GH₵22k" is computed (orders x AOV x 5 points of the confirmed-to-closed base; GUESS: formula; check against NUMBERS.md +5 pts = GH₵22k).
  - [ ] Marketing: role target "CPA under max CPA"; ₦5,903 now, max ₦7,040 at 34 percent yield, ₦1,137 under. Holder Manny, On track.
  - [ ] No "80% airtime" text in any reward cell.
  - [ ] AI agents show in the group of the role they hold (design rule); never as their own group.
- Data: `Target` role and person rows. API: `GET /api/targets/roles?period`.
- Permissions: `targets:view`.
- Edge cases and errors: A role with no holder shows "Vacant". A holder added mid-month starts with a prorated target (GUESS: owner sets by hand).
- Tests: Integration: group rows on the fixture.

### F-1103: Add and edit target; daily activity target
- Priority: P1. Milestone: M6.
- Description: "Add target" opens a form. It can also create a daily activity target such as "Failed delivery calls 15" for call reps. The dashboard quest "Failed delivery calls 6 of 15" reads this target (section 4 item 20). It was a quest with no setting.
- Current app: none.
- Mockup: `index.html#targets` button (dead); dashboard quest.
- Acceptance criteria:
  - [ ] Form fields: Scope (role or person), Role or person, Metric (list from the KPI dictionary plus activity metrics), Period (month or day), Value.
  - [ ] Activity metrics: Failed delivery calls (count of calls on failed or returned orders) and Calls made.
  - [ ] Saved daily targets show on the rep Today page and the dashboard quest.
  - [ ] Edit and delete with a confirm dialog that shows the count of children changed.
  - [ ] Validation: value greater than 0; metric valid for the scope.
- Data: `Target.scope = daily`. API: as F-1100.
- Permissions: `targets:update`.
- Edge cases and errors: A daily target with no data source shows an error "No data for this metric".
- Tests: Unit: validation. E2E: add and see on dashboard.

### F-1104: Leaderboard, call reps
- Priority: P1. Milestone: M6.
- Description: A podium and ranking for the call rep role. AI agents rank under the role they hold.
- Current app: none (Customer Reps table dropped).
- Mockup: `index.html#board` tab Call reps.
- Acceptance criteria:
  - [ ] Podium: 1st Adwoa, 2nd Confirm agent (AI), 3rd Nana, with target %, confirmed and confirmation rate.
  - [ ] Table: Rank, Staff, Of role target (bar and %), Confirmed, Confirmation rate, Delivered from confirmed. "Of role target" counts confirmed orders that get delivered, at month close (P7). "Delivered from confirmed" = delivered ÷ closed confirmed orders of that rep (R3; NUMBERS.md: 253 ÷ 486 = 52%). Adwoa 60% / 640 / 73% / 52%; Confirm agent 44% / 328 / 70% / 44%; Nana 26% / 58 / 58% / 30%. (Confirmed stays as an activity column.)
  - [ ] Rank is by % of the person's own target (not by raw count).
  - [ ] The rewards card lists cash tiers only: 100 percent GH₵300; 120 percent GH₵500 plus a paid day off. Text "AI agents get no payout".
  - [ ] "Distance to the next tier" rows: Adwoa 120 more confirmed to 100 percent (GH₵300); Nana 14 more... is rewritten without the 80 percent tier (see F-1108).
- Data: none new. API: `GET /api/leaderboard?role&period`.
- Permissions: `targets:view`. Reps see their own rank only in their app.
- Edge cases and errors: Ties share a rank. A person with no target is not ranked.
- Tests: Unit: ranking. Integration: fixture.

### F-1105: Leaderboard, delivery
- Priority: P1. Milestone: M6.
- Description: Ranking for the Delivery role (persons and companies). It shows all five holders.
- Current app: none.
- Mockup: `index.html#board` tab Delivery.
- Acceptance criteria:
  - [ ] Table: Rank, Agent, Of 60% target, Success, Days to pay, Delivered. Esi 92% / 55% / 2.4 / 48; Kofi 90% / 54% / 1.8 / 82; Kwesi 90% / 54% / 3.1 / 26; Logiswift 75% / 45% / 9.2 / 220.
  - [ ] Kasapa Express shows with "Too early" (no closed orders) and is not ranked. Tab count shows 5 (the mockup shows 4).
  - [ ] Rewards: 100 percent GH₵250; 120 percent GH₵400 plus a paid day off. Companies get no bonus. "3PL below 80 percent of target: contract review" shows as a flag, not a payout. Logiswift at 75 percent shows the flag.
  - [ ] Badges come from one store (F-1109).
- Data: none. API: as F-1104.
- Permissions: `targets:view`.
- Edge cases and errors: Success rate uses closed orders only.
- Tests: Integration: fixture.

### F-1106: Leaderboard, upsell
- Priority: P1. Milestone: M7.
- Description: Upsell is separate from the target reward. It has its own tab.
- Current app: none.
- Mockup: `index.html#board` tab Upsell.
- Acceptance criteria:
  - [ ] Table: Rank, Staff, Upsell rate, Extra value (delivered), Reward earned. Adwoa 24% / GH₵6,100 / GH₵610; Confirm agent 15% / GH₵2,200 / No payout; Nana 9% / GH₵300 / GH₵30; All reps 20% / GH₵8,600 / GH₵640.
  - [ ] Card "How the reward works": 10% of the extra value; paid when delivered; AI agents no payout; packages 1 set GH₵249, 2 sets GH₵449, 3 sets GH₵629; add-ons pens GH₵40, grip trainer GH₵35, guide GH₵59. The prices come from the checkout form (F-1231).
- Data: none. API: as F-1104.
- Permissions: `targets:view`.
- Edge cases and errors: Zero upsell rows show an empty state.
- Tests: Integration: fixture.

### F-1107: Period select
- Priority: P1. Milestone: M6.
- Description: The leaderboard period select (Today, This week, October, 2026) changes the data. In the mockup it only changes the label.
- Current app: none.
- Mockup: `index.html#board` select.
- Acceptance criteria:
  - [ ] Each option reloads all three tabs for that period.
  - [ ] "October" follows the current month name.
  - [ ] Rewards and badges show only for month and year periods.
- Data: none. API: `period` parameter.
- Permissions: `targets:view`.
- Edge cases and errors: "Today" at 00:05 shows near-empty data with a note.
- Tests: Integration: period filter.

### F-1108: Reward progress (distance to the next tier)
- Priority: P1. Milestone: M6.
- Description: Cards show how far each person is from the next cash tier. The 80 percent tier is removed. Examples are rewritten.
- Current app: none.
- Mockup: leaderboard rewards cards; `rep.html` Today; `agent.html` Home.
- Acceptance criteria:
  - [ ] Call reps: distance in confirmed orders to 100 percent and then 120 percent of their own target. Adwoa 253 of 423: 170 more to GH₵300.
  - [ ] Delivery: distance in "deliveries with no failure" to the success target (GUESS: formula in the mockup, "12 more deliveries with no failure to 100%"; check). Kofi, Esi, Kwesi.
  - [ ] AI agents and companies show "No payout" and no distance line for payout (the progress bar still shows).
  - [ ] No line says airtime. Inbox and notification text for "80% reached" is removed.
  - [ ] The rep app, agent app and inbox read the same function.
- Data: none. API: `GET /api/rewards/progress?userId`.
- Permissions: Owner sees all. A person sees their own.
- Edge cases and errors: Person above 120 percent: "Top tier reached".
- Tests: Unit: distance math.

### F-1109: Result badges (one store)
- Priority: P2. Milestone: M6.
- Description: Badges come only from hitting or beating a target. One store feeds the leaderboard, Rewards tab, rep app and agent app (section 4 item 21: the mockup shows conflicting badge holders).
- Current app: none; no badge model.
- Mockup: leaderboard badges card; Settings Rewards "Result badges".
- Acceptance criteria:
  - [ ] Badges: Top of month (rank 1 at month close), Hit target 3 months running, Beat target by 20 percent, Zero unpaid over 8 days (delivery).
  - [ ] Awarded by the month-close job (F-916). Not edited by hand.
  - [ ] Each badge shows month and holder. Unawarded badges show "Locked, no one yet".
  - [ ] The Rewards tab shows the badge list once (no second copy on the North Star tab).
  - [ ] No XP, levels or streaks.
- Data: `BadgeAward` (tenantId, userId, key, period, awardedAt). API: `GET /api/badges?userId&period`.
- Permissions: `targets:view`.
- Edge cases and errors: A badge cannot be awarded twice for one period.
- Tests: Unit: each rule on a fixture.

### F-1110: Reward attainment at month close (G4)
- Priority: P1. Milestone: M6.
- Description: A target reward is earned at month close on delivery-date numbers (G4). This requirement defines attainment. F-916 (file 10) creates and posts the entries.
- Current app: none.
- Mockup: rewards cards.
- Acceptance criteria:
  - [ ] Attainment = actual / target for the month. Call rep: confirmed orders that get delivered, counted at month close (decision P7), on delivery-date numbers (G4). Delivery: delivery success rate / 60 percent.
  - [ ] Tier: 100 percent or more earns the 100 percent reward; 120 percent or more earns the 120 percent reward (the higher one only, not both).
  - [ ] The reward amount and the day-off note come from Settings, Rewards.
  - [ ] No reward before month close, even if 100 percent is hit mid-month. The UI shows "On track to earn GH₵300 at month close".
  - [ ] Humans only. AI agents and companies get none.
  - [ ] A person who held the role for part of the month is judged on their own target.
- Data: uses `RewardTier`, `Target`. API: `GET /api/rewards/attainment?period`.
- Permissions: `targets:view`.
- Edge cases and errors: No target set: no reward and a warning on the Targets page.
- Tests: Unit: tier pick at 99.9, 100, 119.9, 120.

### F-1111: North Star setup wizard
- Priority: P0. Milestone: M6.
- Description: A six-step wizard: Your store, Connect your 3PL, Set your North Star, Driver targets, Invite your team, Rewards. In the mockup, steps 4 to 6 have no screen and the growth switch does nothing. Build all steps. It is the first-run wizard and the only place to edit the North Star (also reached from Settings).
- Current app: `/onboarding` steps 1 and 2 (country, business).
- Mockup: `index.html#onboard`.
- Acceptance criteria:
  - [ ] Step 1 Your store: country (the store currency follows the country, F-1232), business name. Step 2 Connect your 3PL: adds the first partner; may be skipped. No partner key is created (O7).
  - [ ] Step 3 Set your North Star: annual revenue (default 1,800,000), growth mode (Even each month, Grow each quarter, Custom), quarter tiles that change when the mode changes, net margin target (35 percent), and the drivers in F-1112/F-1113 with live calculated tiles.
  - [ ] Step 4 Driver targets: shows role targets derived from the drivers (call rep 723 confirmed orders that get delivered, P7, delivery 60 percent, marketing max CPA) and lets the Owner split them to people.
  - [ ] Step 5 Invite your team: opens the invite form (F-1158).
  - [ ] Step 6 Rewards: link to Settings, Rewards (F-1231). The wizard does not hold a copy of the tiers (S1).
  - [ ] Buttons Back and "Save and set driver targets" work. Progress is saved per step; the wizard can be left and resumed.
  - [ ] The sidebar link "Set up North Star" stays until step 6 is done.
  - [ ] Done writes `Target` rows (F-1100) and sets onboarding done.
- Data: `User.preferences.onboardingCompleted` stays. API: `POST /api/north-star` (creates the tree), `GET /api/north-star`.
- Permissions: Owner.
- Edge cases and errors: Re-running after a year of data shows a warning that targets for past months do not change.
- Tests: E2E: complete the six steps. Unit: quarter math.

### F-1112: Settings, North Star and targets tab (inputs)
- Priority: P0. Milestone: M6.
- Description: The tab holds the North Star inputs. It shows no reward tiers. A one-line link says "Rewards are set in Rewards" (S1).
- Current app: none.
- Mockup: `settings.html` North Star and targets; `index.html#onboard`.
- Acceptance criteria:
  - [ ] Annual North Star (GH₵1,800,000, "Set on 2 Jan 2026"). Net margin target input (35 percent) — the mockup shows it without an input; add one.
  - [ ] Growth mode: Even each month (every quarter = annual / 4), Grow each quarter, Custom. Grow each quarter makes quarters step up by one thirtieth of the annual figure (Q1 360k, Q2 420k, Q3 480k, Q4 540k; GUESS: formula taken from the sample; owner confirms). Custom makes the four tiles editable; they must sum to the annual figure.
  - [ ] Months inside a quarter are equal (Q1 120k a month, Q4 180k).
  - [ ] Confirmation rate target (70 percent) and delivery success target (60 percent) inputs.
  - [ ] Role targets are not edited here; they are edited on the Targets page (F-1102, F-1103).
  - [ ] Driver tiles are read-only here: Orders a day, Confirmation rate, Delivery success rate, Max cost per order.
  - [ ] Button "Edit in setup" opens the wizard.
  - [ ] Save recalculates children after a confirm preview.
- Data: `Target` rows; targets for rates stored as `Target(metric = confirmation_rate | delivery_success_rate)`. API: `PUT /api/north-star`.
- Permissions: view `targets:view`; edit Owner.
- Edge cases and errors: Custom quarters that do not sum show the difference in red and block save.
- Tests: Unit: growth modes. Integration: recalculation.

### F-1113: Planned AOV and the calculators (S2)
- Priority: P0. Milestone: M6.
- Description: The planned AOV field has a default equal to the AOV of the last 30 days of actual orders. The owner can edit it. The calculators use it: orders a day needed and max CPA. AOV itself is computed and shown on Finance and Reports (S2). The typed "Average order value" field in Business details is removed.
- Current app: none.
- Mockup: `index.html#onboard` driver "Average order" and calculated tiles.
- Acceptance criteria:
  - [ ] Default planned AOV = average value of delivered orders over the last 30 days (decisions S2, R12), the same AOV as Finance. Fixture shows GH₵245; the mockup typed GH₵249.
  - [ ] An edit overrides the default. A "Reset to last 30 days" link restores it. The field shows which one is in use.
  - [ ] Orders a day = month revenue target / planned AOV / (confirmation target x success target) / real days in that month (decision R2). Fixture: 180,000 / 249 = 723; 723 / (0.70 x 0.60) = 1,721 orders; / 31 days in October = 55.5, shown as 56. A 30-day month divides by 30; February divides by 28 or 29. Never a fixed 30.
  - [ ] Max cost per order = profit per delivered order before ads x planned yield (confirmation target x success target = 42 percent), from the same function as Marketing (F-1007): ₦20,720 x 42 percent = ₦8,700. The month target (GH₵180k) and the ₦20,720 are no longer fixed in code.
  - [ ] Tiles update live as inputs change.
  - [ ] Hint under the tile shows the actual now (64 orders today, ₦7,040 at 34 percent).
- Data: `Target(metric = planned_aov)` with `source` (`auto` or `manual`). API: `GET /api/north-star/calculators?aov&conf&success`.
- Permissions: Owner.
- Edge cases and errors: No delivered orders in 30 days: default is empty and the field is required. Success or confirmation 0 is rejected.
- Tests: Unit: 56 (October, 31 days) and ₦8,700 on the fixture; a 30-day month gives 58; planned AOV default.

### F-1114: Rewards link only on the North Star tab (S1)
- Priority: P1. Milestone: M6.
- Description: Reward tiers live only in Settings, Rewards. The North Star and targets tab, the wizard, Targets and Staff show a one-line link or read the setting. The mockup showed the Rewards card on both screens.
- Current app: none.
- Mockup: `settings.html` North Star card with Rewards card (to remove).
- Acceptance criteria:
  - [ ] The tab has no tier list, no commission input and no badge list.
  - [ ] One line: "Rewards are set in Rewards." with a link.
  - [ ] Targets "Reward at 100%" column, Staff role detail and rep/agent apps read the Rewards setting (one source).
  - [ ] A test searches all UI strings for "airtime" and "80%" tier text and finds none.
- Data: none. API: none.
- Permissions: as F-1112.
- Edge cases and errors: none.
- Tests: String-grep test.

---

# PART B. Staff and roles (F-1150 to F-1199)

### F-1150: Role model
- Priority: P0. Milestone: M6.
- Description: A role is a position contract plus allowed tools plus KPIs (decision 4). A person (app), an AI agent (MCP) or a company (3PL by connector) can hold it. Roles are per tenant. Six start roles are seeded.
- Current app: seven fixed `UserRole` values and a permission matrix in `SystemConfig.rolePermissions`.
- Mockup: `staff.html` role cards.
- Acceptance criteria:
  - [ ] Fields: name, area (E-Myth area), contract {results, accountabilities, standards} (text), allowed tools (the 16 in F-1153), KPI list (names from the KPI dictionary), monthly target (optional), reward rule link.
  - [ ] Seed roles: Owner, Call rep, Delivery, Finance clerk, Marketing, Stock keeper.
  - [ ] Starter KPIs: Call rep = confirmation rate, delivered from confirmed, time to first call, upsell rate. Delivery = delivery success rate, days to pay, unpaid over 8 days. Finance clerk = unpaid delivered orders by age, payout short. Marketing = CPA against max CPA, yield. Stock keeper = stock gap per location. Owner = North Star revenue, net margin.
  - [ ] A holder can have more than one role (Manny holds Owner, Finance clerk, Marketing).
  - [ ] A role can be vacant.
  - [ ] AI agents are scored under the role they hold and get no payout.
  - [ ] Every role change writes an audit row (Builder A, F-1300 range).
- Data: `Role` (id, tenantId, name, area, contract JSON, tools JSON, kpis JSON, targetMetric, isSystem). `RoleAssignment` (roleId, holderId, fromDate, toDate). `User.kind` (`person`, `ai_agent`, `company`). API: `GET/POST/PUT/DELETE /api/roles`, `/api/roles/:id/assignments`.
- Permissions: view `users:view`; edit `users:update` (Owner; Admin cannot change the Owner role).
- Edge cases and errors: Deleting a role with holders is blocked ("Move N holders first"). The Owner role cannot be deleted or have tools removed.
- Tests: Integration: seed and assignment dates.

### F-1151: Role cards and role detail
- Priority: P0. Milestone: M6.
- Description: Six cards (and custom roles) show holders with type tags (Human, AI agent, Company), the October target, progress and "n of 16 tools allowed". A detail panel opens for the selected role.
- Current app: none.
- Mockup: `staff.html` role cards, detail panel, legend.
- Acceptance criteria:
  - [ ] Cards: Owner; Call rep (Adwoa, Nana, Confirm agent; 376 of 723 (52 percent), pace marker 55 percent, Behind); Delivery (Logiswift, Kofi, Esi, Kwesi, Kasapa Express; 48 percent now, Behind); Finance clerk (Manny; "Under 10 orders unpaid over 8 days", 38 now); Marketing (Manny; CPA under max CPA ₦7,040, ₦5,903 now); Stock keeper (vacant; "Stock gap under 2 units", 12 short).
  - [ ] Detail: Assign menu, monthly target block, "Reward rule" (read-only from Settings, Rewards; "Edit rule" opens Rewards), allowed tools, "Open call-rep view" and "Open delivery agent phone view" links.
  - [ ] The reward rule shows cash tiers only.
  - [ ] Counts and progress are computed.
  - [ ] Agent cards: stock keeper vacant; owner holds 3 roles; Kwesi owed GH₵312 with "Pay Kwesi" opening the payout form (F-913). Cards open screens; no writes (G10).
- Data: none new. API: `GET /api/roles/overview`.
- Permissions: `users:view`.
- Edge cases and errors: A holder removed shows in history, not on the card.
- Tests: Integration: card data on the fixture.

### F-1152: Assign a human, an AI agent or a company
- Priority: P0. Milestone: M6.
- Description: The Assign menu has three choices: Invite a person (email or phone, then send invite), Connect an AI agent (name, then create an MCP key limited to the role's tools), Add a company (name, then add).
- Current app: none.
- Mockup: `staff.html` Assign menu.
- Acceptance criteria:
  - [ ] Invite a person opens F-1158.
  - [ ] Connect an AI agent creates a user of kind `ai_agent` and an MCP key bound to the role (F-1208). The key is shown once.
  - [ ] Add a company creates a user of kind `company` with no login.
  - [ ] An existing user can be assigned without a new account.
  - [ ] Assigning writes `RoleAssignment` and an audit row.
- Data: `User.kind`. API: `POST /api/roles/:id/assign {holderId | new}`.
- Permissions: `users:create`.
- Edge cases and errors: Duplicate email is rejected. An AI agent cannot hold the Owner role.
- Tests: Integration: three assign paths.

### F-1153: Allowed tools (16 switches) and their permission mapping
- Priority: P0. Milestone: M6.
- Description: A role lists 16 tools: 7 read, 9 write. Each tool maps to cells of the permission matrix. The Owner's switches are locked.
- Current app: Role Permissions matrix with 10 resources.
- Mockup: `staff.html` "Allowed tools".
- Acceptance criteria:
  - [ ] Read tools: View orders (`orders:view`), View customers (`customers:view`), View stock (`products:view`), View payouts (`payouts:view`), View reports (`analytics:view`), View targets (`targets:view`), Export data (`analytics:export`).
  - [ ] Write tools: Update order status (`orders:update`), Assign orders (`orders:assign`), Call customers (`calls:create`), Message customers (`messages:create`), Edit products (`products:create`, `products:update`), Adjust stock (`products:update_stock`), Record payout (`payouts:create`), Edit targets (`targets:update`), Manage team (`users:create`, `users:update`).
  - [ ] New resources added to the matrix: `payouts` [view, create], `targets` [view, update], `marketing` [view, update], `messages` [view, create]; new action `analytics:export`.
  - [ ] Toggling a tool updates the "n of 16" count and saves the cells.
  - [ ] An MCP key for an AI agent can call only tools in its role (Builder A registry).
  - [ ] Finance, Marketing and Reports access follow `financial`, `marketing`, `analytics` cells; they are reached through "View reports" and the role's resource cells set in F-1154.
- Data: `Role.tools`; matrix cells in `SystemConfig.rolePermissions` become per role id. API: `PUT /api/roles/:id/tools`.
- Permissions: Owner.
- Edge cases and errors: Switching off "View orders" while "Update order status" is on is rejected ("Needs View orders"). Dependencies: every write tool needs its read tool.
- Tests: Unit: tool to cell map. Integration: effective permission from two roles.

### F-1154: Fine permission matrix under presets
- Priority: P1. Milestone: M6.
- Description: The 16 switches cover less than the current matrix (customers, GL, workflows, settings, order delete, bulk import, update stock, calls). Keep the matrix underneath. The tool switches are presets. An "Advanced permissions" panel on the role detail shows the full grid.
- Current app: Settings, Role Permissions (role select, search, Full Access, Read Only, Reset, Save).
- Mockup: not in mockup. Build in the v2 style: a collapsible `.card` "Advanced permissions" with a table of resources by actions as switches, search, "Full access", "Read only", "Reset to preset", Save.
- Acceptance criteria:
  - [ ] Resources: users, orders (create, view, update, delete, bulk_import, assign), customers, products (with update_stock), financial, gl, analytics (view, export), workflows (with execute), settings (view, update), calls, payouts, targets, marketing, messages.
  - [ ] Changing a cell marks the role "Custom" and updates tool switches that no longer match.
  - [ ] Save writes the matrix, clears the permission cache and emits `permissions:updated` (existing behaviour).
  - [ ] Defaults are the current `getDefaultPermissions` values per migrated role (F-1155).
  - [ ] Each save writes an audit row with before and after.
- Data: `Role.permissions` JSON (or matrix per role). API: `GET/PUT /api/roles/:id/permissions`.
- Permissions: Owner.
- Edge cases and errors: Removing `users:update` from the last role that has it is blocked.
- Tests: Integration: matrix save and cache clear.

### F-1155: Map the seven current roles to position roles
- Priority: P0. Milestone: M6.
- Description: Migrate each `UserRole` to a role without losing access. The enum stays as a base preset and for the role weight rule (`canManageRole`). Effective permission = union of the allow-lists of the roles a user holds.
- Current app: `UserRole`: super_admin, admin, manager, sales_rep, inventory_manager, delivery_agent, accountant.
- Mockup: five role names in `staff.html`.
- Acceptance criteria:
  - [ ] super_admin to Owner.
  - [ ] sales_rep to Call rep. delivery_agent to Delivery. accountant to Finance clerk. inventory_manager to Stock keeper.
  - [ ] admin to a custom role "Admin" with the current admin defaults (all create/view/update/delete except financial update/delete, settings update and products update_stock). GUESS: owner may prefer a different name.
  - [ ] manager to a custom role "Manager" with the current manager defaults (GUESS: owner may prefer Call-centre manager).
  - [ ] Marketing has no enum value. A holder of Marketing keeps a base role `manager` and gets the Marketing tools. GUESS: confirm or add a base role.
  - [ ] After migration each user can do exactly what they could do before (a test compares permissions for every user before and after).
  - [ ] Users with two roles get the union.
- Data: migration script; `RoleAssignment` rows. API: none.
- Permissions: run by Owner.
- Edge cases and errors: A custom matrix edited earlier by the Owner is copied to the role, not reset.
- Tests: Migration test: permission parity on a copy of production.

### F-1156: New role
- Priority: P2. Milestone: M6.
- Description: "New role" creates a custom role from a form. In the mockup the button is dead.
- Current app: none.
- Mockup: `staff.html` button.
- Acceptance criteria:
  - [ ] Fields: name, area, contract text, start from preset (copy tools of an existing role), KPIs.
  - [ ] Save opens the new role detail.
  - [ ] Name unique per tenant.
- Data: `Role`. API: `POST /api/roles`.
- Permissions: Owner.
- Edge cases and errors: Empty tools allowed (role with no access).
- Tests: E2E: create and assign.

### F-1157: Team table
- Priority: P0. Milestone: M6.
- Description: One table for people, AI agents and companies. Tabs: All, Active, Invited, Deactivated, with counts computed (section 4 item 23).
- Current app: Settings, User Management table.
- Mockup: `staff.html` team table.
- Acceptance criteria:
  - [ ] Columns: Name (and contact), Roles (chips), Type, Pay, Last active, Status, row menu.
  - [ ] Status values: Active, Working, Idle (n days), On trial, Payout short GH₵N, Invited, Deactivated. Computed from data.
  - [ ] Header counts ("10 on the team, 1 invited, 1 deactivated") are computed. The fixture table shows 12 rows.
  - [ ] Row menu: Edit, Record payout (people paid through the app), Manage key (AI agents) or Reset password, Deactivate or Reactivate, Delete.
  - [ ] "Pay" shows "GH₵8 per order confirmed by call and delivered + upsell" for reps, "Fee rule GH₵25 per delivered" for delivery partners (their delivery fee, kept from cash), or "No pay through the app". Companies and AI agents show "No payout" for rewards.
- Data: `User.lastLogin`, `invitedAt`, `kind`. API: `GET /api/staff?status&role&q`.
- Permissions: `users:view`.
- Edge cases and errors: Empty tab shows an empty state.
- Tests: Integration: counts.

### F-1158: Invite a person
- Priority: P0. Milestone: M6.
- Description: Replace "create user with password" by an invite. The person gets a link, sets their own password and opens the app. No invite flow exists today.
- Current app: `POST /api/admin/users` with password.
- Mockup: `staff.html` Person modal ("Send invite").
- Acceptance criteria:
  - [ ] Fields: Full name, Email, Phone, Role (Call rep, Delivery, Finance clerk, Marketing, Stock keeper and custom), How are they paid (GH₵8 per order confirmed by call and delivered + upsell reward / Delivery fee rule / No pay through the app), Amount (default 8; for Delivery the amounts come from the fee rule in Settings, F-703), and for Delivery: Vehicle (Motorbike, Car, Tricycle, Bicycle, On foot), Vehicle number, Location (city; "Orders in this city can be assigned to them").
  - [ ] Send invite emails or WhatsApps a link valid 7 days. The user status is Invited.
  - [ ] The link opens a page to set a password (rules as reset password) and then logs in.
  - [ ] Resend and revoke invite actions exist.
  - [ ] Basic-phone users (reps) can be invited by SMS link (Arkesel).
  - [ ] Seat limits are not enforced (plan limits are not enforced today).
- Data: `User.invitedAt`, `inviteTokenHash`, `inviteExpiresAt`. API: `POST /api/staff/invite`, `POST /api/staff/:id/resend-invite`, `POST /api/auth/accept-invite` (Builder A auth).
- Permissions: `users:create`. A user cannot invite a role above their own weight (`canManageRole`).
- Edge cases and errors: Email already used: error. Expired link: "Ask for a new invite".
- Tests: Integration: invite to login. Unit: token expiry.

### F-1159: Edit a person
- Priority: P1. Milestone: M6.
- Description: One modal edits name, email, phone, role, pay type and amount, and for Delivery the vehicle and location. A delivery partner's delivery fee is set in its one fee rule (Deliveries, F-703), not on this modal; the modal links to it (decisions F1, F2). Rep commission is one rule for all reps (Settings, Rewards); a per-person override can stay.
- Current app: Edit user, `AgentEditModal`, rep modal; `commissionAmount` sent also as the old `deliveryRate` field (removed, decision F1).
- Mockup: `staff.html` Person modal.
- Acceptance criteria:
  - [ ] Vehicle types: Motorbike, Car, Tricycle, Bicycle, On foot (the mockup list; map old values on migration).
  - [ ] The old "rep country" field is dropped.
  - [ ] The old `deliveryRate` field is removed. There is no pay-rate field for delivery agents; the fee rule replaces it (F1, F2).
  - [ ] Sample fee rule: Kofi GH₵25 per delivered order (F2).
  - [ ] Per-person rep override: "Use the company rule (GH₵8)" or a custom amount.
  - [ ] Changes write audit rows.
- Data: `User.repCommissionOverride`. API: `PUT /api/staff/:id`.
- Permissions: `users:update`.
- Edge cases and errors: A commission change applies to future deliveries only.
- Tests: Integration: change not applied to past entries.

### F-1160: Reset password, deactivate, reactivate, delete
- Priority: P1. Milestone: M6.
- Description: Keep the row actions. Delete is soft by default; permanent delete needs a typed confirm. One confirm dialog pattern with a count (section 4 item 29).
- Current app: `POST /api/admin/users/:id/reset-password`, `DELETE /users/:id`, `DELETE /users/:id/permanent`.
- Mockup: `staff.html` row menu.
- Acceptance criteria:
  - [ ] Reset password sends a reset link (preferred) or lets an admin type a new password.
  - [ ] Deactivate logs the user out at once (refresh tokens revoked, F-1224).
  - [ ] Permanent delete lists what will be removed or unlinked (orders keep the name).
  - [ ] The confirm dialog shows "Delete 1 person" with the count.
  - [ ] A user cannot delete or deactivate someone with higher weight.
  - [ ] Deactivating a person with open orders asks who takes them.
- Data: none. API: existing routes.
- Permissions: `users:update`, `users:delete`.
- Edge cases and errors: Last Owner cannot be deactivated.
- Tests: Integration: weight rule.

### F-1161: Filter by role and search
- Priority: P2. Milestone: M6.
- Description: The team table keeps role filter and search (the mockup has only status tabs).
- Current app: filters search, role, status.
- Mockup: not in mockup. Add a search input and a role select above the table.
- Acceptance criteria:
  - [ ] Search by name, email or phone; role select lists all roles.
  - [ ] Filters combine with status tabs.
- Data: none. API: query parameters on `GET /api/staff`.
- Permissions: `users:view`.
- Edge cases and errors: No result shows an empty state.
- Tests: Integration: combined filter.

### F-1162: Rep availability and workload
- Priority: P1. Milestone: M6.
- Description: Call reps and delivery agents have an availability switch. Assignment skips unavailable people. Workload shows open orders per person. The round-robin index is kept in Redis (it is in memory now).
- Current app: `User.isAvailable`, `PATCH /api/users/:id/availability`, `GET /api/users/reps/workload`, `assignmentService`.
- Mockup: not in mockup. Add an "Available" switch and an "Open orders" count to the team table and to the person modal.
- Acceptance criteria:
  - [ ] Switch in the team table for call reps and delivery people; the person can also set their own on the rep and agent app.
  - [ ] Unavailable users get no new auto-assigned orders; existing orders stay.
  - [ ] Workload column = open orders assigned.
  - [ ] Setting availability off during operating hours triggers no alert; it is logged.
  - [ ] Round-robin position survives a restart.
- Data: `User.isAvailable`. Redis key for round-robin. API: existing plus `GET /api/staff/workload`.
- Permissions: self or `users:update`.
- Edge cases and errors: All reps unavailable: orders wait in the queue and an alert goes to the Owner.
- Tests: Integration: assignment skip. Unit: round-robin after restart.

### F-1163: Menu per role
- Priority: P0. Milestone: M3/M6.
- Description: The sidebar shows only items the user may open. The mockup shows only the owner view. Rules by permission (Builder A builds the shell):

| Menu item | Needs |
|---|---|
| Dashboard, Inbox | any signed-in user |
| Orders | `orders:view` |
| Customers | `customers:view` |
| Checkout forms | `products:update` (GUESS: no form permission exists) |
| Workflows | `workflows:view` |
| Messages | `messages:view` |
| Products, Inventory | `products:view` (Stock keeper, Owner, Admin, Manager) |
| Deliveries | `orders:assign` or `users:view` |
| Finance | `financial:view` |
| Marketing | `marketing:view` |
| Reports | `analytics:view` |
| Targets, Leaderboard | `targets:view` |
| Staff and roles | `users:view` |
| Connections | `settings:view` |
| Settings | everyone (Profile, Security, Notifications) |

- Current app: `usePermissions.canAccessMenu`.
- Mockup: not in mockup.
- Acceptance criteria:
  - [ ] Finance clerk sees Dashboard, Orders (view), Finance, Reports, Inbox, Settings. Stock keeper sees Products, Inventory, Deliveries (view), Inbox, Settings. Marketing sees Marketing, Reports (marketing tab), Orders (view), Inbox, Settings.
  - [ ] Call reps open the rep screen and delivery agents the phone app, not this sidebar.
  - [ ] A direct URL to a hidden screen shows "No access" and logs nothing else.
  - [ ] Menu follows the effective permissions (F-1155).
- Data: none. API: `GET /api/auth/me` returns effective permissions.
- Permissions: as listed.
- Edge cases and errors: A user with no menu items besides Dashboard still opens the dashboard.
- Tests: Unit: menu per role fixture.

### F-1164: Pay card (rep, agent, history) with the one payout form
- Priority: P0. Milestone: M5/M7.
- Description: The Staff Pay card (October, people only) has three tabs and uses the one payout record and form from file 10 (F-913). It also holds the "pick delivered orders to pay" view.
- Current app: `RepPayoutModal` (pick orders), rep payouts only.
- Mockup: `staff.html` Pay card and Record payout modal.
- Acceptance criteria:
  - [ ] Tab Call reps: Call rep, Delivered orders, Commission (GH₵8 each), Upsell reward, Earned, Paid, Owed, Record payout. Adwoa 253 / 2,024 / 610 / 2,634 / 600 / 2,034; Nana 13 / 104 / 30 / 134 / 0 / 134; Confirm agent "No payout".
  - [ ] Tab Delivery agents: Agent, Vehicle, Location, Fee rule, Delivered, Failed, Fees kept, Cash held (collected minus fees minus deposited). Read-only: no "Owed" and no payout for fees (decisions F1, F4). The only payout for an agent is a target reward.
  - [ ] Delivered counts equal the Deliveries table (Kofi 82, Esi 48, Kwesi 26). The fee figures equal the fee rules times outcomes in Deliveries.
  - [ ] Tab Payout history: Date, Person, Amount, Method, Notes, Recorded by. Same history as Finance (one record).
  - [ ] Notes on the card: target bonuses are in Rewards; delivery fees are kept from collected cash, with links to Deliveries and Finance.
  - [ ] "Record payout" opens F-913's form. "Pick delivered orders" is the expandable list in that form.
  - [ ] Companies and AI agents never show "Record payout".
- Data: as file 10. API: as file 10.
- Permissions: `payouts:view`; record `payouts:create`.
- Edge cases and errors: As F-913.
- Tests: E2E: pay from Staff, see in Finance.

### F-1165: Derived counts and delete pattern
- Priority: P3. Milestone: M6.
- Description: Strings such as "10 on the team" and "12 shown" are computed. Delete confirms use one dialog with a count (section 4 items 23 and 29).
- Current app: static strings in the mockup only.
- Mockup: `staff.html` header.
- Acceptance criteria:
  - [ ] No hard-coded count text on Staff.
  - [ ] All delete flows in this area use the same dialog component with the item count.
- Data: none. API: none.
- Permissions: none.
- Edge cases and errors: none.
- Tests: Component test.

---

# PART C. Connections (F-1200 to F-1219)

### F-1200: Connections page
- Priority: P0. Milestone: M9.
- Description: One page lists every connection as a card with a status tag, key facts and actions. It replaces the Settings Integrations tab and the Webhooks page. It shows no sync status for any partner, Logiswift included (decision O1).
- Current app: Settings, Integrations; `/webhooks`.
- Mockup: `connections.html`.
- Acceptance criteria:
  - [ ] Cards: Arkesel SMS, WhatsApp Business, Email, Paystack, Meta Ads, Checkout website, CSV upload, AI agent keys (MCP), Webhooks.
  - [ ] "Add connection" menu offers SMS, WhatsApp, email, Paystack, Meta Ads.
  - [ ] Each card opens a configuration modal (Edit, Reconnect, Choose ad accounts, Send a test).
  - [ ] Agent cards: "WhatsApp token expires in 3 days" (Reconnect with Meta); "A Meta campaign has no product" (opens the mapping). No writes.
  - [ ] A button "Messages" links to Messages.
  - [ ] Secrets are write-only and masked.
  - [ ] Secrets are encrypted at rest (existing `providerCrypto`).
- Data: none. API: `GET /api/connections` (status per card).
- Permissions: view `settings:view`; edit `settings:update` (Owner).
- Edge cases and errors: A card in error shows the reason and a retry.
- Tests: Integration: status endpoint. E2E: open each modal.

### F-1201: Arkesel SMS
- Priority: P1. Milestone: M9.
- Description: Keep SMS settings and add back the delivery report webhook URL.
- Current app: Settings, SMS (authToken, senderId, isEnabled, testPhone, webhook URL).
- Mockup: Arkesel card and modal.
- Acceptance criteria:
  - [ ] Fields: API key (show/hide, masked after save), Sender ID (max 11 characters), Enabled, Send a test to (number).
  - [ ] The read-only delivery report webhook URL `<api>/api/sms/webhook` with Copy (missing in the mockup).
  - [ ] Card facts: Sender ID, API key masked, Credit left (GUESS: Arkesel balance API exists; check), Last message.
  - [ ] Test SMS result shows in the activity log (F-1213).
  - [ ] Sits behind the provider interface (send, status webhook, inbound).
- Data: `SystemConfig.smsProvider` unchanged. API: `PUT /api/admin/settings`, `POST /api/sms/test`.
- Permissions: Owner.
- Edge cases and errors: Invalid key shows the provider message.
- Tests: Integration: save and test.

### F-1202: WhatsApp Business
- Priority: P1. Milestone: M9.
- Description: Two modes: Connect with Meta (OAuth) and Use a token. Add the quality rating and the phone picker the mockup omits. Move the OAuth pending state from memory to Redis (section 3 item 41).
- Current app: Settings, WhatsApp (OAuth tab, manual tab); `whatsappOAuthController`.
- Mockup: WhatsApp card and modal.
- Acceptance criteria:
  - [ ] Connect with Meta: Connect, phone picker with quality rating (Green, Yellow, Red), Reconnect, Disconnect.
  - [ ] Use a token: Access token, Phone number ID, Business account ID, App secret, Webhook verify token, Enabled, Test connection.
  - [ ] Card shows phone number, business account, "Connected by Meta login", Templates approved count, token expiry, and a warning strip within 7 days.
  - [ ] OAuth state is stored in Redis with a 10 minute expiry; two server instances work.
  - [ ] Token expiry within 7 days creates an inbox alert (Builder B1).
- Data: `SystemConfig.whatsappProvider` unchanged. API: existing `/api/whatsapp/*`.
- Permissions: Owner.
- Edge cases and errors: OAuth state missing: "Start again".
- Tests: Integration: OAuth callback with Redis state.

### F-1203: Email
- Priority: P2. Milestone: M9.
- Description: Provider SendGrid, Resend or SMTP. The modal adds SMTP host, port, username, password, secure.
- Current app: Settings, Email (provider, apiKey, from, name; SMTP fields in type).
- Mockup: Email card and modal.
- Acceptance criteria:
  - [ ] Fields as the mockup: Provider, API key or SMTP host, port, username, password, From name, From email, Send a test.
  - [ ] Card facts: provider, from, "Sent this month" (count from `MessageLog`).
  - [ ] Password and key masked.
- Data: `SystemConfig.emailProvider`. API: `POST /api/email/test`.
- Permissions: Owner.
- Edge cases and errors: SMTP error text shown on test.
- Tests: Integration: save and test.

### F-1204: Paystack behind a provider interface (G1)
- Priority: P0. Milestone: M9.
- Description: Keep Paystack. Build payments behind a provider interface so another provider can replace or join it. Paystack works as today (decision O2). Digital products pay online now; prepaid physical orders come later (G1). Remove the legacy Paystack webhook (section 3 item 38).
- Current app: Settings, Paystack (mode, public key, secret key, enabled, webhook URL); `paystackService`; legacy `POST /api/paystack/webhook` (sunset 2026-09-01 overdue); form copy "Nigeria only".
- Mockup: Paystack card (test mode) with warning "Real customers cannot pay yet".
- Acceptance criteria:
  - [ ] Interface `PaymentProvider`: `initialize`, `verify`, `verifyWebhook`, `supportedCurrencies`, `supportedChannels`, `refund` (GUESS: refund not needed yet; leave unimplemented). Paystack is the first adapter. Provider id is stored on `PendingCheckout` and `Order`.
  - [ ] Paystack adapter supports the currencies and channels the Paystack account offers (decision O2). The currency comes from the form/store currency.
  - [ ] Card fields: Mode (Test, Live), Public key, Secret key (masked), Enabled, Webhook URL with Copy.
  - [ ] Warning text depends on mode: Test mode shows "Test mode: no real money moves". Live mode shows no warning. The line "Real customers cannot pay yet" is removed (section 4 item E4).
  - [ ] "Nigeria only" copy on the payment methods is removed.
  - [ ] The legacy `POST /api/paystack/webhook` handler is deleted. Tenant webhook `/webhook/:tenantSlug` stays with its HMAC and idempotency.
  - [ ] Physical forms show COD only until a form flag turns on prepaid (Builder B1, CF-09); digital forms use Paystack.
  - [ ] A second provider can be added by writing one adapter and one card; no change to order creation.
- Data: `PendingCheckout.providerId`. API: `POST /api/payments/initialize` and `/verify` call the interface. Existing public routes keep their paths.
- Permissions: Owner.
- Edge cases and errors: Live keys in test mode (key prefix mismatch) are rejected (existing check). Webhook with a bad signature returns 401 and logs.
- Tests: Unit: adapter contract tests. Integration: payment init with a stub. Test that the legacy route returns 404.

### F-1205: Meta Ads connection card
- Priority: P1. Milestone: M8.
- Description: The card shows the ad accounts with switches, last pull time, spend this month and the unmapped strip. "Choose ad accounts" opens switches per account. "Connect another account" starts OAuth (F-1000).
- Current app: none.
- Mockup: Meta Ads card and modal.
- Acceptance criteria:
  - [ ] Accounts list with name, currency (from Meta, F-1002) and a switch. Fixture: Magic Groove GH ₦6.9M, Manny Dynamics NG ₦1.63M, Old test account (off).
  - [ ] Facts: Ad accounts 2 of 3 on; Pulled every hour; Last pull; Spend in October ₦8.53M.
  - [ ] Strip "1 campaign has no product" links to the mapping (F-1003).
- Data: `MetaAdAccount.enabled`. API: F-1000.
- Permissions: Owner.
- Edge cases and errors: All accounts off: pull stops and the card says so.
- Tests: Integration: toggle changes the pull set.

### F-1206: Checkout website card (read-only summary)
- Priority: P2. Milestone: M9.
- Description: Tracking is set per form only (section 4 item 7). The card shows a read-only summary: site, orders arrive Live, last order, tracking status per form. The second pixel field and the "Send server events" switch are removed.
- Current app: tracking per form only.
- Mockup: Checkout website card (site, Meta pixel ID, "Send server events").
- Acceptance criteria:
  - [ ] Shows each active form with its pixel ID (masked to last 4) and "Server events on/off" (CAPI token set).
  - [ ] Each row links to that form's Tracking tab.
  - [ ] "Send a test order" creates a test order marked as test (excluded from reports) and shows the result in the activity log (GUESS: no test-order flag exists; add `Order.isTest`).
  - [ ] No pixel input on this card.
- Data: `Order.isTest` (Boolean). API: `GET /api/connections/checkout`.
- Permissions: `settings:view`.
- Edge cases and errors: No active form: card says "Create a checkout form".
- Tests: Integration: test orders excluded from KPIs.

### F-1207: CSV upload card
- Priority: P2. Milestone: M9.
- Description: A card for partners without a portal (individual agents, trial 3PL). Rows match by phone and order number. It opens the Deliveries CSV upload (Builder B2, DL-14) and offers a template download.
- Current app: none.
- Mockup: CSV upload card.
- Acceptance criteria:
  - [ ] Card shows last upload and result ("24 matched, 2 not found").
  - [ ] Buttons: Upload CSV (opens the Deliveries upload), Download template.
  - [ ] The upload history is read from the importer log.
- Data: importer log (Builder B2). API: template download endpoint.
- Permissions: Owner, Manager.
- Edge cases and errors: none new.
- Tests: Integration: template columns.

### F-1208: AI agent keys (MCP) with a role
- Priority: P0. Milestone: M2.
- Description: MCP keys have a label (max 50) and a role. The key is bound to an AI agent user (Builder A registry, F-1300 range). The key shows once. The list shows role, tool count, masked key, last used, Revoke.
- Current app: `/api/mcp-keys` (label only); Settings AI Assistant card with remote and local config tabs.
- Mockup: AI agent keys card and create form.
- Acceptance criteria:
  - [ ] Create form: Name, Role (select). The generated key and the config JSON (Remote recommended, Local stdio) show once with setup steps.
  - [ ] List shows three sample keys: Confirm agent, Manny's Claude, Stock-count agent, each with role, tool count, key prefix, last used, Revoke.
  - [ ] Revoke asks for confirm. The key stops working within 60 seconds (existing cache time).
  - [ ] Link "Roles and tools" opens Staff and roles.
  - [ ] Key creation writes an audit row.
- Data: `McpApiKey.userId`, `roleId`. API: `GET/POST/DELETE /api/mcp-keys` (role added).
- Permissions: Owner.
- Edge cases and errors: A role with zero tools cannot get a key.
- Tests: Integration: key bound to role limits tools.

### F-1209: Inbound order webhooks: create, list, status
- Priority: P1. Milestone: M9.
- Description: Keep order import webhooks. A form creates one (Name, Product). The table shows Name and product, Import URL (copy), Key (copy), Last request, Today count and a Status switch.
- Current app: `/webhooks` page (admin roles), `webhookService`.
- Mockup: Webhooks card and table.
- Acceptance criteria:
  - [ ] Create webhook: Name, Product, then the detail opens.
  - [ ] Table as described; the selected row opens the detail card.
  - [ ] Status switch enables or pauses the import.
  - [ ] Failing webhook shows a red tag with the last error (for example "phone field missing").
  - [ ] Rows: Magic Groove checkout, Landing page B (failing), Guide order form.
- Data: `WebhookConfig` unchanged. API: existing `/api/webhooks`.
- Permissions: Owner, Admin.
- Edge cases and errors: Duplicate name allowed.
- Tests: Integration: create and import.

### F-1210: Webhook secret, custom headers, edit, delete
- Priority: P1. Milestone: M9.
- Description: The mockup drops the Security tab. Keep it: a secret (min 16 characters, with generate), "require signature", custom headers and edit and delete with confirm.
- Current app: WebhookForm Security tab.
- Mockup: not in mockup. Add to the detail card a tab "Security": Secret (show once, Generate), Require signature switch, Custom headers (key and value rows), Edit name and product, Delete webhook.
- Acceptance criteria:
  - [ ] Secret at least 16 characters; stored encrypted; shown once.
  - [ ] When "Require signature" is on, requests without a valid HMAC get 401.
  - [ ] Custom headers saved and listed in "How to send".
  - [ ] Delete shows the count of logs removed and asks for confirm.
  - [ ] Key rotation button creates a new key and keeps the old one for 24 hours (GUESS: new; remove if not wanted).
- Data: `WebhookConfig.secret`, `headers`, `requireSignature`. API: existing.
- Permissions: Owner, Admin.
- Edge cases and errors: Short secret rejected.
- Tests: Integration: signature on and off.

### F-1211: Webhook field mapping, logs, retry
- Priority: P1. Milestone: M9.
- Description: Field mapping maps their field to a CodAdmin field. Logs list requests with status. A failed log can be retried.
- Current app: `FieldMappingEditor`, `WebhookLogs` (30-day stats, retry).
- Mockup: webhook detail tabs.
- Acceptance criteria:
  - [ ] Mapping rows: their field to CodAdmin field (Customer name, phone, email; Delivery address; City or region; Landmark; Product SKU; Quantity; Order total; Notes) with an example value. "Add a field" works.
  - [ ] Phone is required. The mockup says "Name and phone are required"; the code requires phone only. Keep phone only (GUESS: confirm).
  - [ ] Logs tab: All and Failed filters; Time, Status, Request, Response, Error; row expands. Retry works for failed rows.
  - [ ] "How to send": POST URL, `X-Webhook-Key` header, copy buttons, warning text.
  - [ ] Region field maps to the regions of the store's country.
- Data: `WebhookConfig.fieldMapping`, `WebhookLog`. API: existing; `WebhookLog` gets `tenantId`.
- Permissions: Owner, Admin.
- Edge cases and errors: Unknown field value is stored in notes.
- Tests: Integration: mapping and retry.

### F-1212: Webhook test with sample JSON
- Priority: P2. Milestone: M9.
- Description: A Test tab lets the user paste sample JSON and see how it maps. It does not create an order.
- Current app: WebhookForm Test tab (needs a saved webhook).
- Mockup: not in mockup. Add a tab "Test" with a JSON box, "Run test" and a result table.
- Acceptance criteria:
  - [ ] "Run test" shows each CodAdmin field and the mapped value, and which required fields are missing.
  - [ ] No order is created and no message is sent.
  - [ ] Works only for a saved webhook.
- Data: none. API: `POST /api/webhooks/:id/test`.
- Permissions: Owner, Admin.
- Edge cases and errors: Invalid JSON shows the parse error line.
- Tests: Integration: dry run.

### F-1213: Activity log
- Priority: P2. Milestone: M9.
- Description: One log for all connections for the last 6 days (configurable): tabs All, Failed, Warnings with counts; columns Time, Connection, What happened, Result, Detail.
- Current app: `WebhookLog` only.
- Mockup: Activity card.
- Acceptance criteria:
  - [ ] Events: test sent, token refreshed, token expiring, pull failed, webhook failed, message provider error.
  - [ ] Counts are computed.
  - [ ] No sync events for any partner appear (decision O1).
- Data: `ConnectionEvent` (tenantId, connection, type, result, detail, createdAt). API: `GET /api/connections/activity`.
- Permissions: `settings:view`.
- Edge cases and errors: Log kept 90 days.
- Tests: Integration: event write and filter.

### F-1214: Removed (O7): partner key card
- Status: REMOVED by decision O7 (owner, 2026-10-19). Do not build.
- What replaces it: nothing on Connections. Outside agents use the normal API or MCP key (card "AI agent keys (MCP)") with the permissions they need, including the payout permission for F-906.
- Removed with it: the "Partner keys" card (CN-14), `PartnerConnector`, `GET/POST/DELETE /api/connections/partners`, M5-T33. See F-718.
- Later: a scoped per-partner key may be added when a third party needs to call the API.

### F-1215: Old integration links
- Priority: P3. Milestone: M3.
- Description: `/settings/integrations` has no route; the checkout editor help text links to it (section 3 item 24). Point it to Connections and redirect old URLs (`/settings?tab=integrations`, `?oauth=`, `/webhooks`).
- Current app: broken link in `CheckoutFormEditor`.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] `/connections` is the route. Old paths redirect with their `section` and `oauth` parameters.
  - [ ] The OAuth callback returns to Connections.
  - [ ] The editor link opens Connections.
- Data: none. API: none.
- Permissions: as Connections.
- Edge cases and errors: none.
- Tests: E2E: redirects.

---

# PART D. Settings (F-1220 to F-1299)

### F-1220: Settings shell and tab visibility
- Priority: P0. Milestone: M3.
- Description: Settings has ten sections: Profile, Security, Business details, Operations, North Star and targets, Rewards, Currencies and FX, Order statuses, Notifications, Billing and plans. Tabs show by permission, not only for super_admin. Today an `admin` sees none of the admin tabs (section 3 item 5).
- Current app: `Settings.tsx`, `visibleTabs = tabs.filter(!adminOnly || isSuperAdmin)`.
- Mockup: `settings.html` left section menu.
- Acceptance criteria:
  - [ ] Profile, Security, Notifications: every signed-in user.
  - [ ] Business details, Operations, Order statuses, Currencies and FX: view with `settings:view`, edit with `settings:update`.
  - [ ] North Star and targets: view `targets:view`, edit `targets:update`.
  - [ ] Rewards: view `targets:view`, edit Owner.
  - [ ] Billing and plans: Owner only.
  - [ ] Admin (default `settings:view`) sees the view-only tabs and cannot save.
  - [ ] The menu has no separate "Rewards inside North Star" screen (S1).
  - [ ] Save buttons are per tab; the global "Save changes" toast in the mockup is replaced by real saves.
  - [ ] Agent cards on Settings: "Delivery success of 48% keeps Q4 behind", "Your FX rate is N days old" (manual rates only), "You will pass your plan limit" (only when the plan has a limit). They open screens.
- Data: none. API: permission checks.
- Permissions: as above.
- Edge cases and errors: A tab with no access is hidden, and a direct URL shows "No access".
- Tests: Integration: tab list per role. E2E: admin view-only.

### F-1221: Profile
- Priority: P0. Milestone: M3.
- Description: Profile save works. Fields: first and last name (two columns, one "Full name" input in the UI), display name, email, phone, language (English only), current role and member since (read-only).
- Current app: Profile tab; save has no handler. `PUT /api/users/:id` is for admin roles only.
- Mockup: Settings, Profile.
- Acceptance criteria:
  - [ ] "Save profile" calls a new self-service route and updates the user. Success toast; header name updates.
  - [ ] Full name splits on the last space into first and last name (single-word names go to first name).
  - [ ] Display name (new column) shows to the team in notes and assignments.
  - [ ] Email is unique per system; a change sends a confirmation link to the new address and takes effect after it (GUESS: confirm needed; simple option: change at once with a notice to the old address).
  - [ ] Phone placeholder is a Ghana number (+233 24 000 0000), not "+1 (555)".
  - [ ] Language shows English; other options are hidden (D1, O3).
  - [ ] Time zone is not here; it lives in Business details (section 4 item 8).
  - [ ] Sales reps could not edit names before; they can now edit their display name and phone, not their role.
- Data: `User.displayName`. API: `PATCH /api/users/me` (self; whitelist of fields).
- Permissions: any user for their own profile.
- Edge cases and errors: Email already in use: error. Empty name rejected.
- Tests: Integration: self update and whitelist. E2E: save and reload.

### F-1222: Profile photo
- Priority: P3. Milestone: M3.
- Description: "Change photo" uploads an image to R2 and shows it in the top bar and in notes.
- Current app: none; R2 upload exists.
- Mockup: button (toast).
- Acceptance criteria:
  - [ ] jpeg, png, webp up to 5 MB; cropped square.
  - [ ] Photo URL on the user; removal button.
  - [ ] Falls back to initials.
- Data: `User.photoUrl`. API: `POST /api/users/me/photo`.
- Permissions: self.
- Edge cases and errors: Upload failure keeps the old photo.
- Tests: Integration: upload.

### F-1223: Change password
- Priority: P0. Milestone: M3.
- Description: Password change works for every role. Today the form is not wired and non-admin roles see "restricted". No change-password endpoint exists.
- Current app: Security tab form, no handler; no route.
- Mockup: Settings, Security, Password card.
- Acceptance criteria:
  - [ ] Fields: Current password, New password (at least 8 characters, with upper, lower, digit, special as the register rule), Repeat new password.
  - [ ] `POST /api/auth/change-password` checks the current password, sets the new one and revokes other sessions (keeps this one).
  - [ ] Wrong current password: error and a rate limit (5 tries per 15 minutes).
  - [ ] All roles see the form.
  - [ ] Success toast and an audit row.
- Data: none. API: `POST /api/auth/change-password` (Builder A auth owns the route; this requirement owns the form).
- Permissions: self.
- Edge cases and errors: New equals current: rejected. Passwords over 72 characters rejected (bcrypt limit).
- Tests: Integration: change and re-login. Unit: rules.

### F-1224: Signed-in sessions and sign out elsewhere
- Priority: P2. Milestone: M3.
- Description: The Security tab lists sessions (device, last seen, "This device"), with Sign out for each and "Sign out everywhere else". Today a user has one refresh token, so a session store is needed (section 2.2 fix list).
- Current app: `User.refreshToken` (one).
- Mockup: Security, "Where you are signed in".
- Acceptance criteria:
  - [ ] Each login creates a `UserSession` with a hashed refresh token, a device label (browser and OS) and the last IP.
  - [ ] List shows device, place (city from IP if known; GUESS: no geo service; show the IP only), last seen.
  - [ ] Sign out ends one session; "Sign out everywhere else" ends all but this one.
  - [ ] Deactivating a user ends all sessions (F-1160).
  - [ ] Refresh rotation works per session.
- Data: `UserSession` (id, userId, tenantId, tokenHash, deviceLabel, ip, lastSeenAt, createdAt). `User.refreshToken` removed after migration. API: `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-others`.
- Permissions: self.
- Edge cases and errors: Refresh with a revoked token returns 401 and logs out.
- Tests: Integration: two sessions, revoke one.

### F-1225: Export my data
- Priority: P3. Milestone: M3.
- Description: A button downloads the user's data. The scope is unclear in the sources (GUESS). Rule used here: a person gets their profile, sessions, notification settings, payouts, calls they logged and orders they created, as a ZIP of CSV files. The Owner gets the same plus a business export (orders, customers, products, expenses, journal entries).
- Current app: none.
- Mockup: Security, Danger zone button.
- Acceptance criteria:
  - [ ] Direct download, no stored file (G8 style).
  - [ ] The Owner export has one CSV per table with the tenant's rows only.
  - [ ] Export writes an audit row.
- Data: none. API: `GET /api/users/me/export`.
- Permissions: self; business export Owner.
- Edge cases and errors: Large tenant export streams.
- Tests: Integration: tenant isolation of the export.

### F-1226: Delete account
- Priority: P2. Milestone: M3.
- Description: Owner only. Keep the password check and add the typed word DELETE. This removes the login, all orders, customers and messages.
- Current app: `DELETE /api/auth/delete-account {password}`; raw SQL delete of tenant data.
- Mockup: confirm box (type DELETE).
- Acceptance criteria:
  - [ ] The button "Delete everything" is enabled only when "DELETE" is typed and the password is entered.
  - [ ] Text lists what will be removed. The mockup mentions "both stores"; remove it (multi-store is out).
  - [ ] An audit row is written before the delete. A final export link is offered first.
  - [ ] A tenant with an active paid subscription must cancel first.
- Data: none. API: existing route with `confirm: "DELETE"`.
- Permissions: Owner.
- Edge cases and errors: Wrong password: error and rate limit.
- Tests: Integration: delete in a test tenant removes only that tenant's rows.

### F-1227: Notifications tab (pointer) and My Notifications wiring
- Priority: P1. Milestone: M9.
- Description: Settings, Notifications is a link card to the Inbox settings view. The two dead toggles (Order updates, Payment notifications) are dropped. "My Notifications" is wired through the preference store in F-1228.
- Current app: My Notifications tab with two local toggles.
- Mockup: Settings, Notifications link card "Notification settings live in Inbox".
- Acceptance criteria:
  - [ ] The card has a button "Open Inbox settings".
  - [ ] The old toggles are removed. Any user who had them off gets matching entries in the new matrix (migration: Order updates off turns off "Order assigned to me"; Payment off turns off "Payout short or late"). GUESS: the toggles never saved, so there is nothing to migrate; check `preferences`.
  - [ ] The page is open to every role.
- Data: none. API: none.
- Permissions: all signed-in users.
- Edge cases and errors: none.
- Tests: E2E: link opens the Inbox settings view.

### F-1228: Notification preferences store
- Priority: P1. Milestone: M9.
- Description: One store serves the Inbox settings view, the agent app switches (section 4 item 9) and the rep app. The Inbox settings screen belongs to Builder B1 (F-550 range); this requirement owns the data and API.
- Current app: none.
- Mockup: `inbox.html#settings`; `agent.html#more`.
- Acceptance criteria:
  - [ ] My alerts: nine events by four channels (In-app, WhatsApp, Email, SMS): Order assigned to me; Delivery failed; Customer replied; Mentioned in a thread; Reminder due; Payout short or late; Stock gap; Target milestone; Agent finding. The event "Target milestone" now says "100% or 120% reached" (no 80 percent).
  - [ ] Role defaults matrix (Call rep, Delivery, Finance clerk, Marketing by the same four channels) set by the Owner. "Apply to team" copies defaults to every person of the role who has not changed their own; a confirm dialog shows the count.
  - [ ] Quiet hours: switch, From 21:00, To 07:00, "Still send short payouts and failed deliveries".
  - [ ] Daily digest: switch, time 08:00, channel (WhatsApp or Email), "Remind me if not done after" (4 hours, 1 day, 2 days, Never).
  - [ ] Agent app switches (New orders, Reminders, Team messages, Reward updates) read and write the same matrix: New orders = Order assigned to me; Reminders = Reminder due; Team messages = Mentioned in a thread; Reward updates = Target milestone.
  - [ ] A new user gets the role defaults on first login.
  - [ ] The sender checks the preference before sending and respects quiet hours.
- Data: `NotificationPreference` (userId, tenantId, event, channel, enabled). `RoleNotificationDefault` (tenantId, roleId, event, channel, enabled). `User.preferences.quietHours`, `.digest`. API: `GET/PUT /api/notification-preferences`, `GET/PUT /api/notification-preferences/role-defaults`, `POST /api/notification-preferences/apply-defaults`.
- Permissions: own preferences: self. Role defaults: Owner.
- Edge cases and errors: A channel not connected (WhatsApp not set up) shows the switch disabled with a hint.
- Tests: Unit: quiet-hours logic. Integration: apply defaults.

### F-1229: Operations tab (G5, D6)
- Priority: P0. Milestone: M7.
- Description: A new tab holds the settings that run the queue: operating hours, queue wait alert, time to first call target, default days to pay, low stock days of cover. The time-to-first-call clock runs only inside the operating hours (G5, D6).
- Current app: `SystemConfig.operatingHours` (JSON, no UI); low stock is units per product.
- Mockup: not in mockup. Build in the v2 style: a `.card` per group with a weekly grid.
- Acceptance criteria:
  - [ ] Operating hours: seven rows (Monday to Sunday) with Open, Close and an Enabled switch. Time zone is the tenant time zone (F-1230). Stored as `{day: {open, close, enabled}}`.
  - [ ] Queue wait alert: minutes, default 30.
  - [ ] Time to first call target: minutes, default 15 (D6). Alert at 30. Time to first call = time to the first rep call attempt, inside operating hours (R10).
  - [ ] Default days to pay: number, default 7 for new partners (GUESS: 7 comes from the forecast text "new deliveries paid after 7 days"). Each partner overrides in Deliveries.
  - [ ] Low stock days of cover: default 14; per-product override in the product drawer.
  - [ ] Time to first call counts only minutes inside operating hours. An order at 22:00 with opening at 08:00 starts counting at 08:00. Only the rep call clock waits; the auto-confirm message goes out at once, also outside operating hours (P4).
  - [ ] A customer YES reply to auto-confirm confirms the order and closes the clock. The order counts as "auto-confirmed", not as a rep call (R10).
  - [ ] If no hours are set, the clock counts all hours and a notice says so.
  - [ ] Validation: close after open; at least one day enabled.
- Data: `SystemConfig.operatingHours` (existing), `queueWaitAlertMinutes`, `firstCallTargetMinutes`, `defaultDaysToPay`, `lowStockDaysOfCover`. API: `PUT /api/admin/settings` (new keys).
- Permissions: view `settings:view`; edit Owner.
- Edge cases and errors: Public holidays are not modeled (note). Overnight hours (open 20:00, close 02:00) are rejected in release one.
- Tests: Unit: business-minutes function across midnight, weekends, a closed day.

### F-1230: Business details
- Priority: P0. Milestone: M3.
- Description: Business name, contact email, business phone, support WhatsApp, tax ID, address, contact person (optional) and time zone live here. Main product and typed AOV are removed.
- Current app: Business Settings tab (SS fields); onboarding.
- Mockup: Settings, Business details.
- Acceptance criteria:
  - [ ] Fields: Business name, Contact email, Business phone (kept; the mockup replaced it with the WhatsApp number, keep both), Customer support WhatsApp (shown in delivery messages), Tax ID (TIN), Business address, Contact person (optional), Time zone (default Africa/Accra).
  - [ ] "Main product" is removed. "Average order value" is removed (S2).
  - [ ] Time zone appears here only; Profile does not repeat it. All reports, the nightly jobs and the operating hours use it.
  - [ ] Selling country and currency are in Currencies and FX (F-1232).
  - [ ] Save also refreshes the config store.
  - [ ] Support WhatsApp is validated as an international number.
- Data: `SystemConfig.supportWhatsapp`, `contactPerson`, `timeZone`. API: `PUT /api/admin/settings`.
- Permissions: view `settings:view`; edit Owner.
- Edge cases and errors: Time zone change applies to future days only; a notice says so.
- Tests: Integration: save and read.

### F-1231: Rewards tab (S1)
- Priority: P0. Milestone: M6.
- Description: The only place to set reward tiers. It holds target tiers by role, rep pay (commission and upsell), what reps can offer, and result badges (display). Cash tiers only (D9).
- Current app: none (commission per user).
- Mockup: Settings, Rewards.
- Acceptance criteria:
  - [ ] All amounts on this page are entered in the store currency (decision O3). Sample tiers for the Manny Dynamics store: Call rep 100 percent GH₵300; 120 percent GH₵500 plus a paid day off. Delivery 100 percent GH₵250; 120 percent GH₵400 plus a paid day off. Amounts editable. No 80 percent airtime tier. A 3PL below 80 percent of target shows "Contract review" as a flag, not a payout.
  - [ ] Companies and AI agents: shown as "No payout" (fixed, not editable).
  - [ ] Call rep pay: Commission input GH₵8 per order the rep confirmed by call that is delivered (P6; auto-confirmed orders earn none); Upsell reward input 10 percent.
  - [ ] "What reps can offer" tags are read-only and come from the checkout form packages and upsells: 1 set GH₵249, 2 sets GH₵449, 3 sets GH₵629; Refill pens GH₵40, Pencil grip trainer GH₵35, Smart Parent's guide GH₵59.
  - [ ] Result badges list (F-1109), once.
  - [ ] "Edit rules" works (it is dead in the mockup). Saving changes applies from the next month close; a notice says so. Commission and upsell changes apply to orders delivered after the save.
  - [ ] All other screens (Targets, Leaderboard, Staff, Rep, Agent, Inbox, Finance) read this setting. A grep test finds no hard-coded tier amount or "airtime".
- Data: `RewardTier` (tenantId, roleId, threshold 100|120, amount Decimal, dayOff Boolean, payout Boolean). `SystemConfig.repCommission`, `upsellPercent`. API: `GET/PUT /api/rewards/settings`.
- Permissions: view `targets:view`; edit Owner.
- Edge cases and errors: 120 percent amount below the 100 percent amount is rejected.
- Tests: Unit: validation. Integration: month close reads the setting.

### F-1232: Currencies and FX (O3, O5, O6)
- Priority: P0. Milestone: M1.
- Description: The owner picks a country at setup and the store currency is that country's currency (set automatically). The store currency is NOT locked: the owner can change it in Settings at any time, and all figures convert with the per-day rate history (decision O6). All money shows in the store currency. An amount in another currency (the ad account's currency, supplier currencies) converts at that day's rate; the original amount and currency stay on the record (decision O5; how amounts are stored: PRD section 5.7). Rates: a daily automatic rate, a manual override and a per-day history. The stale-rate warning shows only for manual rates.
- Current app: `SystemConfig.currency` (default USD) and `Tenant.currency` (default GHS); two currency lists (10 and 8 options).
- Mockup: Settings, Currencies and FX (tiles, one typed rate 112, "Use today's rate").
- Acceptance criteria:
  - [ ] One column holds the store currency: `Tenant.currency`. `SystemConfig.currency` is dropped; a migration copies the Tenant value.
  - [ ] Selling country and store currency are editable at any time. Picking a country sets its currency; the owner may pick another currency from the list. The server saves the change and does not rewrite any stored amount. A short note says "Figures convert with the rate of each day."
  - [ ] One currency list: USD, GHS, NGN, KES, ZAR, UGX, TZS, RWF, ETB, EUR, GBP, INR, CAD, AUD, JPY.
  - [ ] Tiles: Sales and revenue in the store currency (what customers pay); Ad spend in the ad account's currency (what Meta charges, from the ad account); Exchange rate (sample: "1 GH₵ = ₦112").
  - [ ] Extra currencies: list with Add and Remove. Meta account currencies add themselves. Supplier currencies are chosen on a shipment (Builder B2) and use the rate of the receive date.
  - [ ] Daily rate: a job fetches the rate every day at 06:00 Accra time for each pair in use. The source is a rate provider chosen in M1 (GUESS: pick one that lists GHS and NGN; check). The stored row has source `auto`.
  - [ ] Manual override: the owner types a rate for a pair; the row has source `manual` and stays until "Use today's rate" is clicked, which stores today's automatic rate and ends the override.
  - [ ] Per-day history: a table of date, pair, rate, source. The ledger and P&L use the rate of each day (F-923, F-933). A missing day uses the nearest earlier rate.
  - [ ] Stale warning only when the current rate is manual and older than 7 days (GUESS: 7). Automatic rates never show a stale warning. The agent card "Your FX rate is 16 days old" appears only in that case.
  - [ ] Helper text is computed: "CPA ₦5,903 is GH₵52.7. The max CPA ₦7,040 (at 34% yield) is GH₵62.9."
  - [ ] Every place that prints a rate prints the one used for that day ("₦112 = GH₵1").
  - [ ] The "Save" button works (it is dead in the mockup).
- Data: `FxRate` (tenantId, fromCurrency, toCurrency, rate Decimal(19,8), date, source `auto|manual`, createdById). API: `GET /api/fx/rates?from&to`, `POST /api/fx/rates` (manual), `POST /api/fx/use-today`, `GET /api/fx/history`.
- Permissions: view `settings:view`; edit Owner.
- Edge cases and errors: Provider down: keep the last rate and log; no stale warning for auto rates, but a Finding after 3 failed days. Rate 0 or negative rejected.
- Tests: Unit: store currency change keeps stored amounts and converts at read time, rate lookup by day, stale rule. Integration: override then use today.

### F-1233: Order statuses (read-only) and payment status note
- Priority: P2. Milestone: M3.
- Description: The tab lists the real order statuses with their meaning. The state machine is fixed, so there is no "Add status" (dropped). A note explains that payment status is separate.
- Current app: none.
- Mockup: Settings, Order statuses (six statuses, Add status dead).
- Acceptance criteria:
  - [ ] List shows the real statuses: pending_confirmation, payment_pending, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, digital_delivered, cancelled, returned, failed_delivery, payment_failed, each with a plain label and meaning (for example Delivered: counts toward delivered revenue; Digital delivered: paid digital order, counts toward delivered revenue; Failed delivery: refused, wrong address or not reachable).
  - [ ] Rep and agent labels (Waiting to dispatch, Declined, To pick up, Done) are shown as views of these statuses.
  - [ ] "Not reachable" is shown as a call outcome, not a status.
  - [ ] Note: payment is tracked apart from order status (unpaid, paid by 3PL, paid to you) using `PaymentStatus`.
  - [ ] No Add status button.
- Data: none. API: `GET /api/orders/statuses` (from the state machine).
- Permissions: `settings:view`.
- Edge cases and errors: none.
- Tests: Unit: list equals the enum.

### F-1234: Billing and plans (G2)
- Priority: P1. Milestone: M3.
- Description: Keep the Billing tab, plans and limits visible (G2). Fix the mockup numbers to match the live plans. The owner's tenant is on the Free plan, so the page shows "Free, no limits". Multi-store stays out. Limits and status are not enforced today (section 3 items 9, 10 and 44); this PRD does not add enforcement.
- Current app: `Billing.tsx`, `/api/billing/*`, plans table.
- Mockup: Settings, Billing and plans (Growth 1,500 orders, 2 stores, 3 AI keys; Free 50 orders).
- Acceptance criteria:
  - [ ] Plans shown (from the `plans` table, not typed): Growth ₦10,000 a month, 5,000 orders a month, 10 staff. Scale ₦20,000, unlimited. Enterprise, contact sales (sales@codadmin.app). Free is admin-granted and is shown only as the current plan if it is.
  - [ ] Removed from the mockup: "1,500 orders", "2 stores", "3 AI agent keys", "Free 50 orders, 1 store", "Stores used" row. Payment method row is dropped (matrix); the card last 4 stays in the current plan card when a card exists.
  - [ ] Current plan card: plan name, status badge, renews on, next charge in ₦, usage "Orders this month N of max" with a bar only if the plan has a limit. Example for Growth: 1,445 of 5,000 (29 percent).
  - [ ] No text says "Over the limit, new orders wait" (nothing enforces it). A soft notice at 90 percent says "You are near your plan limit".
  - [ ] Cancel subscription keeps access until the cycle end (existing); confirm strip "Keep plan" and "Cancel subscription". No free trial.
  - [ ] Status banners (past_due, pending) stay.
  - [ ] Owner only. The `/pricing` and `/register` pages stay hidden for the owner tenant (Builder A).
  - [ ] Pricing page caps on products, agents and forms are not shown in Billing (they are not in the plan table).
- Data: none. API: existing `/api/billing/*`.
- Permissions: Owner.
- Edge cases and errors: Plan with `paystackPlanCode` null: "Billing is being set up" and no subscribe button.
- Tests: Integration: plan list equals the table. E2E: Free plan view.

### F-1235: Message templates
- Priority: P2. Milestone: M9.
- Description: The component `MessageTemplates` (eight textareas in `notificationTemplates`) is not mounted. The backend only stores the value; the code check on 2026-10-18 shows no sender reads it (only `adminService` passes it through). The text is never sent. Move any filled text into Messages, Templates (Builder B1) so the templates are mounted where users find them, and delete the old component and key.
- Current app: `components/settings/integrations/MessageTemplates.tsx`; `SystemConfig.notificationTemplates`.
- Mockup: not in mockup (Messages, Templates covers it).
- Acceptance criteria:
  - [ ] A script lists tenants with non-empty `notificationTemplates`. Each non-empty entry becomes an SMS or email template in Messages, Templates with the name "Order confirmation (SMS)" style.
  - [ ] The component, the service field and the type are removed after the move.
  - [ ] Merge tags `{customerName}`, `{orderNumber}`, `{totalAmount}` map to the Messages merge tags.
- Data: migration only. API: remove `notificationTemplates` from the settings payload.
- Permissions: not applicable.
- Edge cases and errors: Name clash adds a suffix.
- Tests: Migration test on a fixture.

### F-1236: Public business config endpoint
- Priority: P1. Milestone: M0.
- Description: `GET /api/admin/config` is public and has no tenant (section 3 item 30). It returns the first config row, which leaks across tenants. Resolve the tenant from the host or form slug, or require sign-in.
- Current app: `adminController` route returning `businessName` and `currency`.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] Public callers pass a tenant slug (`?tenant=` or the form slug). No slug returns 404.
  - [ ] Signed-in callers use `/api/admin/config/me`.
  - [ ] Only business name and currency are returned.
  - [ ] Two-tenant test: each slug returns its own values.
- Data: none. API: as above.
- Permissions: public with slug.
- Edge cases and errors: Unknown slug: 404.
- Tests: Integration: two tenants.

### F-1237: Settings fields that move out (handover map)
- Priority: P1. Milestone: M3.
- Description: Many fields leave Settings. This requirement makes sure nothing is lost: each field has a new home and the old tab is removed with redirects.
- Current app: Settings tabs User Management, Role Permissions, Integrations, Checkout Forms, Billing.
- Mockup: all moved to their pages.
- Acceptance criteria:
  - [ ] User create and edit, filters: Staff (F-1158, F-1159, F-1161). Role matrix: Staff (F-1154).
  - [ ] SMS, WhatsApp, Email, Paystack, MCP: Connections (F-1201 to F-1204, F-1208).
  - [ ] Fee per outcome per partner and days to pay per partner: Deliveries, partner (Builder B2, F-700 range; `FeeRule` and `Partner.daysToPay`). The old `GL_DEFAULTS` (failed fee 50, return fee 0) are removed (F-935).
  - [ ] Delivery fee per outcome (the one fee rule per partner, decisions F1, F2): Deliveries, partner (F-703). Not in Staff.
  - [ ] Meta ad accounts on/off: Connections (F-1205). Campaign mapping: Marketing (F-1003).
  - [ ] Checkout form payment and tracking: Checkout forms (Builder B1, F-400 range).
  - [ ] Digital link expiry and max downloads: Products (Builder B2, F-600 range); the max downloads field is added to the product drawer (the mockup omits it).
  - [ ] `onboardingCompleted` stays in `User.preferences`. `Tenant.rateLimitEnabled` and `rateLimitConfig` stay under Platform admin.
  - [ ] Old URLs `?tab=users`, `?tab=roles`, `?tab=integrations`, `?tab=forms` redirect to the new pages.
  - [ ] A checklist test lists each old field and the new endpoint that stores it.
- Data: none new. API: redirects.
- Permissions: as each destination.
- Edge cases and errors: Bookmarks to old tabs land on the new page.
- Tests: E2E: each redirect.

---

## 4. Cross-area dependencies

- File 10: F-913 (one payout form), F-914, F-936 (delivery fee), F-916 (month close), F-923, F-933, F-906 (settlement ingest).
- File 11: F-1003 (campaign mapping), F-1007 (max CPA), F-1000 to F-1002 (Meta connection).
- Builder A (F-100 to F-199): shell, menu rendering, login, accept-invite, change-password route, sessions refresh rotation, onboarding route; (F-1300 range) tool registry, MCP identity, audit log, AI drawer.
- Builder B1: Inbox settings screen (F-550 range), Orders list (F-300), checkout form tracking and payment tabs (F-400), Messages templates (F-450), `UpsellLine` (rep).
- Builder B2: Deliveries fee rules and days to pay (F-700), Products digital fields and shipment currency (F-600/F-650), rep screen (F-750), agent app (F-800).

## 5. Open questions, GUESS items and source conflicts

| Item | Detail | Check |
|---|---|---|
| Orders a day divisor | Design says days in month; NUMBERS.md example uses 30 (58). | RESOLVED (R2): real days in the month; October gives 56. |
| Rep reward measure | G4 says delivery-date numbers; the mockup measures confirmed orders. | RESOLVED (P7): confirmed orders that get delivered, counted at month close. |
| Growth formula | "Grow each quarter" step = one thirtieth of the annual figure reproduces 360/420/480/540k. | Owner |
| Planned AOV default | Delivered AOV (GH₵245) vs orders-placed AOV. | RESOLVED (R12): average value of delivered orders, last 30 days. |
| Admin, Manager, Marketing role mapping | No enum value for Marketing; names for Admin and Manager are guesses. | Owner |
| First sale for the currency lock | Removed (O6): the store currency is not locked. | None |
| FX provider | Needs GHS and NGN daily; not chosen. | Pick in M1 |
| Stale manual rate limit | 7 days. | Owner |
| Webhook required fields | Mockup: name and phone; code: phone. | Owner |
| Mockup Billing numbers | Growth 1,500 orders and 2 stores vs live 5,000 orders and 10 staff; Free plan 50 orders vs live unlimited. Fixed here. | None |
| Message templates | The lead brief said "MessageTemplates mounted"; the matrix says drop. | RESOLVED (R8): move stored text into Messages, Templates, then delete the old component. |
| Notification toggles | Probably never saved; migration may be empty. | Query `preferences` |
| Export my data scope | Not stated. | Owner |
| Delivery tiers | Design open question 9: delivery tiers came from round 2. Decision D9 now states them (GH₵250 and GH₵400). Used here. | Done |

## 6. Coverage table


### Section 1 rows

| Matrix row | Verdict | Covered by |
|---|---|---|
| TL-01 Targets page (year, quarter, month, role, person) | NEW | F-1100, F-1101 |
| TL-02 Margin shown with revenue at each level | NEW | F-1101, F-1112 |
| TL-03 Role target groups with reward at 100% | NEW | F-1102 |
| TL-04 Add and edit target | NEW | F-1103 |
| TL-05 Leaderboard: call reps | NEW | F-1104 |
| TL-06 Leaderboard: delivery | NEW | F-1105 |
| TL-07 Leaderboard: upsell | NEW | F-1106 |
| TL-08 Period select | NEW | F-1107 |
| TL-09 Reward progress ("distance to next tier") | NEW | F-1108 |
| TL-10 Badges | NEW | F-1109 |
| TL-11 North Star setup wizard | NEW | F-1111 |
| TL-12 Orders-a-day and max CPA calculators | NEW | F-1113 |
| ST-01 Role cards (6) with holders, target, progress | NEW | F-1150, F-1151 |
| ST-02 Assign human, AI agent or company | NEW | F-1152 |
| ST-03 Allowed tools (16 switches) | CHANGE | F-1153 |
| ST-04 New role | NEW | F-1156 |
| ST-05 Team table (tabs, type, pay, last active, status) | CHANGE | F-1157 |
| ST-06 Invite person | CHANGE | F-1158 |
| ST-07 Edit person (name, email, phone, role, pay, vehicle, location) | CHANGE | F-1159 |
| ST-08 Reset password, deactivate, reactivate, delete (soft and permanent) | KEEP+RESTYLE | F-1160 |
| ST-09 Filter by role, search | MISSING-IN-MOCKUP | F-1161 |
| ST-10 Rep availability and workload | MISSING-IN-MOCKUP | F-1162 |
| ST-11 Roles admin, manager, accountant, inventory manager | MISSING-IN-MOCKUP | F-1155 |
| ST-12 Fine permissions (customers, GL, workflows, settings, orders delete, bulk import, update stock, calls) | MISSING-IN-MOCKUP | F-1154 |
| ST-13 Pick delivered orders to pay | MISSING-IN-MOCKUP | F-1164, F-913 |
| ST-14 Pay card: reps, delivery agents, history | CHANGE | F-1164 |
| ST-15 Record payout (person) | KEEP+RESTYLE | F-1164, F-913 |
| ST-16 Customer Reps performance table | DROP | DROP: matrix DROP (leaderboard and Reports replace) |
| ST-17 Earnings History (rep) | DROP | DROP: matrix DROP (rep Earnings replaces) |
| CN-01 Arkesel SMS | CHANGE | F-1201 |
| CN-02 WhatsApp (Connect with Meta, manual token) | CHANGE | F-1202 |
| CN-03 Email (SendGrid, Resend, SMTP) | CHANGE | F-1203 |
| CN-04 Paystack keys and webhook | CHANGE | F-1204 |
| CN-05 Meta Ads | NEW | F-1205, F-1000 |
| CN-06 Checkout website (site, pixel, server events) | NEW | F-1206 |
| CN-07 CSV upload | NEW | F-1207 |
| CN-08 MCP keys (label, role, revoke) | CHANGE | F-1208 |
| CN-09 Inbound order webhooks (create, URL, key) | KEEP+RESTYLE | F-1209 |
| CN-10 Webhook secret, custom headers, edit, delete | MISSING-IN-MOCKUP | F-1210 |
| CN-11 Webhook field mapping, logs, retry | KEEP+RESTYLE | F-1211 |
| CN-12 Webhook test (sample JSON) | MISSING-IN-MOCKUP | F-1212 |
| CN-13 Activity log (all connections) | NEW | F-1213 |
| CN-14 3PL connector (Logiswift, Kasapa) | REMOVED by O7 (no partner key; was F-1214) | none |
| CN-15 Payment pointer card for Webhooks | DROP | DROP: matrix DROP (Connections page replaces) |
| SE-01 Profile | CHANGE | F-1221, F-1222 |
| SE-02 Security | CHANGE | F-1223, F-1224 |
| SE-03 My Notifications | CHANGE | F-1227, F-1228 |
| SE-04 Business Settings | CHANGE | F-1230 |
| SE-05 Checkout Forms pointer tab | DROP | DROP: matrix DROP (sidebar item replaces) |
| SE-06 Integrations tab | DROP | DROP: matrix DROP (moves to Connections, F-1200) |
| SE-07 User Management tab | DROP | DROP: matrix DROP (moves to Staff, F-1157) |
| SE-08 Role Permissions tab | DROP | DROP: matrix DROP (moves to Staff, F-1154) |
| SE-09 Billing and Plans | CHANGE | F-1234 |
| SE-10 North Star and targets | NEW | F-1112, F-1113 |
| SE-11 Rewards | NEW | F-1231 |
| SE-12 Currencies and FX | NEW | F-1232 |
| SE-13 Order statuses | NEW | F-1233 |
| SE-14 Operations (hours, queue, time to first call, days to pay) | NEW | F-1229 |

### Section 2 settings rows (all 93)

| Row | Verdict | Covered by |
|---|---|---|
| 2.1#1 First name, last name | CHANGE | F-1221 |
| 2.1#2 Display name | NEW | F-1221 |
| 2.1#3 Email | CHANGE | F-1221 |
| 2.1#4 Phone | CHANGE | F-1221 |
| 2.1#5 Photo | NEW | F-1222 |
| 2.1#6 Language | NEW | F-1221 |
| 2.1#7 Time zone | CHANGE | F-1230 |
| 2.1#8 Current role, member since | KEEP+RESTYLE | F-1221 |
| 2.2#1 Current, new, repeat password | CHANGE | F-1223 |
| 2.2#2 Signed-in sessions list | NEW | F-1224 |
| 2.2#3 Sign out everywhere else | NEW | F-1224 |
| 2.2#4 Export my data | NEW | F-1225 |
| 2.2#5 Delete account | CHANGE | F-1226 |
| 2.2#6 Order updates toggle | DROP | DROP: matrix DROP (F-1227 note) |
| 2.2#7 Payment notifications toggle | DROP | DROP: matrix DROP (F-1227 note) |
| 2.2#8 My alerts matrix (9 events by 4 channels) | NEW | F-1228 |
| 2.2#9 Role defaults matrix, Apply to team | NEW | F-1228 |
| 2.2#10 Quiet hours (from, to, still send short payouts) | NEW | F-1228 |
| 2.2#11 Daily digest (switch, time, channel, remind after) | NEW | F-1228 |
| 2.2#12 Agent app switches (4) | CHANGE | F-1228 |
| 2.3#1 businessName | KEEP+RESTYLE | F-1230 |
| 2.3#2 businessEmail | KEEP+RESTYLE | F-1230 |
| 2.3#3 businessPhone | CHANGE | F-1230 |
| 2.3#4 businessAddress | KEEP+RESTYLE | F-1230 |
| 2.3#5 taxId | KEEP+RESTYLE | F-1230 |
| 2.3#6 Customer support WhatsApp | NEW | F-1230 |
| 2.3#7 Contact person | NEW | F-1230 |
| 2.3#8 Main product | DROP | DROP: matrix DROP (F-1230 note) |
| 2.3#9 Selling country | CHANGE | F-1232 |
| 2.3#10 currency | CHANGE | F-1232 |
| 2.3#11 Time zone | NEW | F-1230 |
| 2.3#12 Average order value | DROP | DROP: matrix DROP (S2; computed in F-902, F-1052; planned AOV in F-1113) |
| 2.3#13 operatingHours | NEW | F-1229 |
| 2.3#14 Queue wait alert (30 min) | NEW | F-1229 |
| 2.3#15 Time to first call target (15 min) | NEW | F-1229 |
| 2.3#16 Default days to pay | NEW | F-1229 |
| 2.3#17 Low stock days of cover (default 14) | CHANGE | F-1229 |
| 2.4#1 Annual North Star (GH₵1,800,000) | NEW | F-1112 |
| 2.4#2 Net margin target (35%) | NEW | F-1112 |
| 2.4#3 Growth mode (even, grow each quarter, custom) | NEW | F-1112 |
| 2.4#4 Quarter split Q1 to Q4 | NEW | F-1112 |
| 2.4#5 Planned AOV (default last 30 days) | CHANGE | F-1113 |
| 2.4#6 Confirmation rate target (70%) | NEW | F-1112 |
| 2.4#7 Delivery success target (60%) | NEW | F-1112 |
| 2.4#8 Orders a day needed (58) | NEW | F-1113 |
| 2.4#9 Max CPA | NEW | F-1113, F-1007 |
| 2.4#10 Role targets (723 confirmed orders that get delivered, 60% success, max CPA) | NEW | F-1102, F-1103 |
| 2.4#11 Daily activity target "Failed delivery calls 15" | NEW | F-1103 |
| 2.4#12 Reward tiers per role (100% and 120%, cash) | NEW | F-1231 |
| 2.4#13 Delivery reward tiers (100% GH₵250, 120% GH₵400 + day off) | NEW | F-1231 |
| 2.4#14 Call rep tiers (100% GH₵300, 120% GH₵500 + day off) | NEW | F-1231 |
| 2.4#15 Companies and AI agents: no payout | NEW | F-1231 |
| 2.4#16 3PL below 80% of target: contract review | NEW | F-1231, F-1105 |
| 2.4#17 Rep commission (GH₵8 per confirmed order delivered) | CHANGE | F-1231, F-914 |
| 2.4#18 Upsell reward (10%) | NEW | F-1231, F-914 |
| 2.4#19 What reps can offer | NEW | F-1231 |
| 2.4#20 Result badges | NEW | F-1109 |
| 2.4#21 North Star card on the Rewards screen | CHANGE | F-1114 |
| 2.5#1 Store currency | CHANGE | F-1232 |
| 2.5#2 Currency list | CHANGE | F-1232 |
| 2.5#3 Extra currencies | NEW | F-1232 |
| 2.5#4 Exchange rate (₦ per GH₵) | CHANGE | F-1232 |
| 2.5#5 Use today's rate | NEW | F-1232 |
| 2.5#6 Rate history per day | NEW | F-1232 |
| 2.5#7 Stale warning | CHANGE | F-1232 |
| 2.5#8 Supplier cost currency | NEW | F-1232 |
| 2.6#1 Status list | CHANGE | F-1233 |
| 2.6#2 Add status | DROP | DROP: matrix DROP (state machine is fixed; F-1233 note) |
| 2.6#3 Payment status note | KEEP+RESTYLE | F-1233 |
| 2.6#4 Current plan, usage, next bill | CHANGE | F-1234 |
| 2.6#5 Payment method, stores used | DROP | DROP: matrix DROP (stores dropped; F-1234 note) |
| 2.6#6 Plan list and limits | CHANGE | F-1234 |
| 2.6#7 Cancel subscription | KEEP+RESTYLE | F-1234 |
| 2.7#1 User create/edit (name, email, password, phone, role, commissionAmount) | CHANGE | F-1158, F-1159 |
| 2.7#2 User filters (search, role, status) | CHANGE | F-1161 |
| 2.7#3 Role permission matrix (10 resources) | CHANGE | F-1154 |
| 2.7#4 SMS: authToken, senderId, isEnabled, test phone | KEEP+RESTYLE | F-1201 |
| 2.7#5 WhatsApp: OAuth fields, accessToken, phoneNumberId, appSecret, verify token, isEnabled | KEEP+RESTYLE | F-1202 |
| 2.7#6 Email: provider, apiKey, from, name, test | KEEP+RESTYLE | F-1203 |
| 2.7#7 Paystack: mode, public key, secret key, isEnabled | KEEP+RESTYLE | F-1204 |
| 2.7#8 MCP key: label | CHANGE | F-1208 |
| 2.7#9 Message templates (8 textareas, `notificationTemplates`) | DROP | F-1235 (matrix says DROP; text moves to Messages, Templates) |
| 2.7#10 Fee per outcome per partner | NEW | F-1237 (Deliveries, B2 F-700 range), F-936 |
| 2.7#11 Days to pay per partner | NEW | F-1237 (Deliveries, B2 F-700 range), F-1229 |
| 2.7#12 Agent pay per delivery | Removed (decision F1): replaced by the delivery fee rule | F-703 (file 07), F-936 |
| 2.7#13 Meta ad accounts on/off | NEW | F-1205 |
| 2.7#14 Meta campaign mapping | NEW | F-1003 |
| 2.7#15 Checkout form payment, tracking | KEEP+RESTYLE | F-1237 (Checkout forms, B1 F-400 range) |
| 2.7#16 Digital link expiry, max downloads | KEEP+RESTYLE | F-1237 (Products, B2 F-600 range) |
| 2.7#17 ordersDefaultView | DROP | DROP: matrix DROP (no Kanban) |
| 2.7#18 onboardingCompleted | KEEP as-is | F-1237 (kept as is) |
| 2.7#19 Tenant.defaultDeliveryFee | DROP | DROP: matrix DROP (replaced by FeeRule, F-936) |
| 2.7#20 Tenant rate limit | KEEP as-is | F-1237 (kept as is, Platform admin) |

### Section 3 broken items in scope

| # | Item | Covered by |
|---|---|---|
| 1 | Profile save does nothing | F-1221 |
| 2 | Password change does nothing | F-1223 |
| 3 | Notification toggles do nothing | F-1228 |
| 4 | `MessageTemplates` component not mounted; `notificationTemplates` may be unused | F-1235 |
| 5 | `admin` role sees no settings tabs | F-1220 |
| 9 | Plan limits and subscription status not enforced | F-1234 (note only; no enforcement) |
| 10 | Suspended or past-due tenants keep full access | F-1234 (note only) |
| 24 | Checkout editor help text links to `/settings/integrations` (no route) | F-1215 |
| 25 | Kanban `$` hard-coded; Earnings History GHS hard-coded | F-1232 (store currency used everywhere) |
| 26 | Currency lists differ (Settings 10, onboarding 8) | F-1232 |
| 30 | `GET /admin/config` unauthenticated, tenantless | F-1236 |
| 38 | Legacy Paystack webhook past sunset | F-1204 |
| 40 | Round-robin index in memory, lost on restart | F-1162 |
| 41 | WhatsApp OAuth pending state in memory | F-1202 |
| 42 | `Tenant.defaultDeliveryFee` never read; public checkout shipping fixed at 0 | F-936, F-1237 |
| 44 | Pricing page caps (5 products, 10 agents, 5 forms) not enforced | F-1234 (note only) |

### Section 4 mockup fixes in scope

| # | Issue | Covered by |
|---|---|---|
| 1 | **Approved.** Rewards in two places. Airtime tier. | F-1231, F-1114, F-916, F-1108 |
| 3 | **Approved.** Currency and FX. | F-1232, F-923, F-933 |
| 7 | Tracking in two places with different pixel IDs | F-1206 |
| 8 | Time zone, country, currency repeated | F-1230, F-1232, F-1221 |
| 9 | Agent app has its own notification switches | F-1228 |
| 20 | Dashboard quest "Failed delivery calls 6 of 15" has no setting | F-1103 |
| 21 | Targets lists 5 delivery holders; Leaderboard shows 4. Badge conflict (Kofi September vs "No one yet") | F-1102, F-1105, F-1109 |
| 23 | Staff header strings static (10 on team, 12 shown) | F-1157 |
| 25 | Dead buttons (about 40) | F-1103, F-1232, F-1156, F-1111, F-1012 |
| 26 | North Star steps 4 to 6 have no screen; growth switch does nothing; GH₵180k and ₦20,720 fixed | F-1111, F-1113 |
| 29 | Delete confirms inconsistent; Customers search is a button | F-1160, F-1165 |
| E2 | Billing plan numbers (Growth 1,500 orders, 2 stores, 3 AI keys) differ from live plans (5,000 orders, 10 staff) | F-1234 |

Count check: section 1 rows 58, section 2 rows 93, section 3 rows 16, section 4 rows 12. Total 179.
