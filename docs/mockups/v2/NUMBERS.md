# Round 3 — KPI changes and canonical numbers

Source: owner-approved KPI review (docs/research/kpi-review.html, 18 Oct 2026) + owner request for an upsell reward and a call-rep screen. Updated 19 Oct 2026 for the mockup fix pass (gap-matrix section 4) and the owner decisions in docs/prd/decisions.md (O1 to O7, F1 to F4, D9, R2, R4). Changes in that update are marked (19 Oct).
Every page must use these numbers. If a page needs a number not listed here, derive it from these and say so in your report. Period is 1–17 Oct 2026 unless stated. GH₵1 = ₦112.

## Owner decisions (all approved)
- A. Three rate names, used everywhere, never plain "delivery rate":
  - **Confirmation rate** = confirmed ÷ orders placed. Call-centre number. Target 70%.
  - **Delivery success rate** = delivered ÷ (delivered + failed + returned), closed orders only. Fulfilment number. **Target 60%** (the old 40% target is gone).
  - **Order-to-cash yield** = delivered ÷ orders placed, on order cohorts that have closed. Owner + marketer number.
- B. Marketing target = **max CPA that moves with the yield**: max CPA = profit per delivered order before ads × yield. Replaces the fixed ₦6,400 ceiling.
- C. Rep commission = **GH₵8 per confirmed order that gets delivered** (replaces GH₵4 per confirmed and GH₵5 per delivered).
- D. North Star shows **margin next to revenue** at year, quarter, month (target 35% net margin).
- E. Build the **call-rep screen** now (rep.html).
- New: **upsell reward** — 10% of the extra value a rep adds at confirmation (more units, a higher tier/package, add-ons), paid only when the order is delivered. AI agents get no payout.

## Headline (unchanged)
Orders 1,445 · confirmed 1,026 (71%) · delivered 376 · delivered revenue GH₵92,000 · AOV GH₵245 · Meta spend ₦8.53M (GH₵76,200) · CPA ₦5,903.

## Order flow (1,445 orders)
- Not confirmed 419 (pending 64 + cancelled 355).
- Confirmed 1,026 = waiting to dispatch 100 + dispatched 926.
- Dispatched 926 = delivered 376 + failed/returned 402 (failed 354 + returned 48) + out for delivery 148.
- Closed confirmed = 778 → **delivery success 48%** (376 ÷ 778). Target 60%.
- **Yield ~34%** (71% × 48%). Old "26%" was delivered ÷ all orders including in-flight: remove it as a KPI.

## North Star / setup maths
- (19 Oct) Planned AOV fixture: GH₵249, the last-30-days figure, editable. GH₵180k a month ÷ GH₵249 = 723 delivered. At 70% confirmation × 60% success → 1,721 orders a month → ÷ real days in the month (October has 31) = **56 orders a day** (R2). A 30-day month gives 57 or 58. The setup screen and Settings calculate and show this. Max cost per order = ₦20,720 × 42% yield = ₦8,700. (The AOV of delivered orders 1–17 Oct is GH₵245; Finance and Reports show that computed figure.)
- Today's orders: 64 against the 56-a-day target. Actual pace: 85 orders a day (ahead), success 48% (behind). Story: **orders are ahead of plan, delivery success is why revenue lags.**
- October projected GH₵164k (91%). Biggest lever: delivery success, +5 pts ≈ +GH₵22k this month.
- Margin: Q1 11%, Q2 12%, Q3 12% (target 35%) → quarters show "Revenue hit · margin missed". Year to date 12%. October by delivery date −16%; October order cohort (projected) 7%.

