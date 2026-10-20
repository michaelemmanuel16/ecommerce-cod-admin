# PRD area 11: Marketing and Reports (F-1000 to F-1099)

Status: draft for owner review. Date: 2026-10-18. Writer: Builder C.
Sources: decisions.md (O3, O5, O6, G1, G8, G10), design doc sections 4.3, 8.2, `gap-matrix.md` 1.11 and 1.12, section 3 and 4 rows named in the coverage table, `NUMBERS.md`, `marketing.html`, `reports.html`, code in `metaOAuthService.ts`, `metaCapiService.ts`, `analyticsService.ts`.

## 1. Scope

Gap-matrix 1.11 Marketing (MK-01 to MK-09) and 1.12 Reports (RP-01 to RP-16). Section 3 items 17 and 18 (reports side). Section 4 items 2, 6, 13, 22, 24, 30 and E4.
Roles: Marketer and Owner use Marketing. Owner, Finance clerk, Marketer, Manager and Admin use Reports (each tab shows only what the role may see, F-1050).

Rules for both screens:
- Use the three rate names only: confirmation rate, delivery success rate, order-to-cash yield. Never "delivery rate".
- Revenue = delivered revenue by delivery date (F-900 in file 10).
- Ad spend arrives in the ad account's currency and shows in the store currency at that day's rate. The original amount and currency stay on the row, and the rate shows ("₦112 = GH₵1" is a sample for the Manny Dynamics store; decisions O5, O6).
- No button writes to Meta in the first release (G10).

---

## 2. Marketing requirements

### F-1000: Own Meta connection
- Priority: P0. Milestone: M8.
- Description: CodAdmin pulls Meta ad spend through its own Meta connection (decision 11). The owner signs in with Meta, picks the ad accounts, and CodAdmin stores an encrypted token. The existing OAuth code in `metaOAuthService.ts` was built for WhatsApp and is reused.
- Current app: `metaOAuthService.ts` (WhatsApp only). `MetaConnection` does not exist.
- Mockup: `marketing.html` header chip "Meta account: connected, pulled 06:42"; `connections.html` Meta Ads card.
- Acceptance criteria:
  - [ ] "Connect Meta Ads" starts OAuth with read-only ad scopes (GUESS: `ads_read`; check Meta Marketing API scopes and whether App Review is needed before M8).
  - [ ] The token is encrypted at rest (existing `providerCrypto`). It is never returned to the browser.
  - [ ] The header chip shows Connected, Token expires soon, or Disconnected, and the time of the last successful pull.
  - [ ] Token expiry within 7 days raises an inbox alert and the chip turns amber.
  - [ ] Disconnect revokes the token and stops the pull. Stored spend rows stay.
  - [ ] OAuth pending state lives in Redis, not memory.
- Data: `MetaConnection` (id, tenantId, status, tokenEnc, tokenExpiresAt, connectedById). `MetaAdAccount` (connectionId, externalId, name, currency, enabled). API: `POST /api/meta/oauth/initiate`, `GET /api/meta/status`, `DELETE /api/meta/connection`, `PATCH /api/meta/accounts/:id {enabled}`.
- Permissions: connect and disconnect Owner; view status Owner, Marketer.
- Edge cases and errors: User denies scopes: show which scope is missing. Token revoked at Meta: status Disconnected and an alert.
- Tests: Unit: token expiry states. Integration: OAuth callback with a stubbed Meta. E2E: connect, disconnect.

