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