## Delivery partners (closed-order success rate, target 60%)
| Partner | Assigned | Delivered | Failed/returned | Out now | Success | Confirmed→dispatched | Dispatched→delivered |
|---|---|---|---|---|---|---|---|
| Logiswift (3PL, Accra/Tema) | 590 | 220 | 270 | 100 | 45% | 1.4 days | 3.8 days |
| Kofi Appiah (agent, Kumasi) | 172 | 82 | 70 | 20 | 54% | 0.6 | 1.2 |
| Esi Badu (agent, Accra) | 102 | 48 | 40 | 14 | 55% | 0.7 | 1.5 |
| Kwesi Amoah (agent, Takoradi) | 54 | 26 | 22 | 6 | 54% | 0.9 | 1.9 |
| Kasapa Express (3PL trial, Cape Coast) | 8 | 0 | 0 | 8 | no closed orders yet | 1.0 | — |
| **All** | **926** | **376** | **402** | **148** | **48%** | | |
- Waiting to dispatch: 100 orders, oldest 3 days.
- Returns: 48 returned orders; Logiswift sent back 41 units, we received 36 (5 missing).
- (19 Oct) Failed and returned by reason (402 = 354 failed + 48 returned): not reachable 41% (165), refused 24% (96), wrong address 21% (84), rescheduled 14% (57). There is no "Accra Central 18%" finding; the zone-level finding is removed from every page. Days to pay: Logiswift 9.2, Kofi 1.8, Esi 2.4, Kwesi 3.1.
- (19 Oct) **Delivery fee** (one term, F1). Each partner has one fee rule: per delivered · per failed · per returned. Logiswift GH₵35 · 0 · 0. Kofi Appiah GH₵25 · 5 · 0. Esi Badu GH₵25 · 0 · 0. Kwesi Amoah GH₵30 · 5 · 0. Kasapa Express GH₵30 · 0 · 0. The partner keeps the fee from the cash it collects and hands in the rest. Expected cash = cash collected − fees (F4). There is no separate agent pay and no fee payout; the old GH₵12/GH₵10 "agent pay" is removed. Fees kept in October: Kofi GH₵2,400 (82 × 25 + 70 × 5), Esi GH₵1,200 (48 × 25), Kwesi GH₵890 (26 × 30 + 22 × 5). Cash held (net of fees): Logiswift GH₵17,300, Kofi GH₵2,900, Esi GH₵2,100, Kwesi GH₵1,100, Kasapa GH₵0 = GH₵23,400.
- Delivery leaderboard (% of 60% target): Esi 92%, Kofi 90%, Kwesi 90%, Logiswift 75%.