### F-1001: Spend pull job
- Priority: P0. Milestone: M8.
- Description: A job pulls campaign and ad insights into `MetaSpendDay`: spend, impressions, reach, link clicks, landing page views, checkouts started, 3-second views, ThruPlays. Decision R7: pull every hour for today's spend, and re-pull the last 3 days once a day at 05:00 Accra time for the final figures (Meta restates recent days). The Connections mockup "pulled every hour" matches the hourly part.
- Current app: none.
- Mockup: `marketing.html` chip; `connections.html` "Pulled every hour".
- Acceptance criteria:
  - [ ] One row per (ad account, campaign, ad, date). Campaign-level rows are the sum of ad rows.
  - [ ] Re-pull overwrites a day (idempotent).
  - [ ] Spend for a test week matches Ads Manager to the ₦1.
  - [ ] Failure keeps old data, sets the chip to "Last pull failed <time>" and retries with backoff (3 tries).
  - [ ] The job respects Meta rate limits (UNVERIFIED: read Meta's current limits before M8) and pauses on a rate-limit error.
  - [ ] After each pull, posting to the ledger runs (F-933 in file 10).
  - [ ] First connect backfills the last 90 days.
- Data: `MetaSpendDay` (tenantId, accountId, campaignId, campaignName, adId nullable, adName, date, spend Decimal, currency, impressions, reach, linkClicks, landingPageViews, checkoutsStarted, threeSecondViews, thruPlays). Bull queue `metaPull`. API: none public.
- Permissions: system job.
- Edge cases and errors: Ad deleted at Meta: rows stay. Attribution window follows the account default (UNVERIFIED).
- Tests: Unit: row merge. Integration: stubbed insights payload to rows.

### F-1002: Currency taken from the ad account (O5)
- Priority: P0. Milestone: M8.
- Description: Each ad account has its own currency (the sample ad account bills ₦ in the mockup). The app reads the currency from Meta and never asks the user to type it.
- Current app: none.
- Mockup: `marketing.html` KPI "₦8.53M (about GH₵76k, ₦112 = GH₵1)".
- Acceptance criteria:
  - [ ] `MetaAdAccount.currency` is set from the Meta account on connect and refreshed daily.
  - [ ] Spend shows in the account currency. The store-currency equivalent shows next to it, using that day's rate (F-1232). All totals show in the store currency (O5).
  - [ ] If the account currency equals the store currency, no conversion text shows.
  - [ ] If the account currency changes, the old rows keep their old currency.
  - [ ] No input field for ad currency exists anywhere.
- Data: `MetaAdAccount.currency`, `MetaSpendDay.currency`. API: in `GET /api/marketing/summary`.
- Permissions: `marketing:view`.
- Edge cases and errors: Currency with no rate: show spend without the store-currency value and a hint to add a rate.
- Tests: Unit: conversion at each day's rate.

### F-1003: Campaign to product mapping
- Priority: P0. Milestone: M8.
- Description: A campaign must link to a product so max CPA and profit by product work. A mapping is either a name rule (prefix "MG_" to Magic Groove) or a pick on one campaign. Unmapped campaigns show "Not mapped" and the spend still counts.
- Current app: none.
- Mockup: `marketing.html` select "Map to product" (does nothing).
- Acceptance criteria:
  - [ ] Each row without a product shows a product select. Choosing one saves the mapping and recalculates max CPA for that row at once.
  - [ ] A rule screen lists rules (prefix or contains, product). Rules apply to new campaigns on each pull. A pick overrides a rule.
  - [ ] Fixture: MG_Oct_Retarget (₦41,000) is Not mapped until picked. After picking Magic Groove, its max CPA shows.
  - [ ] A mapping change shows "Applies to all days of this campaign".
  - [ ] An agent card lists unmapped spend and opens the mapping (no write by the card).
- Data: `MetaCampaignMapping` (tenantId, campaignId nullable, rule nullable, productId). API: `GET/PUT /api/marketing/mappings`.
- Permissions: Owner, Marketer (`marketing:update`).
- Edge cases and errors: A campaign with ads for two products: map to one product; document in the hint. Product archived: mapping stays, a warning shows.
- Tests: Unit: rule match order. Integration: mapping changes max CPA.

### F-1004: KPI tiles
- Priority: P0. Milestone: M8.
- Description: Four tiles: Ad spend, CPA against max CPA, Projected cost per delivered, Order-to-cash yield.
- Current app: none.
- Mockup: `marketing.html` KPI tiles.
- Acceptance criteria:
  - [ ] Ad spend this month ₦8.53M (about GH₵76k, ₦112 = GH₵1).
  - [ ] CPA ₦5,903 = spend / orders placed (8,530,000 / 1,445). Sub-line "max ₦7,040 at 34% yield, ₦1,137 under".
  - [ ] Projected cost per delivered ₦17,360 (8,530,000 / (1,445 x 34%)). Sub-line "break-even ₦20,720, ₦3,360 under" and "Actual so far ₦22,686, by delivery date".
  - [ ] Yield 34%, sub-line "campaigns range 29% to 36%".
  - [ ] All values round to the nearest ₦10.
  - [ ] No fixed ₦6,400 ceiling anywhere.
- Data: none new. API: `GET /api/marketing/summary?from&to`.
- Permissions: `marketing:view`.
- Edge cases and errors: No orders: CPA "n/a". No closed cohort: yield "Not enough closed orders".
- Tests: Unit: each tile on the fixture.

### F-1005: Funnel
- Priority: P1. Milestone: M8.
- Description: A 7-step funnel for all campaigns or one: Impressions, Link clicks, Landing page views, Checkouts started, Orders, Confirmed, Delivered (projected). Each step shows its rate and cost.
- Current app: Analytics funnel (orders only).
- Mockup: `marketing.html` funnel card with scope bar.
- Acceptance criteria:
  - [ ] Fixture (all): 4,100,000 impressions (CPM ₦2,080); 61,500 clicks (CTR 1.5%, CPC ₦139); 43,000 landing page views (70% of clicks); 4,300 checkouts (10% of views); 1,445 orders (34% of checkouts, CPA ₦5,903); 1,026 confirmed (71%); 491 delivered projected (yield 34%, ₦17,360 each).
  - [ ] Click on a campaign row scopes the funnel. "Show all campaigns" resets it.
  - [ ] Footnote shows delivered so far (376).
  - [ ] Orders and confirmed come from the orders table by campaign (UTM or form tag; GUESS: check how Meta campaign names reach orders; the checkout pixel sends `utm_campaign`).
- Data: orders need a stored campaign key (`Order.utmCampaign`, owned by Builder B1 checkout, F-400 range). API: `GET /api/marketing/funnel?campaignId`.
- Permissions: `marketing:view`.
- Edge cases and errors: Orders with no campaign tag show under "No campaign".
- Tests: Unit: step rates. Integration: scoped funnel.

### F-1006: Campaigns table and status rules
- Priority: P0. Milestone: M8.
- Description: A table with one row per campaign and a total row.
- Current app: none.
- Mockup: `marketing.html` campaigns table.
- Acceptance criteria:
  - [ ] Columns: Campaign (and product), Spend, Orders, Confirmed, Delivered, CPA, Max CPA, Yield, Projected cost per delivered, Actual so far (labelled "by delivery date"), Status.
  - [ ] Status: Winning = CPA at most 70% of max CPA and yield at or above target... (GUESS: owner sets the rule; this PRD uses: Winning = CPA under max CPA and best projected cost per delivered; On track = CPA under max CPA; Over max CPA = CPA above max CPA; Not mapped = no product; Paused = Meta status paused).
  - [ ] Fixture rows: Teacher UGC 777 orders, yield 36%, projected ₦15,620, max ₦7,460, Winning. Mom POV 387, 34%, ₦17,860, ₦7,040, On track. Benefit Stack 234, 29%, ₦22,530, ₦6,010, Over max CPA. Retarget 7, 33%, ₦17,750, no max, Not mapped. DT_Oct_Dignity 40, 30%, ₦20,000, ₦4,030, Paused. All: ₦17,360, ₦7,040.
  - [ ] Click on a row expands its ads (F-1010).
  - [ ] The date control "This month" works (it is dead in the mockup) with presets and custom dates.
- Data: none. API: `GET /api/marketing/campaigns`.
- Permissions: `marketing:view`.
- Edge cases and errors: Yield uses the campaign's closed cohort; if under 30 orders closed, show the yield with "low data".
- Tests: Unit: status rules. Integration: fixture rows.

### F-1007: Max CPA
- Priority: P0. Milestone: M8.
- Description: Max CPA = profit per delivered order before ads x yield (decision 3). It moves with yield. It replaces the fixed ₦6,400 ceiling.
- Current app: none (₦6,400 fixed in docs).
- Mockup: `marketing.html`; North Star setup tile "Max cost per order".
- Acceptance criteria:
  - [ ] Profit per delivered before ads, per product = price - landed cost per unit - weighted delivery fee from the delivery fee rules (decision R5), in GH₵, times the rate to get ₦. Sample copybook: 249 - 30 - 34 = GH₵185 = ₦20,720 (34 is the sample value; the build uses the weighted fee from data). Dictamni GH₵120 = ₦13,440.
  - [ ] Max CPA = that profit x the campaign's yield, rounded to the nearest ₦10. Check: 34% gives ₦7,040; 42% gives ₦8,700; 36% gives ₦7,460; 29% gives ₦6,010; Dictamni at 30% gives ₦4,030.
  - [ ] Landed cost comes from received shipments on counted units (D2). The delivery fee is the weighted fee from each partner's fee rules (decision R5, file 10 Q-F6). It is not a fixed GH₵34.
  - [ ] Yield used: the campaign's own closed-cohort yield; if none, the account yield; the planned yield (confirmation target x success target = 42%) is shown as the second number.
  - [ ] North Star setup uses the same function (F-1113 in file 12).
  - [ ] Both ₦ and GH₵ show where space allows ("₦7,040 is GH₵62.9").
- Data: none. API: `GET /api/marketing/max-cpa?productId&yield`.
- Permissions: `marketing:view`.
- Edge cases and errors: Profit before ads 0 or negative: max CPA 0 and the row says "No room for ads at this price".
- Tests: Unit: the five values above.

### F-1008: Yield and projected cost on closed cohorts
- Priority: P0. Milestone: M1 (yield) and M8 (projection).
- Description: Order-to-cash yield = delivered / orders placed, on cohorts that have closed. Projected cost per delivered = spend / (orders x yield). A cohort is a group of orders placed on the same day.
- Current app: none (the old 26% was delivered / all orders and is removed).
- Mockup: `marketing.html` tiles and table.
- Acceptance criteria:
  - [ ] A day cohort is closed when none of its orders is still open (pending_confirmation, confirmed, preparing, ready_for_pickup, out_for_delivery). A cohort also counts as closed 30 days after it was placed (GUESS: the 30 days is a placeholder; check how long orders stay open in production).
  - [ ] Yield = delivered / orders over the closed day cohorts in the range (and, for a campaign, in that campaign).
  - [ ] Cancelled orders stay in the denominator (they are orders placed).
  - [ ] Fixture: 71% confirmation x 48% success is about 34%.
  - [ ] Projected cost per delivered fixture values as in F-1004 and F-1006.
  - [ ] The page never shows delivered / all orders as a KPI.
- Data: none. API: KPI service `kpi.yield(from,to,campaignId)`.
- Permissions: `marketing:view`.
- Edge cases and errors: Range with no closed cohort: no yield.
- Tests: Unit: cohort closing. Integration: fixture.

### F-1009: Actual cost per delivered (labelled)
- Priority: P2. Milestone: M8.
- Description: Keep "actual cost per delivered" = spend / orders delivered in the period (₦22,686, by delivery date). It is not the decision number. Label it.
- Current app: none.
- Mockup: `marketing.html` sub-line and column "Actual so far".
- Acceptance criteria:
  - [ ] The label reads "Actual so far (by delivery date)".
  - [ ] It is never next to a target or status colour.
- Data: none. API: in F-1004/F-1006 responses.
- Permissions: `marketing:view`.
- Edge cases and errors: Zero delivered: "n/a".
- Tests: Unit: formula.

### F-1010: Ad-level view
- Priority: P1. Milestone: M8.
- Description: Under a campaign, 2 to 4 ads show spend, orders, CPA, hook rate, hold rate and frequency. Hook rate = 3-second views / impressions. Hold rate = ThruPlays / impressions. Static ads show "n/a" for hook, hold and frequency. No reach, likes, comments or shares columns.
- Current app: none.
- Mockup: `marketing.html` expanded ads table.
- Acceptance criteria:
  - [ ] Ad spend rows sum to the campaign spend.
  - [ ] Hook rate in the 20% to 32% range and hold rate 5% to 10% on the fixture; Teacher UGC has the best hook rate. Frequency 1.4 to 2.6.
  - [ ] Frequency = impressions / reach.
  - [ ] Ad orders come from the ad tag on the order (UTM content; GUESS: check the pixel sends it).
- Data: `MetaSpendDay.adId`. API: `GET /api/marketing/campaigns/:id/ads`.
- Permissions: `marketing:view`.
- Edge cases and errors: Ad with no orders shows CPA "n/a".
- Tests: Unit: rates. Integration: ad sums.

### F-1011: Daily spend against orders chart
- Priority: P2. Milestone: M8.
- Description: A chart of daily spend and daily orders, with Best day, Worst day and the average. Fixture: best 16 Oct ₦5,450 per order; worst 13 Oct ₦6,329; average ₦502k a day and 85 orders.
- Current app: none.
- Mockup: `marketing.html` card "Daily spend vs orders" (placeholder).
- Acceptance criteria:
  - [ ] Real chart, bars for spend and a line for orders, in the v2 style, working in dark mode.
  - [ ] Best and worst day = lowest and highest CPA.
  - [ ] Hover shows date, spend, orders, CPA.
- Data: none. API: `GET /api/marketing/daily`.
- Permissions: `marketing:view`.
- Edge cases and errors: Day with no orders is excluded from best and worst.
- Tests: Unit: best and worst.

### F-1012: Agent cards (read-only)
- Priority: P1. Milestone: M11.
- Description: The page shows 1 to 3 suggestion cards. In the first release no card writes anything (G10). "Cut budget by 30%" and "Raise budget by 20%" must not write to Meta. They are removed in release one; an "Open campaign" button opens the campaigns table on that row instead. "Map to Magic Groove" opens the mapping with the product pre-filled and a person confirms.
- Current app: none.
- Mockup: `marketing.html` three cards (Benefit Stack over max CPA; Teacher UGC room to scale; ₦41,000 with no product).
- Acceptance criteria:
  - [ ] The cards come from the problem-finder tools (`unmapped_campaigns`, max CPA check).
  - [ ] No card button calls a Meta write API. The Meta connection has read scopes only.
  - [ ] Card 1 text: "Benefit Stack costs ₦1,137 more than its max CPA ₦6,010" style, computed.
  - [ ] Dismiss hides the card for 7 days.
  - [ ] Budget changes return in M12 with preview and confirm, and need new Meta write scopes (not in this PRD).
- Data: none. API: tool registry (F-1300 range, Builder A).
- Permissions: `marketing:view`.
- Edge cases and errors: No problem found: show no card.
- Tests: Integration: the connection token has no write scope. Unit: card text.

### F-1013: Meta CAPI for checkout (keep)
- Priority: P1. Milestone: M0 (unchanged).
- Description: Keep `metaCapiService` as is. Purchase fires on COD create and on Paystack settle. The event id dedupes with the browser pixel. Tracking stays in the form editor only (section 4 item 7).
- Current app: `metaCapiService.ts`, `Order.capiEventFired`.
- Mockup: `checkout-forms.html` Tracking; `connections.html` Checkout website.
- Acceptance criteria:
  - [ ] No code change except tenant scoping tests.
  - [ ] The Marketing page does not set pixel or CAPI fields.
- Data: none. API: none.
- Permissions: unchanged.
- Edge cases and errors: unchanged.
- Tests: existing CAPI tests stay green.

### F-1014: Marketer role access
- Priority: P1. Milestone: M8.
- Description: A new resource `marketing` [view, update] in the permission matrix. Default: Owner, Admin, Manager and the Marketing role holder can view; Owner and Marketing update (mapping).
- Current app: none.
- Mockup: `staff.html` Marketing role.
- Acceptance criteria:
  - [ ] Menu item "Marketing" shows for `marketing:view`.
  - [ ] An AI agent holding Marketing can call the read tools only.
- Data: matrix resource. API: permission checks.
- Permissions: as above.
- Edge cases and errors: none.
- Tests: Integration: matrix.

### F-1015: Rule for "Ask for prepayment" (E4)
- Priority: P2. Milestone: M11.
- Description: The Customers agent card "Ask for prepayment" has no basis while checkout is COD only. Rule: show the button only when the customer's form has an enabled prepaid method (Paystack deposit or full) for a physical product (G1). Until then remove the button. When shown, it opens a pre-filled message with a payment link; a person sends it.
- Current app: Paystack deposit and full exist on forms but the mockup shows COD only (CF-09).
- Mockup: `customers.html` agent card.
- Acceptance criteria:
  - [ ] With only COD enabled the card has no prepayment button.
  - [ ] With a prepaid method enabled on the customer's form, the button shows and opens a pre-filled screen. No money request is sent by the card.
- Data: none. API: none.
- Permissions: as Customers.
- Edge cases and errors: Customer with no form: no button.
- Tests: Unit: rule on both states.

---

## 3. Reports requirements

### F-1050: Reports shell, tabs, dates and compare
- Priority: P0. Milestone: M3.
- Description: Reports has six tabs: Overview, Sales and revenue, Delivery and operations, Team performance, Products and profit, Marketing. A date card has presets and a "Compare to previous period" switch. Tabs reuse the same components and services as Finance, Marketing and Deliveries (section 4 item 6). There is one KPI service; Finance owns the P&L.
- Current app: `Analytics.tsx` (roles super_admin, admin, manager, accountant), 4 tabs, date picker.
- Mockup: `reports.html` header, date card.
- Acceptance criteria:
  - [ ] Presets: Today, Last 7 days, This month (default), Last month, Custom. Label "1-17 Oct 2026" and "Previous period: 1-17 Sep 2026".
  - [ ] Compare shows delta chips (for example orders ▲5% vs 1,380).
  - [ ] Tab visibility by permission: Marketing tab needs `marketing:view`; Products and profit needs `financial:view`; Team needs `analytics:view` plus Owner, Admin, Manager.
  - [ ] Two agent cards on top ("Explain this month", "Logiswift closes only 45% as delivered") are read-only.
  - [ ] A test fails if two tabs give different values for the same KPI.
- Data: none. API: `GET /api/reports/:tab?from&to&compare`.
- Permissions: as above. Call reps and agents have no Reports.
- Edge cases and errors: From after to is rejected. Compare range with no data shows "no data".
- Tests: Integration: shared KPI parity. E2E: switch tabs.

### F-1051: Overview tab
- Priority: P0. Milestone: M3.
- Description: KPI tiles, two charts and a daily table.
- Current app: Analytics Overview (Total Orders, Total Revenue, Delivery Rate, Avg Order Value (pending)).
- Mockup: `reports.html#t-overview`.
- Acceptance criteria:
  - [ ] Tiles: Orders 1,445; Confirmed 1,026 (confirmation 71%, target 70%); Delivered 376 (success 48%, target 60%); Delivered revenue GH₵92,000. Each shows the delta against the previous period.
  - [ ] Charts: Orders and deliveries per day; "Where 1,445 orders ended up": Delivered 376, Failed 354, Returned 48, Out for delivery 148, Waiting to dispatch 100, Pending call 64, Cancelled 355 (sum 1,445). Note "48% success, 34% yield".
  - [ ] Table "Daily breakdown": Date, Orders, Confirmed, Delivered, Revenue, one row per day (17 rows). (RP-16.)
  - [ ] No tile called "Delivery rate".
- Data: none. API: `GET /api/reports/overview`.
- Permissions: `analytics:view`.
- Edge cases and errors: Status "payment_pending" and "payment_failed" are listed under "Other".
- Tests: Integration: status counts sum to total.

### F-1052: Sales and revenue tab (with AOV)
- Priority: P0. Milestone: M3.
- Description: Revenue by delivery date, with the computed AOV (S2).
- Current app: Analytics Sales and Revenue (revenue and orders, product performance, area distribution, daily breakdown).
- Mockup: `reports.html#t-sales`.
- Acceptance criteria:
  - [ ] Tiles: Delivered revenue GH₵92,000; AOV GH₵245 (delivered revenue / delivered orders; the copybook set price is GH₵249); Cash received GH₵68.6k; Cash still with partners GH₵23.4k.
  - [ ] AOV also shows the 30-day AOV that feeds the planned AOV default (F-1113).
  - [ ] Charts: Delivered revenue per day with a September overlay; Revenue by product (donut).
  - [ ] Table "Revenue by region": Region, Delivered, Revenue, Average order, Share. The table uses the regions of the store's country. Cities are not called regions (section 4 item 24). Fixture shown by city: Accra 176, Tema 92, Kumasi 82, Takoradi 26, Cape Coast 0 (total 376); label the column "City" until orders carry a region (GUESS: check `deliveryState` holds region).
  - [ ] Product revenue uses one source with Finance (section 4 item 13).
  - [ ] Sales trends no longer include cancelled orders (the old definition is retired).
- Data: none. API: `GET /api/reports/sales`.
- Permissions: `analytics:view`; cash tiles need `financial:view`.
- Edge cases and errors: Unknown region groups as "Unknown".
- Tests: Unit: AOV. Integration: parity with Finance.

### F-1053: Delivery and operations tab
- Priority: P0. Milestone: M3.
- Description: Delivery success and partner tables with the three named rates.
- Current app: Analytics Delivery and Operations.
- Mockup: `reports.html#t-delivery`.
- Acceptance criteria:
  - [ ] Tiles: Delivery success 48% (376 of 778 closed); Failed deliveries 354 and Returned 48 as separate numbers (section 4 item 30: not "402" alone); Out for delivery now 148; Logiswift pays in 9.2 days.
  - [ ] The mockup text "41% not reachable" stays as a share of failed and returned (402).
  - [ ] Charts: Delivered per day; Failed and returned by reason (Not reachable 165, Refused 96, Wrong address 84, Rescheduled 57); Delivery success by region; "Waiting and returns" (100 waiting, oldest 3 days; 48 returned, 5 missing).
  - [ ] Table "Delivery partners" as NUMBERS.md plus "Pays in" (Logiswift 9.2, Kofi 3.1, Esi 3.6, Kwesi 4.2). Same component as Deliveries.
  - [ ] Rates use the cohort or delivery-date label.
- Data: none. API: `GET /api/reports/delivery`.
- Permissions: `analytics:view`.
- Edge cases and errors: Partner with no closed orders shows "no closed orders yet".
- Tests: Integration: fixture counts.

### F-1054: Team performance tab (rep success fix)
- Priority: P0. Milestone: M1.
- Description: Call rep numbers must count delivered orders whatever the commission state. Today `repPerformanceService` counts only delivered orders with `commissionPaid = false`, so success falls after a payout.
- Current app: Analytics Team Performance; `repPerformanceService.ts` lines 110 to 117.
- Mockup: `reports.html#t-team`.
- Acceptance criteria:
  - [ ] Delivered from confirmed = delivered / confirmed from order status. Pay state is ignored. A test pays out all commission and the rate does not move.
  - [ ] Tiles: Orders confirmed 1,026; Calls made 2,310 (2.25 per confirmation); Not reachable 540 (23% of calls); Pending in the queue now 64 (oldest 3 h 10 min, 9 with no rep).
  - [ ] Charts: Call outcomes (donut); Why customers decline (301: price too high 34%, prank or mistake 22%, changed mind 20%, bought elsewhere 14%, other 10%).
  - [ ] Table "Call reps": Rep, Calls, Confirmed (activity count; the role target is 723 confirmed orders that get delivered, P7), Confirmation rate, Delivered from confirmed, Time to first call, Upsell rate, Extra value, Target hit, Not reachable; rows Adwoa 640/73%/52%/12 min/24%/GH₵6,100, Confirm agent 328/70%/44%/2 min/15%/GH₵2,200, Nana 58/58%/30%/41 min/9%/GH₵300, All 1,026/71%/48%/9 min/20%/GH₵8,600.
  - [ ] No "confirmed per call %".
  - [ ] Bars "Delivery partners ranked": Esi 55%, Kofi 54%, Kwesi 54%, Logiswift 45%, Kasapa n/a.
  - [ ] AI agents show under the role they hold.
- Data: none. API: `GET /api/reports/team`.
- Permissions: Owner, Admin, Manager.
- Edge cases and errors: Rep with no confirmed orders shows 0%, not NaN.
- Tests: Unit: the paid-out case. Integration: fixture rows.

### F-1055: Products and profit tab
- Priority: P1. Milestone: M5.
- Description: Net result, profit by product and "two ways to read October". Reuses the Finance components (F-922, F-924, F-925).
- Current app: none.
- Mockup: `reports.html#t-products`.
- Acceptance criteria:
  - [ ] Tiles: Net result -GH₵14.3k (-16%, target 35%); Delivered revenue GH₵92,000 (5 products); Meta ad spend GH₵76,200 (83% of revenue); Profit per delivered order -GH₵38 (copybook -GH₵57, before rep commission).
  - [ ] Card: "By delivery date -GH₵14.3k (-16%). By order cohort GH₵9.9k (8%)."
  - [ ] Charts and table use the Finance component; no second calculation.
  - [ ] Delivery fees and rep commission are separate P&L lines, as in file 10 (decision R6). October margin is about -16 percent once the commission line is in (formula wins, R1); updated 2026-10-19.
- Data: none. API: reads F-924/F-925.
- Permissions: `financial:view`.
- Edge cases and errors: as Finance.
- Tests: Parity test with Finance.

### F-1056: Marketing tab
- Priority: P1. Milestone: M8.
- Description: The same component as the Marketing page: tiles with previous period, funnel, campaigns with ads, plus charts "Meta spend per day" and "CPA against max CPA".
- Current app: none.
- Mockup: `reports.html#t-marketing`.
- Acceptance criteria:
  - [ ] No second implementation; the page imports the Marketing components (F-1004 to F-1011).
  - [ ] Date range and compare follow the Reports date card.
- Data: none. API: Marketing endpoints.
- Permissions: `marketing:view`.
- Edge cases and errors: Meta not connected: tab shows "Connect Meta Ads".
- Tests: Parity test.

### F-1057: Export CSV and Excel (G8)
- Priority: P0. Milestone: M3.
- Description: First release: CSV and Excel direct download only (G8). Export menu items: CSV and Excel for the open tab, and "Download all reports (Excel)" (one workbook, one sheet per tab). No PDF. No custom export dialog. No saved reports. No recent exports list. These come later.
- Current app: CSV in a few places.
- Mockup: `reports.html` Export menu, Export dialog, Recent exports.
- Acceptance criteria:
  - [ ] CSV and Excel download at once as a browser download. No file is stored on the server.
  - [ ] No row limit of 500 (the old export cap). A large export streams.
  - [ ] File name: `<report>-<from>-<to>.csv`.
  - [ ] Excel has the same figures as the screen, 2 decimals, dates as dates.
  - [ ] The menu has no PDF item, no "Custom export", no "Saved reports" and no "Recent exports" card.
  - [ ] Amounts follow the compare switch: when on, previous period columns are added.
- Data: none. API: `GET /api/reports/:tab/export?format=csv|xlsx`.
- Permissions: Tool "Export data" (`analytics:export`, new action).
- Edge cases and errors: Range over 366 days asks to narrow it. Excel sheet limit of 1,048,576 rows stops the export with a message.
- Tests: Integration: exported totals equal screen totals.

### F-1060: "Explain this month" card
- Priority: P2. Milestone: M11.
- Description: A read-only AI card that writes three short paragraphs about the month from KPI services. "Add to export" is not in the first release.
- Current app: none.
- Mockup: `reports.html` agent card.
- Acceptance criteria:
  - [ ] The text uses numbers from the KPI services only (same source as the tiles) and the three rate names.
  - [ ] No data is changed.
- Data: none. API: tool registry (Builder A).
- Permissions: Owner, Admin, Manager.
- Edge cases and errors: AI unavailable: card hidden.
- Tests: Unit: numbers in the text match the KPI response.

### F-1061: Call tracking cards and outcomes
- Priority: P2. Milestone: M7.
- Description: Keep call tracking: Today, This week, This month, Average per day, and the call outcome chart. Outcomes follow the new list (Confirmed, Not reachable, Call back later, Declined, Wrong number).
- Current app: Team tab call cards; `/api/calls/stats`.
- Mockup: `reports.html#t-team` call outcomes.
- Acceptance criteria:
  - [ ] Cards: Today, This week, This month, Average per day.
  - [ ] Outcome donut uses the extended `CallOutcome`.
- Data: `CallOutcome` extended (Builder B2, rep area). API: `/api/calls/stats`.
- Permissions: `analytics:view`.
- Edge cases and errors: Old outcomes map to new ones in a legacy bucket "Other".
- Tests: Integration: stats.

### F-1064: Order pipeline and region charts
- Priority: P2. Milestone: M3.
- Description: Replace the old pipeline funnel and area chart with the "Where orders ended up" chart (F-1051) and the region tables (F-1052, F-1053).
- Current app: Order Pipeline funnel; area distribution.
- Mockup: `reports.html` region tables.
- Acceptance criteria:
  - [ ] Old charts are removed.
  - [ ] Region tables use the regions of the store's country when data allows.
- Data: none. API: as above.
- Permissions: `analytics:view`.
- Edge cases and errors: as F-1052.
- Tests: Build and parity.

### F-1099: Documentation sync
- Priority: P3. Milestone: M0.
- Description: `DESIGN-SPEC.md` still lists delivery rate 26% (target 40%) and CPA ceiling ₦6,400 (section 4 item 22). Update it to the three rates and max CPA, and remove the 80% airtime lines. Also relabel the mockup chart-of-accounts codes (file 10, F-903).
- Current app: docs only.
- Mockup: `DESIGN-SPEC.md` rule 7 and Round 2 sample data.
- Acceptance criteria:
  - [ ] No file in `docs/mockups/v2` shows "26%" as a KPI, "₦6,400" or "airtime".
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: none.
- Tests: grep check in CI docs step.

---

## 4. Dropped by decision

- Saved reports (RP-09) and Recent exports (RP-10), PDF and the custom export dialog (RP-08 part): dropped for the first release by G8.
- Top rep and top agent cards (RP-13), customer insights (RP-15): dropped by the matrix.

## 5. Cross-area dependencies

- File 10: F-900 (revenue), F-922/F-924/F-925 (profit), F-933 (spend posting), F-927.
- File 12: F-1232 (FX rates), F-1113 (planned AOV and calculators), F-1205 (Meta Ads connection card), F-1229 (operating hours).
- Builder A: tool registry and suggestion cards F-1300 range; permissions in the shell.
- Builder B1: order campaign tags (F-400 range), call outcomes and rep data (F-750), customer segments (F-350).
- Builder B2: landed cost (F-650), fee rules (F-700).

## 6. Open questions and GUESS items

| Item | How to check |
|---|---|
| Meta scopes and App Review (F-1000) | Read Meta Marketing API docs before M8 |
| Meta rate limits and attribution window (F-1001) | Read Meta docs |
| Pull every hour (mockup) against daily (design doc) | RESOLVED (R7): hourly for today; daily re-pull of the last 3 days |
| Campaign status rules (F-1006) | Owner sets |
| 30-day closed cohort rule (F-1008) | Check order age in production |
| How campaign and ad names reach orders (F-1005, F-1010) | Check pixel and form UTM fields |
| `deliveryState` holds a region (F-1052) | Query production |

## 7. Coverage table


### Section 1 rows

| Matrix row | Verdict | Covered by |
|---|---|---|
| MK-01 Meta connection status | NEW | F-1000 |
| MK-02 KPI tiles (spend, CPA vs max CPA, projected cost, yield) | NEW | F-1004 |
| MK-03 Funnel (7 steps) | NEW | F-1005 |
| MK-04 Campaigns table | NEW | F-1006 |
| MK-05 Ad drilldown (hook, hold, frequency) | NEW | F-1010 |
| MK-06 Map campaign to product | NEW | F-1003 |
| MK-07 Daily spend vs orders | NEW | F-1011 |
| MK-08 Agent cards | NEW | F-1012 |
| MK-09 Meta CAPI for checkout | KEEP as-is | F-1013 |
| RP-01 Overview | CHANGE | F-1051 |
| RP-02 Sales and revenue | CHANGE | F-1052 |
| RP-03 Delivery and operations | CHANGE | F-1053 |
| RP-04 Team performance | CHANGE | F-1054 |
| RP-05 Products and profit | NEW | F-1055 |
| RP-06 Marketing tab | NEW | F-1056 |
| RP-07 Date presets and compare to previous | CHANGE | F-1050 |
| RP-08 Export (CSV, Excel, PDF), custom export dialog | NEW | F-1057 (CSV and Excel only; PDF and custom dialog dropped by G8) |
| RP-09 Saved reports | NEW | DROP: G8 (saved reports later) |
| RP-10 Recent exports (kept 7 days) | NEW | DROP: G8 (recent exports later) |
| RP-11 "Explain this month" | NEW | F-1060 |
| RP-12 Call tracking cards, call outcomes | KEEP+RESTYLE | F-1061 |
| RP-13 Top rep and top agent cards | DROP | DROP: matrix DROP (leaderboard replaces) |
| RP-14 Order pipeline funnel, area distribution | CHANGE | F-1064 |
| RP-15 Customer insights | DROP | DROP: matrix DROP |
| RP-16 Daily sales breakdown | KEEP+RESTYLE | F-1051 |

### Section 3 broken items in scope

| # | Item | Covered by |
|---|---|---|
| 17 | Delivery rate mixes cohorts; four revenue definitions | F-1008, F-1053 |
| 18 | `getCustomerInsights.activeCustomers` duplicates total | DROP with RP-15 (F-1051 shows no customer insights) |

### Section 4 mockup fixes in scope

| # | Issue | Covered by |
|---|---|---|
| 2 | **Approved.** AOV is a typed field. | F-902, F-1052, F-1113, F-1230 |
| 6 | Reports repeats other screens | F-1050, F-1055, F-1056 |
| 22 | `DESIGN-SPEC.md` still lists 26% and ₦6,400 | F-1099 |
| 24 | Region lists use 6 or 7 regions; Reports "regions" are cities | F-1052, F-1053 |
| 30 | Reports "Failed 402" counts failed + returned; Orders shows them apart | F-1053 |
| E4 | Agent card "Ask for prepayment" and Paystack "Real customers cannot pay yet" with COD only | F-1015, F-1204 |

Count check: section 1 rows 25, section 2 rows 0, section 3 rows 2, section 4 rows 6. Total 33.
