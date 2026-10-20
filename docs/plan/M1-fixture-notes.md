# M1-T23 fixture notes: how each NUMBERS.md number is read

Fixture: `npm run seed:fixture` (backend). Code: `backend/src/__tests__/fixtures/numbersFixture.ts`. One tenant, slug `fixture-numbers`. Order numbers 23001 to 24445 (`Order.externalOrderId`, in placement order). Fixed random seed 20261017.

## Readings
- **Orders and statuses**: 1,445 = 64 pending + 355 cancelled + 100 waiting (40 confirmed, 35 preparing, 25 ready for pickup) + 148 out + 376 delivered + 354 failed + 48 returned. Confirmed 1,026 = rows with `confirmedAt` and `confirmedById`.
- **Pending orders**: all 64 are placed on 17 Oct (the "64 orders today", queue wait up to 3 h 10 min from "now" = 17 Oct 13:00). No other order is placed on 17 Oct. 9 pending orders have no rep.
- **Partners**: Assigned = orders with `deliveryAgentId` = dispatched orders (926). Waiting-to-dispatch orders have no partner yet. Closed = failed + returned. Partners are `delivery_agent` users (Logiswift 3PL, Kofi Appiah, Esi Badu, Kwesi Amoah, Kasapa Express).
- **Returned split by partner**: the page gives only "Logiswift sent back 41 units" (units, not orders). Read as 41 returned orders for Logiswift; the other 7 are Kofi 4, Esi 2, Kwesi 1 (GUESS, the page does not say). Failed = closed minus returned per partner.
- **Reps**: "Confirmed" = `customerRepId` and `confirmedAt` set; "Closed" = delivered + failed + returned; "Delivered" = delivered. The AI "Confirm agent" is a `sales_rep` user whose calls have source `auto_confirm` and whose history rows have actor `ai`.
- **Calls**: 1,360 / 780 / 170 = 2,310, one or more per order a rep worked (not pending). `firstContactAt` = the earliest call. Median time to first call per rep is modelled (12, 2, 41 min).
- **Products and units**: the five listed products only. Delivered units 306 + 172 + 89 + 58 + 10 = 635 over the 376 delivered orders. 10 delivered orders hold only Dictamni, 60 hold only add-ons, 306 hold one copybook set (with add-ons on some). The NUMBERS.md orders of 2 and 3 sets are not modelled in the delivered orders: unit totals need 306 sets in at most 306 orders.
- **Revenue and AOV**: delivered revenue is `SUM(totalAmount)` = GH₵92,000.00. AOV 245 = 92,000 / 376 = 244.68 rounded.

## Conflicts and guesses
1. **Line prices do not add to 92,000.** Units at list price (249 / 40 / 35 / 59) give 89,611, plus 10 Dictamni at GH₵250 (price from the mockup: 10 units earn GH₵2,500) = 92,111. Three delivered copybook orders carry a GH₵37 discount (111 in all) so the total is exactly 92,000. Unit totals are exact.
2. **Product revenue**: the mockup copybook line says 76,100; 306 x 249 = 76,194 (decision R1: use 76,194).
3. **Add-on revenue**: the mockup says GH₵10,200; the unit counts at list price give 13,417. Units win.
4. **Confirmation rate per rep** (73% / 70% / 58%) fixes assigned orders at 871 / 465 / 100 (total 1,436 = 1,445 less the 9 with no rep). Adwoa 640 / 871 = 73.5%, Confirm agent 328 / 465 = 70.5% (rounds to 71%, not the page's 70%; no whole-number split makes all three round as the page does), Nana 58 / 100 = 58%. Not in T23's list, so the closest split is used.
5. **Dictamni price** GH₵250 and COGS: only the copybook set has a cost (GH₵30, owner's 18 Oct figure). The others are 0. GUESS.
6. **Delivery fee, commission and rewards**: no `FeeRule` rows, rep `commissionAmount` stays 0, so each revenue entry is Dr 1015 (cash in transit) total / Cr 4010 total, plus COGS Dr 5010 / Cr 1200. Part 2 and M5 add the rest.
7. **Order ids** (autoincrement) differ between runs. The hash uses order numbers, statuses, totals, dates and the rep and partner emails, never ids.

## Part 2 (M1-T24, COD-12 job L)
Same tenant. Own random seed (`FIXTURE_SEED + 1`), so the October plan and its numbers are unchanged. The fixture hash now also covers expenses, targets and partner cash, so it differs from part 1.
- **January to September**: 1,160 delivered orders by delivery date, revenue exactly 118k, 121k, 133k, 131k, 142k, 148k, 158k, 166k, 173k (quarters 372k, 421k, 497k; with 1 to 17 October 1,382,000). Order numbers 10001 up. January to August are about 456 large synthetic orders (average 2,450, F-114 allows it); September is ordinary (about 245) so the last-30-days AOV on 17 October stays 245 (R12). Each order is one line of copybook sets (`ceil(total / 249)`), the discount makes the total exact. No rep, no partner, no calls. History rows (pending, confirmed, out for delivery, delivered) and a revenue entry (4010) dated deliveryDate, posted like October's.
- **Margin history**: 36 `Expense` rows (4 categories a month, dated the 25th). Pool of a month = revenue x (1 - margin) - product cost of the month's orders, so (revenue - product cost - expenses) / revenue is 11% in Q1 and 12% in Q2 and Q3. October has no expenses (GUESS: M5 decides). Expenses have no ledger entries (GUESS: M5 posts them).
- **Targets**: year 1,800,000 (`north_star`, `revenue`), quarters 360k, 420k, 480k, 540k, October 180,000; confirmation rate 70 and delivery success rate 60 (`north_star`, percent). No `planned_aov` row: the default is computed.
- **Cash held by partners**: `AgentBalance` rows (the app's per-agent holding): Logiswift 17,300, Kofi 2,900, Esi 2,100, Kwesi 1,100, Kasapa 0 = 23,400, net of fees. Not posted to GL 1015 (the revenue entries keep the gross).
- **Meta spend**: `fixtures/meta-spend.json`, 5 campaigns, NGN 8,530,000, 1,445 orders. M8 loads it.
- **Existing checks**: `numbersFixture.test.ts` queries that count every order of the tenant must be limited to orders placed from 1 October (the history orders are delivered too). Patch: `/Users/mac/.claude/jobs/bbc2f605/tmp/COD-12-L-numbersFixture-test.patch`.
- **Dev DB**: re-seeded locally with `npm run seed:fixture`. `deleteFixtureRows` now also deletes `AgentCollection` rows (150 drafts for fixture orders had been written to the dev copy by something else, and blocked the re-seed).