## Call reps
| Rep | Confirmed | Closed | Delivered | Delivered from confirmed | Calls | Time to first call (median) | Upsell rate | Extra value on delivered orders | Upsell reward (10%) | Commission (GH₵8 × delivered) |
|---|---|---|---|---|---|---|---|---|---|---|
| Adwoa Darko | 640 | 486 | 253 | 52% | 1,360 | 12 min | 24% | GH₵6,100 | GH₵610 | GH₵2,024 |
| Confirm agent (AI) | 328 | 249 | 110 | 44% | 780 | 2 min | 15% | GH₵2,200 | no payout | no payout |
| Nana Kyei | 58 | 43 | 13 | 30% | 170 | 41 min | 9% | GH₵300 | GH₵30 | GH₵104 |
| **All** | **1,026** | **778** | **376** | **48%** | **2,310** | **9 min** | **20%** | **GH₵8,600** | | |
- Confirmation rate per rep (confirmed ÷ assigned): Adwoa 73%, Confirm agent 70%, Nana 58%. Calls per confirmation: 2.25 overall. Drop the "confirmed per call %" metric.
- Queue now: 64 pending, oldest waiting 3 h 10 min; 9 have no rep.
- Decline reasons (301 declined): price too high 34%, prank/ordered by mistake 22%, changed mind 20%, bought elsewhere 14%, other 10%.
- Payouts: Adwoa GH₵840 on 1 Oct (September balance) and GH₵600 on 9 Oct (October commission). No other October rep payouts. Adwoa owed: 2,024 + 610 − 600 = GH₵2,034. Nana owed: 104 + 30 = GH₵134. Commissions payable (GL 2020) = GH₵2,168. Keep the balance sheet balanced (adjust owner's equity / October result, and say how).
- Upsell tiers the rep can offer (from the checkout form packages): 1 copybook set GH₵249 · 2 sets GH₵449 · 3 sets GH₵629 · add-ons: refill pens GH₵40, pencil grip trainer GH₵35, Smart Parent's guide GH₵59.
- (19 Oct) Rep target (role) = **confirmed orders that get delivered**, counted at month close (P7). Role target 723 (= the delivered target), split Adwoa 423, Confirm agent 250, Nana 50. Progress now: Adwoa 253 of 423 (60%), Confirm agent 110 of 250 (44%), Nana 13 of 50 (26%), all reps 376 of 723 (52%); pace marker 55% (day 17 of 31). To 100%: Adwoa 170 more, Confirm agent 140, Nana 37. "Confirmed" stays as an activity column (Adwoa 640, Confirm agent 328, Nana 58, all 1,026). Cash reward tiers only, no airtime tier anywhere (D9): call rep 100% GH₵300, 120% GH₵500 + paid day off; delivery 100% GH₵250, 120% GH₵400 + paid day off. They live only in Settings, Rewards. Rewards are earned at month close (G4), so at 60% of target Adwoa has earned no reward yet. Upsell reward is separate and has its own leaderboard tab "Upsell". Daily call-rep activity target: failed delivery calls, 15 a day (6 done today).

## Marketing funnel (1–17 Oct)
| Campaign | Spend | Impressions | Link clicks | Landing page views | Checkouts started | Orders | Yield (closed) | Projected cost per delivered | Max CPA | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| MG_Oct_Teacher_UGC | ₦4,370,000 | 2,000,000 | 33,000 | 23,400 | 2,300 | 777 | 36% | ₦15,620 | ₦7,460 | Winning |
| MG_Oct_Mom_POV | ₦2,350,000 | 1,150,000 | 16,500 | 11,500 | 1,170 | 387 | 34% | ₦17,860 | ₦7,040 | On track |
| MG_Oct_Benefit_Stack | ₦1,529,000 | 820,000 | 10,800 | 7,300 | 700 | 234 | 29% | ₦22,530 | ₦6,010 | Over max CPA |
| MG_Oct_Retarget (not mapped) | ₦41,000 | 30,000 | 600 | 450 | 30 | 7 | 33% | ₦17,750 | — | Not mapped |
| DT_Oct_Dignity | ₦240,000 | 100,000 | 600 | 350 | 100 | 40 | 30% | ₦20,000 | ₦4,030 | Paused |
| **All** | **₦8,530,000** | **4,100,000** | **61,500** | **43,000** | **4,300** | **1,445** | **34%** | **₦17,360** | **₦7,040** | |
- Account rates: CPM ₦2,080 · CTR 1.5% · CPC ₦139 · landing page views 70% of clicks · checkout started 10% of LPV · orders 34% of checkouts (3.4% of LPV).
- Break-even (profit per delivered order before ads): copybook GH₵185 = ₦20,720 (249 − 30 landed cost per set − 34 weighted fee from the fee rules, R5). Owner set landed cost GH₵30 per set on 18 Oct (was 40 here, 86 on Products). Max CPA at 34% = ₦7,040 (CPA ₦5,903 is ₦1,137 under). At the 42% target yield = ₦8,700. Dictamni GH₵120 = ₦13,440.
- Keep confirmed/delivered columns and the actual cost per delivered (₦22,686, by delivery date) but label it; the decision number is projected cost per delivered on closed cohorts.
- Ad-level view (under a campaign): 2–4 ads each, spend summing to the campaign; video ads show hook rate (3-sec views ÷ impressions) 20–32% and hold rate (ThruPlays ÷ impressions) 5–10%, frequency 1.4–2.6. Teacher UGC has the best hook rate. No reach/likes/comments/shares.

## Chart of accounts (19 Oct, R4)
Live codes. Mockup code to live code: cash at bank and MoMo 1000 → 1010. Cash held by delivery partners 1100 → 1015 (one account, no double count). Inventory 1200. Supplier payables 2000 → 2050 (new). Commissions payable 2100 → 2020. Unapplied partner receipts 2040 (new). Owner's equity 3000 → 3010 (new, GH₵109,200 so the books balance with the 5050 line). Sales revenue 4000 → 4010. Cost of goods sold 5000 → 5010. Delivery fees 5100 → 5070 (one line, 3PL and agents together). Meta ad spend 5200 → 5080. Rep commission and rewards 5050 (new line, R6). Other expenses 5300 → 5100. Trial balance: debits GH₵213,168 = credits GH₵213,168. Balance sheet totals stay GH₵106,900 (October result −GH₵14,268; equity GH₵109,200 is the balancing figure).

## Orders used across screens (19 Oct, one order table)
#24117 Abena Owusu, Adum, Kumasi, GH₵249, delivered by Kofi Appiah, 17 Oct. #24116 Kwame Mensah, Tema, 2 sets GH₵498, out for delivery with Logiswift. #24115 Efua Asante, Osu, Accra, GH₵249, confirmed, Esi Badu. #24114 Yaw Boateng, Asokwa, Kumasi, GH₵249, failed 17 Oct (brother refused), re-delivery Tue 20 Oct, Kofi Appiah. #24113 Gifty Addo, Kejetia, Kumasi, 3 sets GH₵747, pending, no rep. #24112 Kojo Annan, Takoradi, preparing, Kwesi Amoah. #24111 Akosua Frimpong, Cape Coast, GH₵289 (set + pens), ready for pickup, Kasapa Express. #24109 Selina Tetteh, Spintex, Accra, failed, Esi Badu. #24107 Nii Lamptey, Teshie, GH₵284, returned. #24105 Mercy Agyeman, Tamale, cancelled. #24098 Ama Nkrumah, Lapaz, Accra, GH₵249, delivered 6 Oct by Logiswift, unpaid. #24071 Kojo Osei, Accra, GH₵348. #24063 Akosua Amoah, Tema, GH₵348. Order numbers are #24xxx everywhere (no CA- or MG- formats). Rep and agent screens use #23xxx and #240xx numbers for their other orders.

## Finance additions
- Profit per delivered order (by delivery date): copybook −GH₵57 (was −67; GH₵10 lower cost per unit), before rep commission. Overall −GH₵38 (after commission). (19 Oct, R6) **Rep commission and upsell rewards are their own P&L line**: GH₵2,768 (commission GH₵2,128 + upsell reward GH₵640, GL 5050). October by delivery date: net −GH₵14,268, margin **−15.5%, shown as −16%** (before the line: −GH₵11.5k, −13%). Cohort GH₵20 per delivered, before other expenses. Aug and Sep stay as booked and show the line as "not split out".
- October order cohort (projected at 34% yield): 491 delivered, revenue GH₵120.3k, product cost GH₵14.7k (491 × 30), fees GH₵15.9k, ads GH₵76.2k → with rep commission and rewards GH₵3.6k (about GH₵7.4 a delivered order), profit GH₵9.9k (8%) before other expenses (was GH₵13.5k, 11%, without commission).
- Cost of failed deliveries (Oct): fees on failed GH₵460 (Kofi GH₵5 × 70, Kwesi GH₵5 × 22) + 5 returned units lost × GH₵30 = GH₵610. A failed order costs GH₵0 to GH₵5 in fees by partner.
- (19 Oct) Copybook set by delivery date: 306 delivered, revenue GH₵76,100, cost GH₵9,200, fees GH₵10,500, ads GH₵73,700 → loss GH₵17,300 (−GH₵57 a set; ads GH₵241 + fees GH₵34 + product cost GH₵30 against a GH₵249 price). Add-ons earn GH₵10,200. Delivered units: copybook 306, refill pens 172, grip trainer 89, Smart Parent's guide 58 (Products, Finance and Reports all read these).
- (19 Oct) Payout reconciliation, expected cash after fees (collected − fees): Logiswift 11 Oct paid GH₵9,880 against GH₵10,720 expected (44 orders on its list, 41 paid) → short GH₵840. The 3 missing orders: #24098 GH₵249, #24071 GH₵348, #24063 GH₵348, each less the GH₵35 fee = GH₵214 + GH₵313 + GH₵313 = GH₵840. Matched: Kofi 9 Oct 14 orders GH₵3,136; Esi 8 Oct 12 orders GH₵2,688; Logiswift 4 Oct 46 orders GH₵9,844; Kasapa 2 Oct 8 orders GH₵1,752. Collections to verify: Kofi 9 orders GH₵2,016, Esi 6 orders GH₵1,344 (no receipt), Kwesi 5 orders GH₵1,095, Logiswift GH₵9,880 → GH₵14,335.
- Cash runway: GH₵41.9k cash ÷ GH₵4,500 ads a day ≈ 9 days of ads.
- Monthly P&L: add a "1–17 Sep" column (same days last month) next to full Aug/Sep; Reports already uses 1–17 Sep: revenue GH₵96k.
- Show "₦112 = GH₵1" where ad spend is converted. (19 Oct) The store currency is not locked (O6). Sample: the rate is a manual override typed on 1 Oct, 16 days old, so the stale warning shows (stale warnings show for manual rates only). Rate history: 28 Sep 112.1, 29 Sep 111.8, 30 Sep 111.6 (automatic), 1 to 17 Oct 112 (manual). "Use today's rate" returns to the daily automatic rate.

## Stock
- 9 Oct copybook shipment (Accra Print House, 300 shipped): counted 288, short 12, received at Logiswift warehouse (Tema), landed cost per unit recalculated on 288. Match inventory.html, which already says "12 short, Logiswift booked 288".

## Settings, Messages and billing samples (19 Oct)
- Operating hours: Mon to Fri 08:00 to 20:00, Sat 09:00 to 18:00, Sun 10:00 to 16:00 off. Queue wait alert 30 min, time to first call target 15 min (median now 9 min), default days to pay 7, low stock alert 14 days of cover.
- Billing: the owner's plan is Free, no limits. Plans shown: Growth ₦10,000 a month, 5,000 orders, 10 staff. Scale ₦20,000, unlimited. Enterprise, contact sales@codadmin.app. No stores, no "1,500 orders", no "3 AI agent keys".
- Messages in October: 6,000 sent (2,850 WhatsApp, 3,150 SMS, GH₵312), 94% delivered, 312 replies (11% of WhatsApp). 26 conversations in the list: 14 unreplied, 9 failed today (6 no WhatsApp, 3 network), 3 answered.
- Regions come from the store's country. The samples use Greater Accra, Ashanti, Western, Central, Eastern, Volta and Northern. Reports show cities (Accra, Tema, Kumasi, Takoradi, Cape Coast), labelled as cities.
- "Assign by region" is a Workflow (O4): Region is Ashanti → Kofi Appiah (240 runs this week). Region is Greater Accra → Esi Badu and Logiswift evenly (372 runs). Orders with no matching workflow stay unassigned for the fulfilment lead.

## Writing rules
Plain short labels. No emojis. No XP/streaks. No new numbers that aren't needed. Remove clutter you replace; don't stack old and new versions of a metric.
