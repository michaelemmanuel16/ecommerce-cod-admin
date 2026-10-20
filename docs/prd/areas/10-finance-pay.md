# PRD area 10: Finance and pay (F-900 to F-999)

Status: draft for owner review. Date: 2026-10-18. Writer: Builder C.
Sources: `docs/prd/decisions.md`, design doc 2026-10-18 (sections 3, 4, 5, 8, 9, 10), `gap-matrix.md` (1.10 Finance, section 3, section 4), `NUMBERS.md`, `finance.html`, and the code checked on 2026-10-18 (`glAutomationService.ts`, `financialService.ts`, `config/glAccounts.ts`, `payoutService.ts`, `schema.prisma`).

## 1. Scope

This file covers gap-matrix section 1.10 (FI-01 to FI-28). It also covers the section 3 broken items and the section 4 mockup fixes that touch money: section 3 items 8, 11, 21, 22, 33, 34, 35, 36, 47, 48 and section 4 items 5, 13, 14, 15, E1 (see the coverage table).

Roles that use these screens:
- Owner (`super_admin`): everything.
- Finance clerk (base role `accountant`): all of Finance. Cannot edit targets.
- Admin and Manager: view, verify collections, record payouts (as today).
- Call rep and delivery agent: see only their own pay in their own apps (not in Finance).

Words used in this file:
- Delivered revenue = the value of delivered orders, dated by delivery date (design doc section 4).
- Partner = a delivery agent (person) or a 3PL (company).
- Delivery fee = what we pay whoever delivers an order (a 3PL company or an own agent). One fee rule per partner sets it, per delivered, failed and returned order (decisions F1, F2). It is booked once as a delivery fee expense when the outcome happens (F3). The partner keeps the fee from the cash it collects and hands in the rest, so expected cash = cash collected minus fees (F4). There is no separate "pay-per-delivery for agents" and no fee payout.
- Cash held = cash a partner has collected and not yet paid to us.

## 2. Accounting rules used by every requirement

### 2.1 The live chart of accounts

Use the codes that the code uses today (`config/glAccounts.ts`). Do not use the mockup codes (1000, 1100, 2100, 4000, 5100, 5200, 5300). Section 4 item E1 asks for this.

| Live code | Name | Type | Status |
|---|---|---|---|
| 1010 | Cash in Hand | Asset | Live. Shown as "Cash at bank and MoMo" in the UI. See open question Q-F1. |
| 1015 | Cash in Transit | Asset | Live. Becomes the one account for cash held by partners. |
| 1020 | Accounts Receivable - Agents | Asset | Live. Stops being used. See F-904. |
| 1030 | Paystack Receivable | Asset | Live. |
| 1200 | Inventory | Asset | Live. |
| 2010 | Refund Liability | Liability | Live. |
| 2020 | Commissions Payable | Liability | Live. Holds rep commission, upsell reward and rep target reward. |
| 4010 | Product Sales Revenue | Revenue | Live. |
| 4020 | Digital Product Revenue | Revenue | Live. |
| 5010 | Cost of Goods Sold | Expense | Live. |
| 5020 | Failed Delivery Expense | Expense | Live. |
| 5030 | Return Processing Expense | Expense | Live. |
| 5040 | Delivery Agent Commission | Expense | Live. Stops receiving postings. Delivery fees go to 5070 (decision F3). Kept inactive for Aug and Sep history (D5). |
| 5050 | Sales Rep Commission | Expense | Live. Renamed "Commissions and rewards" in the UI. Holds rep commission, upsell reward and target rewards (rep and delivery agent). |
| 5060 | Paystack Transaction Fees | Expense | Live. |
| 5100 | Operating Expenses | Expense | Live. Receives manual expenses (the mockup's "5300 Other expenses"). |
| 2030 | Agent Pay Payable | Liability | Removed (decision F1). No agent pay payable exists. The code is not used. |
| 2040 | Unapplied Partner Receipts | Liability | NEW. Money from a partner that matches no order. |
| 3010 | Owner's Equity | Equity | NEW. The live chart has no equity account. |
| 5070 | Delivery Fees | Expense | NEW. The mockup's "5100 3PL and agent fees". One line for 3PL and agent fees together, for delivered, failed and returned outcomes (decisions F3, R6). |
| 2050 | Supplier Payables | Liability | NEW. Decision R4. Holds shipment amounts not yet paid (see Q-F2). |
| 5080 | Meta Ad Spend | Expense | NEW. The mockup's "5200 Meta ad spend". |

Mockup to live map: 1000 to 1010. 1100 to 1015. 1200 to 1200. 2000 Supplier payables to 2050 (new, decision R4). 2100 to 2020. 3000 to 3010. 4000 to 4010. 5000 to 5010. 5100 to 5070. 5200 to 5080. 5300 to 5100.

### 2.2 Posting rules (target)

All entries stay idempotent per (sourceType, sourceId), balanced, `Decimal(19,4)`, tenant passed explicitly.

| Event | Date of entry | Debit | Credit |
|---|---|---|---|
| Physical order delivered | `deliveryDate` | 1015 (total minus delivery fee); 5070 (delivery fee from the partner's fee rule); 5050 (rep commission and upsell reward, only for an order the rep confirmed by call, P6); 5010 (COGS) | 4010 (total); 2020 (rep commission); 1200 (COGS) |
| Digital order paid | payment time | 1030 (total); 5060 (Paystack fee) | 4020 (total); 1030 (Paystack fee) |
| Paystack pays out to the bank | payout date | 1010 | 1030 |
| Partner deposit verified or settlement line matched | deposit or payout date | 1010 (cash received, which is cash collected minus fees); 5070 (fee variance, if the real charge differs from the fee booked) | 1015 (net amount cleared) |
| Money from a partner that matches no order | payout date | 1010 | 2040 |
| Failed delivery | close date | 5070 (failed fee from the fee rule, 0 if none) | 1015 (the partner nets the fee from cash it holds; see F-936) |
| Return | return date | reversal of the delivery entry (as today); 5070 for the returned fee from the fee rule, 0 if none | 1015 for the returned fee |
| Rep payout, or target reward payout to a delivery agent | payout date | 2020 | 1010 |

There is no fee payout. The partner keeps the delivery fee from the cash it collects (decision F4), so no payout entry exists for fees.
| Manual expense | `expenseDate` | 5100 | 1010 |
| Meta ad spend (daily) | spend date | 5080 (at that day's rate) | 1010 |
| Shipment received | received date | 1200 | 1010 |

The old rule "collection verified: DR 1010, CR 1015" is removed. It counted the same cash twice (see F-904).

### 2.3 Money type

All money columns that Finance reads are `Decimal(19,4)` (decision D4, F-932). The server adds and divides with Decimal. It rounds half up to 2 places for display and for CSV.

---

## 3. Requirements

### F-900: One delivered-revenue definition for Finance
- Priority: P0. Milestone: M1.
- Description: Finance has four revenue numbers today (design doc risk 1). The Finance screens must use one number: the sum of `totalAmount` of delivered orders, dated by `deliveryDate`. One KPI service computes it. The overview, statements, P&L, profit by product and the MCP `financial_summary` tool all call that service.
- Current app: `financialService.getFinancialSummary` reads GL 4010 by journal `entryDate`. `getProfitMargins` reads delivered orders by `updatedAt`. `GET /api/financial/summary`, `/profit-margins`, `/profitability`.
- Mockup: `finance.html#t-overview` KPI "Delivered revenue (Oct)".
- Acceptance criteria:
  - [ ] `kpi.deliveredRevenue(from, to)` returns the sum of `totalAmount` for orders with `status = delivered` and `deliveryDate` in the range, plus paid digital orders (F-901).
  - [ ] On the NUMBERS.md fixture (1-17 Oct) it returns GH₵92,000 and 376 delivered orders.
  - [ ] Cancelled, returned and failed orders add nothing.
  - [ ] A returned order that was delivered before is removed from the month of its return only if the return date falls in the range; the original delivery month keeps its figure as booked (no restatement of closed months).
  - [ ] Every Finance endpoint listed in Current app returns the same revenue for the same range. One test asserts this.
  - [ ] The nightly check in F-905 reports zero difference on the fixture.
- Data: no new model. Index on `Order(tenantId, status, deliveryDate)`. API: `GET /api/financial/summary` keeps its path and reads the KPI service. `GET /api/financial/profit-margins` is removed (it has no UI).
- Permissions: `financial:view`.
- Edge cases and errors: Orders with `status = delivered` and a null `deliveryDate` (old rows) use `updatedAt` and the health check (F-931) lists them. Range with no orders returns 0, not an error. Time zone is the tenant time zone (Africa/Accra).
- Tests: Unit: KPI function on a fixed data set with edge dates (midnight, month end). Integration: all revenue endpoints agree. E2E: Finance overview tile shows 92,000.

### F-901: Paid digital orders count as revenue (D8); summary includes digital revenue and Paystack fees
- Priority: P0. Milestone: M1.
- Description: Decision D8 says a paid digital order counts as delivered revenue. A free bundled digital item does not. Today `getFinancialSummary` reads only account 4010 and leaves out 4020 (digital revenue) and 5060 (Paystack fees). This was a GUESS in the design doc (section 9 item 14). The code check on 2026-10-18 confirms it: the revenue list holds only `PRODUCT_REVENUE`, and the expense list does not hold `PAYSTACK_FEES`.
- Current app: `financialService.getFinancialSummary` (lines 130 to 235). `paystackSettlementService.settlePaystackPayment` sets status `digital_delivered` and posts the digital sale (`createDigitalSaleEntry`). Analytics whitelist `delivered` only.
- Mockup: not in mockup. The Overview tile "Delivered revenue" includes the digital line; Profit by product shows "Guide GH₵3,400" (58 orders).
- Acceptance criteria:
  - [ ] An order counts as delivered revenue if `status = delivered`, or if `status = digital_delivered` and `paymentStatus = paid` and `totalAmount > 0`.
  - [ ] An order whose total is 0 (a free bundled digital item) adds 0 to revenue and is not counted as a delivered order in any rate.
  - [ ] A digital line inside a physical order (a bundled guide) is part of that order's `totalAmount` and is dated by the physical delivery. It is not counted twice.
  - [ ] `deliveryDate` of a paid digital order = payment time. The backfill sets it for old `digital_delivered` rows.
  - [ ] Revenue includes accounts 4010 and 4020 together. The UI shows a "of which digital" line.
  - [ ] Expenses include account 5060 (Paystack fees).
  - [ ] The KPI service returns `{ physical, digital, total }` and the three agree with the ledger (F-905).
- Data: backfill `Order.deliveryDate` for `digital_delivered` orders from the Paystack settle time. API: `GET /api/financial/summary` adds `digitalRevenue`, `paystackFees`.
- Permissions: `financial:view`.
- Edge cases and errors: A refunded digital order (no refund flow exists today) is out of scope; note it as a gap in the health check output. Paystack fee unknown at settle time posts 0 and the Paystack payout posting (F-934) corrects it.
- Tests: Unit: three order types (physical delivered, digital paid, free bundle). Integration: summary equals ledger for 4010 plus 4020.

### F-902: Finance overview KPI tiles
- Priority: P0. Milestone: M5.
- Description: The Overview opens with six tiles, a payout reconciliation table, unpaid delivered orders by age, the October cohort card, cost of failed deliveries and the monthly P&L. Each tile has one formula from the KPI dictionary. The tile "Delivered revenue" also shows the computed AOV (decision S2): delivered revenue divided by delivered orders.
- Current app: `FinancialDashboard.tsx` shows Total Revenue, Net Profit, Outstanding Receivables, Total Expenses, Pipeline Revenue.
- Mockup: `finance.html#t-overview`.
- Acceptance criteria:
  - [ ] Tile 1 "Delivered revenue (Oct)": GH₵92k, target GH₵180k, tag "Off track". Sub-line "AOV GH₵245" (92,000 / 376 = 244.68, shown as 245).
  - [ ] Tile 2 "Cash received": GH₵68.6k = sum of verified deposits and settlement payouts dated in the month; sub-line "75% of delivered revenue".
  - [ ] Tile 3 "Cash outstanding": GH₵23.4k = balance of account 1015 for delivered orders; sub-line "38 orders over 8 days" (count of unpaid delivered orders older than 8 days).
  - [ ] Tile 4 "Net margin (Oct)": -16% (-15.5%), target 35%, "loss GH₵14.3k". Formula: (revenue - product cost - delivery fees - rep commission and rewards - ad spend - other expenses) / revenue. October margin is about -16 percent once the commission line is in (formula wins, R1; decision R6); updated 2026-10-19. Rep commission and rewards (GH₵2,768 in October = commission 2,128 + upsell reward 640, account 5050) is its own line.
  - [ ] Tile 5 "Profit per delivered order": -GH₵38 overall (after rep commission); sub-line "copybook -GH₵57" (before rep commission) (by product, F-924).
  - [ ] Tile 6 "Cash runway": 9 days (F-927).
  - [ ] A tile never shows "26%" or "delivery rate". No tile for pipeline revenue (FI-03 is dropped).
  - [ ] Each tile has a date basis label in its tooltip: "by delivery date" or "by payment date".
  - [ ] The date range control "This month" works (it is dead in the mockup).
- Data: none new. API: `GET /api/financial/overview?from&to` returns the six tiles in one call.
- Permissions: `financial:view`. Delivery agent and call rep do not see Finance.
- Edge cases and errors: Month with no delivered orders shows "n/a" for AOV and margin, not NaN. A tile that fails to load shows an error state, the others still load.
- Tests: Unit: each tile function. Integration: overview matches NUMBERS.md fixture. E2E: tile text on the Overview.

### F-903: Chart of accounts: live codes, new accounts, per-tenant seed
- Priority: P0. Milestone: M0 (seed and tenant), M5 (new accounts).
- Description: Use the live codes in all UI, exports, design text and MCP output (section 4 item E1). Add the new accounts in section 2.1 (2040, 2050, 3010, 5070, 5080). Seed the chart for each tenant. Today the startup seed runs without a tenant, so the rows have `tenant_id = NULL` and the tenant filter hides them (design section 9 item 7). `Account.code` and `JournalEntry.entryNumber` are unique per tenant.
- Current app: `glAutomationService.asyncVerifyGLAccounts` (16 system accounts, no tenant), `Account.code @unique`.
- Mockup: `finance.html#t-accounting` account pick list (wrong codes).
- Acceptance criteria:
  - [ ] Every account list, journal-entry modal, ledger header and CSV shows live codes. The mockup HTML is relabelled in the same change that builds the page.
  - [ ] The new accounts (2040, 2050, 3010, 5070, 5080) exist for the owner tenant after migration, with `isSystem = true`.
  - [ ] A new tenant gets the full chart on creation. Two tenants can both hold code 1010.
  - [ ] Old rows with `tenant_id = NULL` are backfilled to the owner tenant. A check fails the deploy if a `NULL` account row remains.
  - [ ] The server no longer exits at startup if seeding fails for one tenant; it logs and the health check (F-931) reports it.
  - [ ] Account 3010 appears on the balance sheet (F-922).
- Data: `Account` unique (`tenantId`, `code`). `JournalEntry` unique (`tenantId`, `entryNumber`). Migration seeds 2040, 2050, 3010, 5070, 5080. API: `GET /api/gl/accounts` unchanged shape.
- Permissions: `gl:view` to list. `gl:create` to add an account (Owner and Finance clerk).
- Edge cases and errors: If production already has a manual account with one of the new codes, the migration stops and lists the clash. Check production before M5 (GUESS: no clash; the code lists only the 16 seeded accounts).
- Tests: Integration: two-tenant seed and unique codes. Unit: map of mockup codes to live codes.

### F-904: Fix the cash chain: 1015 versus 1020
- Priority: P0. Milestone: M5.
- Description: The live rules post cash twice. A delivery debits 1015. A verified collection debits 1010 and credits 1015. A verified deposit debits 1010 again and credits 1020. Account 1020 is never debited, so it goes negative, and 1010 grows by the same cash twice. Fix: one account (1015) holds cash held by partners. Cash reaches 1010 once, when a deposit is verified or a settlement line matches. Verifying a collection posts nothing. The amount a partner hands in is cash collected minus the delivery fees it kept (decision F4), and 1015 already holds that net amount.
- Current app: `glAutomationService` (collection verified lines 715; deposit verified line 899; legacy deposit line 839). `agentReconciliationService.verifyCollection`, `verifyDeposit`.
- Mockup: not in mockup. `finance.html` balance sheet shows "cash with partners 23,400".
- Acceptance criteria:
  - [ ] Delivery posts DR 1015 and CR 4010 as in section 2.2. Nothing posts to 1020.
  - [ ] Verifying a deposit posts DR 1010, CR 1015 for the amount matched (FIFO) and CR 2040 for any excess.
  - [ ] The legacy "mark COD deposited" route (`POST /api/financial/collections/deposit`) posts the same entry. The route stays for now but calls the same service.
  - [ ] Verifying a single collection changes its status and posts no journal entry.
  - [ ] One-time backfill: one adjusting entry moves the 1020 balance to 1010 or 1015 so that 1020 is 0. The entry date is the migration date. P&L accounts are not touched. Aug and Sep P&L stay as booked (D5).
  - [ ] After the backfill, balance of 1015 equals the sum of unreconciled `AgentCollection.amount` (health check in F-931).
  - [ ] Account 1020 is set inactive after the backfill.
- Data: none new. API: no change to paths. Posting rules change in `glAutomationService`.
- Permissions: posting is a system action. The backfill script runs by Owner only.
- Edge cases and errors: A deposit larger than the unreconciled collections of that partner posts the excess to 2040 and raises a Finding (F-909). A deposit rejected after posting is voided with a reversal entry.
- Tests: Unit: posting lines for deposit, excess and reversal. Integration: deliver 3 orders, verify one deposit, 1015 and 1010 are right and 1020 is 0. Script test on a copy of production data.

### F-905: Revenue entry date and the nightly order-versus-ledger check
- Priority: P0. Milestone: M1.
- Description: The design doc flagged as GUESS that account 4010 may post with the wrong date. The code check shows the physical delivery entry uses `order.deliveryDate || new Date()` (`glAutomationService.ts` line 388), which is correct. Other entries use `new Date()` or `order.updatedAt` (return reversal, line 604). The rule: revenue entries use the delivery date, a return reversal uses the return date, failed-delivery entries use the close date. A nightly job compares delivered revenue from orders with the ledger for each day and opens a Finding on any difference.
- Current app: `glAutomationService` lines 388, 454, 604. No nightly compare exists (`glAccountService.verifyAllAccountBalances` checks balances only).
- Mockup: not in mockup (card "Findings", F-909).
- Acceptance criteria:
  - [ ] `entryDate` for the order_delivery entry always equals `Order.deliveryDate` (never "now") when `deliveryDate` is set. If an MCP or 3PL status update sets a back date, the entry uses that date.
  - [ ] The return entry uses `returnedAt` (new field on `Order`, from `OrderHistory`) and not `updatedAt`.
  - [ ] The nightly job at 02:00 Accra time sums order revenue per day and 4010 plus 4020 credits per day for the last 45 days. A day with a difference above GH₵0.01 creates one open Finding of type `ledger_gap`.
  - [ ] The job runs for each tenant with its own context.
  - [ ] On the fixture the job creates no Finding.
- Data: `Order.returnedAt` (DateTime, nullable), backfilled from `OrderHistory`. `Finding.type` gets the value `ledger_gap`. API: `GET /api/financial/health` includes the last run time and open gaps.
- Permissions: Finding list per F-909.
- Edge cases and errors: Voided entries are ignored. A day with a manual journal entry to 4010 shows a gap by design; the Finding offers "Explain" (status `explained`).
- Tests: Unit: date selection. Integration: back-dated delivery posts on the back date. Job test with one planted gap.

### F-906: Record partner payout: model, matching, auto-reconcile (generic; decisions 7, O1)
- Priority: P0. Milestone: M5.
- Description: A 3PL pays one lump sum equal to the cash it collected minus its charges (sample: Logiswift, which charges nothing on failed or returned orders). Agents run partner syncs outside the app, on a schedule (decision O1). The app has ONE generic action, "record partner payout", as an API route and an MCP tool. Any agent can call it for any delivery partner. There is no Logiswift-specific endpoint, payload or code. The caller sends the paid-order list and the payout. The app creates a `PartnerSettlement` with lines, matches each line to an order and its `AgentCollection`, moves matched collections to `reconciled`, records one `AgentDeposit` for the lump sum and trues up the delivery fee per order. The payout is matched against the net amount (cash collected minus fees, decision F4). No hand step is needed.
- Current app: none. The 1,321 draft collections of the main 3PL are all in `draft` (design section 9 item 10).
- Mockup: `finance.html#t-overview` payout reconciliation table.
- Acceptance criteria:
  - [ ] `POST /api/partner-settlements` accepts `{ partnerId, payoutDate, payoutAmount, reference, lines: [{ externalOrderRef, orderId?, expAmount, charge }] }`. The MCP tool `partner_payout_record` takes the same input. The caller is an outside agent with an API or MCP key that holds the payout permission (decision O7). The call is idempotent on (`partnerId`, `reference`).
  - [ ] Each line matches an order by `orderId`; if absent, by order number in `externalOrderRef`; if absent, by customer phone and amount (GUESS: check how the outside agent keys its rows; the CodAdmin order id is the safest key).
  - [ ] Expected net of a line = `expAmount - charge`. Expected payout = sum of expected net of matched lines.
  - [ ] Matched, delivered orders with an `AgentCollection` move to `reconciled`. `Order.paymentStatus` becomes `reconciled`.
  - [ ] Posting follows section 2.2: DR 1010 payout received, DR/CR 5070 for the difference between the real charge and the delivery fee already booked at delivery, CR 1015 for the net cleared.
  - [ ] One `AgentDeposit` (status `verified`, method `partner_payout`) is created and linked to the settlement.
  - [ ] Status of the settlement: `matched` (payout equals expected, all lines matched), `short` (payout less than expected), `over` (payout more than expected), `unmatched` (one or more lines match no order).
  - [ ] A `short`, `over` or `unmatched` settlement opens a Finding of type `short_pay` with the amount (F-909).
  - [ ] A line for an order that is not delivered (for example still `out_for_delivery`) is `unmatched` and not reconciled.
  - [ ] The backfill of the 1,321 draft collections uses app data only (collections, orders and deposits already recorded). It needs no portal export and no outside file. Then it recomputes the aging (F-911). After it, the aging shows true unpaid orders only.
  - [ ] The app shows no sync button, no sync status and no "last run" text (design rule).
- Data: `PartnerSettlement` (id, tenantId, partnerId, payoutDate, payoutAmount Decimal, reference, expectedNet Decimal, shortAmount Decimal, status, depositId, createdAt). `PartnerSettlementLine` (id, settlementId, orderId nullable, externalOrderRef, expAmount, charge, outcome, matched Boolean). `AgentCollection.settlementLineId`, `AgentDeposit.settlementId`. All have `tenantId` and are in the scoped list. API: `POST /api/partner-settlements`, `GET /api/partner-settlements?partnerId&from&to`, `GET /api/partner-settlements/:id`.
- Permissions: record by an API or MCP key with the payout permission. View by `financial:view`.
- Edge cases and errors: Same reference sent twice returns the first result. A line with a negative charge is rejected. A payout with a currency other than the tenant currency is rejected. If the sum of line charges differs from the fee rules by more than 5 percent, the settlement is marked for review (GUESS: the 5 percent limit is a placeholder; owner sets it).
- Tests: Unit: matching order (id, number, phone+amount). Unit: status rules (matched, short, over, unmatched). Integration: 41-line settlement with 3 missing lines; collections and ledger are right. Idempotency test. Backfill test on a copy of production data.

### F-907: Payout reconciliation table (Overview)
- Priority: P1. Milestone: M5.
- Description: The Overview table lists each partner payout with the date, partner, amount paid, the order list value and the result (Matched or Short). A short row expands to list the unpaid orders. The user can send the list to the partner or mark the money as received.
- Current app: none.
- Mockup: `finance.html#t-overview` table "Payout reconciliation".
- Acceptance criteria:
  - [ ] Columns: Date, Paid by, Paid, Order list, Result. Rows come from `PartnerSettlement`.
  - [ ] Result is "Matched" or "Short GH₵N". "Short" is `expected net - payout`.
  - [ ] The button "Show the N orders" lists the unpaid orders with the real order id, customer and amount. The sum of these amounts equals the short amount. (Section 4 item 15: the mockup uses GH₵280 for each order; the real amounts are used.)
  - [ ] "Send to <partner>" opens a pre-filled WhatsApp or email message to the partner contact with the order list. A person sends it. It does not send by itself (G10).
  - [ ] "Mark as received" opens the partner payout form (F-908) with the order list pre-selected.
  - [ ] The three agent cards on this page (Logiswift paid GH₵840 less; 38 orders unpaid; "At 60% success October would be about GH₵1,900 profit") read from the KPI services and open a screen. They do not write.
  - [ ] The agent-card text "38 orders unpaid after 8 days, all Logiswift, GH₵17.3k" is computed. In the sample, 38 orders over 8 days are worth GH₵9,100 and GH₵17.3k is all cash Logiswift holds. The card shows two separate figures (see Q-F4).
- Data: none new. API: `GET /api/financial/payout-reconciliation?from&to`.
- Permissions: `financial:view`; send and mark need `financial:update`.
- Edge cases and errors: A settlement with no lines shows "No order list" and a Finding. Over-paid settlements show "Over GH₵N".
- Tests: Integration: table rows and short amount for the 11 Oct fixture. E2E: expand and mark received.

### F-908: Record partner payout (manual)
- Priority: P1. Milestone: M5.
- Description: Money from a partner can arrive with no paid-order list from an outside agent (own agents, trial 3PL). A manual form records it and matches it to the oldest unpaid orders of that partner (FIFO). It is the manual path to F-906.
- Current app: `POST /api/financial/collections/deposit` (legacy mark deposited) and agent `POST /api/agent-reconciliation/deposits` (agent submits, finance verifies).
- Mockup: `finance.html` modal "Record partner payout": Paid by, Amount, Date, Reference or receipt; note "matched to the oldest unpaid orders".
- Acceptance criteria:
  - [ ] Fields: Paid by (partner list), Amount (GH₵), Date, Reference (required, unique per partner), Receipt (optional file).
  - [ ] The form shows a live preview: orders that the amount will clear (FIFO), amount left over, orders left unpaid.
  - [ ] Save creates a `PartnerSettlement` of source `manual` and a verified `AgentDeposit`, with the same postings as F-906.
  - [ ] Reference unique rule uses the existing unique reference check; a duplicate shows "This reference was used on <date>".
  - [ ] The command palette action "Record a 3PL payout" opens this form (SH-16).
- Data: `PartnerSettlement.source` (`api`, `manual`). API: `POST /api/partner-settlements/manual`.
- Permissions: Owner, Finance clerk, Admin, Manager (`financial:update`).
- Edge cases and errors: Amount 0 or negative is rejected. Amount above the unpaid total posts the excess to 2040 and warns "GH₵N will be held as unapplied". Partner with no unpaid orders: the whole amount is unapplied.
- Tests: Unit: FIFO split. Integration: form posts and the aging changes. E2E: record a payout from the palette.

### F-909: Findings list
- Priority: P1. Milestone: M5.
- Description: Fraud work is matching (design decision 9). Each failed match opens a Finding. The design has a `Finding` model but no list screen exists in the mockups. Finance needs a list to work through. Build a "Findings" card on Finance Overview and a full list at `/finance/findings`.
- Current app: none.
- Mockup: not in mockup (the Overview agent cards show the same cases). Build in the v2 style: a table card with filter tabs All, Open, Explained, Written off.
- Acceptance criteria:
  - [ ] Columns: Date, Type, Subject (partner, user, location or order), Amount, Status, Assigned to, Action.
  - [ ] Types created by Finance: `short_pay`, `cash_gap` (delivered by agent minus deposited by agent), `unpaid_after_term` (delivered, no deposit after the partner's days to pay), `ledger_gap` (F-905). Other types (stock gap, repeat refuser) are created by their own areas and show in the same list.
  - [ ] Status changes: Open to Explained (note required) or Written off (note required, Owner only). A written-off amount posts DR 5100 and CR 1015 or 2040.
  - [ ] A Finding can be assigned to a user and creates an inbox item for that user (F-550 range, Builder B1).
  - [ ] "Cash gap" for a partner = unreconciled collections older than the days to pay. The days to pay come from the partner (F-1229 default, partner value in Deliveries).
  - [ ] The job that creates Findings does not create a duplicate for the same (type, subject, period).
- Data: `Finding` (id, tenantId, type, subjectType, subjectId, amount Decimal, status, assigneeId, note, createdAt, resolvedAt). API: `GET /api/findings`, `PATCH /api/findings/:id`.
- Permissions: view `financial:view`; change status `financial:update`; write off Owner only.
- Edge cases and errors: A Finding whose cause is later fixed (a late payout) closes itself with status `explained` and note "Cleared by settlement <ref>".
- Tests: Unit: duplicate guard. Integration: short settlement creates a Finding; late payout closes it.

### F-910: Unpaid delivered orders by age
- Priority: P1. Milestone: M5.
- Description: A card lists delivered orders that have no deposit, in four age buckets: 0-3, 4-7, 8-14 and 15+ days since delivery. It uses the real reconcile state, so after F-906 the numbers are true. Old buckets (0-1, 2-3, 4-7, 8+) are replaced.
- Current app: `agingService` buckets 0-1, 2-3, 4-7, 8+ from `collectionDate`; frontend shows 0-3, 4-7, 8+.
- Mockup: `finance.html#t-overview` card "Unpaid delivered orders".
- Acceptance criteria:
  - [ ] Buckets: 0-3 days 31 orders GH₵8,100; 4-7 days 25, GH₵6,200; 8-14 days 26, GH₵6,600; 15+ days 12, GH₵2,500; total 94 orders, GH₵23,400 (fixture).
  - [ ] Age = days from `deliveryDate` to today in the tenant time zone.
  - [ ] Population = delivered orders whose `AgentCollection` is not `reconciled`, orders not deleted.
  - [ ] Click on a bucket opens the Orders list with the filter "Unpaid by agent" and the bucket (OR-23, Builder B1).
  - [ ] Header text: "3PLs and agents owe you GH₵23.4k" is computed.
- Data: `AgentAgingBucket` gets `tenantId` and the 8-14 and 15+ columns. API: `GET /api/financial/unpaid-by-age`.
- Permissions: `financial:view`.
- Edge cases and errors: Orders delivered today count in 0-3. Amount is the net due (after expected fee), not the order total; the label says "net of delivery fee".
- Tests: Unit: bucket edges at 3, 4, 7, 8, 14, 15 days. Integration: totals match fixture.

### F-911: Agent aging, cash exposure, reminders, block and unblock
- Priority: P1. Milestone: M5.
- Description: The Agent collections tab shows cash held by each partner by age, the oldest unpaid order and status. Finance can send a reminder, block a partner from new assignments or unblock. The aging refresh is per tenant (today `agingService.refreshAll` runs `deleteMany({})` for all tenants).
- Current app: `AgentCollections.tsx`, `agingService`, `POST /api/agent-reconciliation/agents/:id/block|unblock`, `GET /api/financial/agent-aging`.
- Mockup: `finance.html#t-collections` KPI tiles, card "Cash exposure by partner", table "Agent aging".
- Acceptance criteria:
  - [ ] KPI tiles: Cash with agents and 3PLs GH₵23.4k (94 orders); Overdue 8 days or more GH₵9,100 (38 orders); Collections to verify 4 (GH₵14,860); Blocked from deliveries 0.
  - [ ] Table columns: Partner, Cash held, 0-3, 4-7, 8-14, 15+, Oldest, Status, Actions. Switch "Show overdue only (8 days or more)". Export CSV.
  - [ ] "Overdue" for a partner uses that partner's days to pay (F-1229, partner value) and falls back to 8 days.
  - [ ] "Send reminder" opens a pre-filled WhatsApp message; a person sends it (G10).
  - [ ] Block and Unblock change status and the blocked count. A blocked partner gets no new assignment (existing rule).
  - [ ] `agingService.refreshAll` becomes `refreshTenant(tenantId)`; it never deletes rows of another tenant (section 3 item 34).
  - [ ] Agent card "Logiswift owes GH₵17,300" and the share "Logiswift holds 74% of the cash" are computed.
- Data: `AgentAgingBucket.tenantId`. API: `GET /api/financial/agent-aging` adds the new buckets; `GET /api/financial/agent-aging/export/csv` keeps its path.
- Permissions: view `financial:view`; block and unblock Owner, Admin, Manager (as today).
- Edge cases and errors: A blocked partner with open deliveries keeps them. Unblock needs no reason. Refresh failure for one tenant does not stop the others.
- Tests: Integration: two-tenant refresh leaves the other tenant intact. Unit: overdue by partner term.

### F-912: Collections to verify; review modal; no separate approve step
- Priority: P1. Milestone: M5.
- Description: Partners (mainly agents) submit deposits with a receipt. Finance reviews each row, then verifies and reconciles in one step or rejects with a reason. The manual "approve" step has no mockup and the settlement removes the need for it. The status path becomes `draft` to `reconciled`. The values `verified`, `approved` and `deposited` stay in the enum for old rows only.
- Current app: `CollectionActionModal`, `POST /api/agent-reconciliation/:id/verify`, `/approve`, `/bulk-verify`, `/deposits/:id/verify|reject`, `/deposits/bulk-verify` (max 50).
- Mockup: `finance.html#t-collections` table "Collections to verify" and the "Review collection" modal.
- Acceptance criteria:
  - [ ] Table columns: Date, From, Orders, Amount, Receipt (file type chip or "No receipt"), Status (Pending, Verified, Rejected plus reason), Action.
  - [ ] The review modal shows the receipt, partner, date, order count, amount, the order list and any short amount.
  - [ ] Reject reasons: Amount does not match the order list; Receipt is unclear or edited; No receipt attached; Payment not found in MoMo or bank; Other. A note to the partner is optional. A reason is required.
  - [ ] "Verify and reconcile" runs F-904 posting and reconciles the matched collections (FIFO). "Reconcile selected" does the same for ticked rows (max 50).
  - [ ] "Ask for receipt" opens a pre-filled message. A person sends it.
  - [ ] The deposit form in the agent app keeps the reference number field (agent app, F-800 range, Builder B2).
  - [ ] The routes `/approve` and the "approve" button are removed.
- Data: `AgentDeposit.tenantId`, `rejectReason`. API: `POST /api/agent-reconciliation/deposits/:id/verify` (now reconciles), `/reject` (reason required). `/approve` is removed.
- Permissions: Owner and Finance clerk (as today: `sa`, `ac`).
- Edge cases and errors: Verify when partner balance is lower than the amount fails with a clear message and opens a Finding (existing rule, kept). Two people verify the same row at once: the second gets "Already verified".
- Tests: Integration: verify, reject, bulk verify, duplicate verify. E2E: review modal flow.

### F-913: One payout form (money out to people)
- Priority: P0. Milestone: M5.
- Description: The mockup records payouts in two places with two histories (Finance rep commissions and Staff pay). Build one payout record, one form and one history. Finance and Staff both open the same form. The form pays a call rep (commission, upsell reward, target reward) or a delivery agent (target reward only). It never pays a delivery fee: the partner keeps the fee from the cash it collects (decision F4). AI agents and companies get no payout and do not appear in the person list.
- Current app: `RepPayoutModal` (pick delivered orders), `payoutService.processPayout`, `Payout` (rep only, `Float`), `POST /api/users/reps/:id/process-payout`.
- Mockup: `finance.html` "Record rep payout" modal; `staff.html` "Record payout" modal (Pay select, preview, Amount, Method, Notes).
- Acceptance criteria:
  - [ ] Fields: Pay (person), a preview (rate, delivered orders, commission, upsell reward, target reward, earned, already paid, owed now), Amount (default = owed now), Method (MoMo, Bank transfer, Cash), Date, Reference, Note.
  - [ ] The preview reads open `CommissionEntry` rows. The person can untick single entries (the "pick delivered orders to pay" view, ST-13, kept as an expandable list). The amount follows the ticked entries.
  - [ ] Save creates one `Payout` and links the paid `CommissionEntry` rows. Entries move from `earned` to `paid`. Posting: DR 2020, CR 1010.
  - [ ] Partial payment: an amount below owed pays the oldest entries first. The last entry may be split. The rest stays `earned`.
  - [ ] The form from Finance and from Staff gives the same history list. The history shows date, person, amount, method, note, recorded by.
  - [ ] No checkbox "Also pay target reward (GH₵100 airtime)". Target reward is its own entry (kind `reward`) in cash only (D9). Remove all airtime wording.
  - [ ] The form shows "Posts to 2020 Commissions payable". No delivery fee line appears in the form.
  - [ ] Example from NUMBERS.md: Adwoa owed 2,024 + 610 - 600 = GH₵2,034; Nana owed 104 + 30 = GH₵134. The delivery agents in the old sample (Kwesi 312, Kofi 184, Esi 80) are removed: they keep their fees from cash (decision F4).
- Data: `Payout` becomes: payeeId (was repId), kind (`rep`, `agent`; a payout to a delivery agent is a target reward only), amount Decimal, method, reference, note, recordedById, payoutDate, tenantId. `CommissionEntry.payoutId`. Old `Payout.repId` is migrated to `payeeId`. API: `POST /api/payouts`, `GET /api/payouts?payeeId`, `GET /api/payouts/owed?payeeId`. The old `POST /api/users/reps/:id/process-payout` calls the new service until the frontend moves.
- Permissions: Owner, Admin, Manager, Finance clerk record. Each person sees only their own payouts in their own app.
- Edge cases and errors: Amount above owed is rejected ("Owed is GH₵N"). A payee with no open entries shows owed 0 and the form cannot save. Two payouts on the same entries at once: the second fails with "Already paid". Reference unique per payee and method.
- Tests: Unit: partial payout split. Integration: posting and entry state. E2E: record from Finance, see it in Staff history.

### F-914: Rep commission payable and the Rep commissions tab
- Priority: P0. Milestone: M5 (posting) and M7 (entry creation).
- Description: A rep earns GH₵8 for each order they confirm by call that is delivered (decision 5, P6) and 10 percent of the extra value they added, paid on delivery. An order that auto-confirm confirmed (customer replied YES) earns no commission (P6). Both accrue to account 2020 when the order is delivered. `CommissionEntry` is the pay ledger. It replaces `User.commissionAmount` and `Order.commissionPaid`. The Rep commissions tab shows what is owed. AI agents earn nothing and show "No payout for AI agents".
- Current app: `User.commissionAmount` (Float), `Order.commissionPaid`, delivery entry credits 2020 with `commissionAmount`.
- Mockup: `finance.html#t-commissions` KPI tiles, table, payout history.
- Acceptance criteria:
  - [ ] When an order moves to `delivered`, the system creates `CommissionEntry` rows: kind `base` GH₵8 and kind `upsell` 10 percent of the extra value (from `UpsellLine`, Builder B1/B2 rep area), for the rep who confirmed it by call. Status `earned`. An auto-confirmed order creates no entry (P6). The rate comes from Settings, Rewards (F-1231).
  - [ ] Delivered posting: DR 5050, CR 2020 for the sum of the entries.
  - [ ] A returned order voids its entries and posts the reversal.
  - [ ] An AI agent holder gets entries with status `no_payout` (zero amount, kept for scoring only).
  - [ ] KPI tiles: Commission owed GH₵2,168 (2 reps, account 2020); Paid this month GH₵1,440 (1 and 9 Oct payouts); Per delivered confirmed order GH₵8 plus 10 percent upsell reward; Target rewards earned (cash only; see F-916).
  - [ ] Table columns: Rep, Delivered, Commission, Upsell reward, Earned, Paid in month, Owed, Target reward, Last payout, Action "Record payout" (opens F-913).
  - [ ] Fixture: Adwoa 253 delivered, 2,024 + 610 = 2,634 earned, 600 paid, owed 2,034. Nana 13, 104 + 30 = 134, owed 134. Sum owed 2,168 equals the balance of 2020.
  - [ ] The balance of 2020 equals the sum of open entries (health check F-931).
- Data: `CommissionEntry` (id, tenantId, orderId, userId, kind `base|upsell|reward`, amount Decimal, status `pending|earned|paid|void|no_payout`, earnedAt, payoutId). Migration: open `Order.commissionPaid = false` delivered orders become `earned` entries at the user's old `commissionAmount` (kept for history). API: `GET /api/commissions?userId&status`.
- Permissions: `financial:view`; record payout per F-913.
- Edge cases and errors: An order delivered with no confirming rep (self-service form, or auto-confirmed, P6) creates no entry. A rep changed after confirmation: the confirming rep is paid. Order delivered twice (status loop) creates entries once (idempotent on orderId + kind).
- Tests: Unit: entry rules (rep, AI agent, return). Integration: delivered posting and balance. Fixture test for the Oct numbers.

### F-915: Delivery-agent pay payable on delivery. Removed (decision F1)
- Status: Removed (decision F1). There is no "agent pay", no agent pay payable and no `agent_pay` commission entry. The F-ID stays so that references resolve.
- What replaces it: the delivery fee (decisions F1 to F4). One fee rule per partner, booked once as a delivery fee expense (F-936), kept by the partner from the cash it collects. The old sample (Kofi GH₵12, Esi GH₵10, Kwesi GH₵12 per delivery) is removed. Kofi's fee rule is GH₵25 per delivered order (decision F2).
- Acceptance criteria:
  - [ ] No account 2030 "Pay-per-delivery payable" exists. No `CommissionEntry` of kind `pay_per_delivery` exists. `User.deliveryRate` is removed and not replaced by a pay-rate field.
  - [ ] Delivery posting stops netting agent commission against cash in transit and stops posting to 5040. The delivery fee goes to 5070 (F-936).
  - [ ] No screen uses old pay-per-delivery wording or "agent fee". The only term is "delivery fee".
  - [ ] Backfill: none. Aug and Sep stay as booked (D5). Orders delivered in October keep their booked entries; the delivery fee is posted for them by the one-time fee backfill in F-936.

### F-916: Month close and rewards posted (G4)
- Priority: P1. Milestone: M6.
- Description: A target reward is earned at month close on delivery-date numbers (G4). Month close is a job on the first day of the next month. It freezes attainment, creates reward entries and posts them. This file defines the accounting side. F-1110 defines attainment and tiers.
- Current app: none. The enum `period_close` exists and nothing uses it. No `AccountingPeriod`.
- Mockup: `finance.html#t-commissions` KPI "Target rewards earned"; payout form.
- Acceptance criteria:
  - [ ] On day 1 at 03:00 Accra time the job runs for the month that ended. It reads each role holder's attainment from the KPI service (delivery-date basis).
  - [ ] For each human holder at 100 percent or more it creates a `CommissionEntry` of kind `reward` with the cash amount from Settings, Rewards (call rep 100 percent GH₵300, 120 percent GH₵500; delivery 100 percent GH₵250, 120 percent GH₵400). The paid day off is a note on the entry, not money.
  - [ ] Posting: DR 5050 (rep or delivery agent), CR 2020, dated the last day of the month.
  - [ ] AI agents and companies get no entry (D9: no payout).
  - [ ] No airtime tier exists. No entry is created at 80 percent.
  - [ ] The job is idempotent per (user, month). Re-run does not duplicate.
  - [ ] A late return after close does not take back an earned reward. A note on the Finance health page lists such cases (GUESS: the owner may want a clawback; not decided).
  - [ ] The owner can run the job by hand for a month (button on the Rewards tab) and see a preview first.
- Data: `Target` closing flag `closedAt`. `CommissionEntry.kind = reward`. API: `POST /api/period-close/:yyyy-mm/preview`, `POST /api/period-close/:yyyy-mm`.
- Permissions: Owner only to run by hand. Job runs as the system user (per tenant, section 3 item 33).
- Edge cases and errors: A role with no target for the month creates no rewards. A month with a missing KPI (service error) stops and raises a Finding; it does not pay on partial data.
- Tests: Unit: tier pick at 99.9, 100, 119.9, 120 percent. Integration: close September on a fixture and check entries and 2020.

### F-917: Expenses: add, edit, delete, search, breakdown
- Priority: P1. Milestone: M5.
- Description: Keep expense management and restyle it. Add the field "Paid from". Delete and edit must reverse or replace the ledger entry. Section 3 item 48 says the delete may not reverse the entry. The route has a GUESS note (`DELETE /expenses/:id` GL reversal assumed). Test it. Fix it.
- Current app: `ExpenseManagement` in `pages/financial`, `POST/PUT/DELETE /api/financial/expenses`, `GET /expenses/breakdown`.
- Mockup: `finance.html#t-accounting` sub-tab Expenses; "Add expense" modal.
- Acceptance criteria:
  - [ ] Table columns: Date, Category, Description, Paid from, Amount, Receipt, Actions (edit, delete). Search box works on description and category. Category bars show the breakdown for the range.
  - [ ] Modal fields: Date, Amount (GH₵), Category, Paid from (MoMo, Bank, Cash), Description, Receipt (F-919). Footer note: "Posts to account 5100 Operating expenses".
  - [ ] Add posts DR 5100, CR 1010 dated `expenseDate`.
  - [ ] Edit of amount or date voids the old entry and posts a new one (reversal link kept).
  - [ ] Delete voids the entry (reversal). A test fails if the account balance does not return to the earlier value.
  - [ ] Expenses created by Meta pull or delivery fee have `source` `meta` or `delivery_fee` and cannot be edited or deleted by hand (read-only row with a lock icon).
  - [ ] The sample total GH₵3,100 over 7 expenses sums from the rows.
- Data: `Expense.source` (`manual`, `meta`, `delivery_fee`, `ai`), `Expense.paidFrom`, `Expense.journalEntryId`, `Expense.amount` Decimal (F-932). API: existing paths plus `paidFrom` and `source`.
- Permissions: create `financial:create` (Owner, Admin, Finance clerk, delivery agent as today: `financial:create` is in the agent default; keep, but an agent sees only their own rows). Delete and edit: Owner, Admin, Finance clerk.
- Edge cases and errors: Expense dated in a closed month (after month close) is allowed and shows a notice "This month is closed; the P&L changes". Negative amount rejected. Receipt upload failure keeps the expense and shows a retry.
- Tests: Integration: add, edit, delete and ledger balance. Unit: category sums.

### F-918: Expense categories and migration
- Priority: P2. Milestone: M5.
- Description: The mockup uses eight categories. The app uses seven. Use one list. The list must not hold "Airtime and rewards" (D9, section 4 item 1). Target rewards are not expenses entered by hand; they come from the payout form.
- Current app: COGS, Delivery, Marketing, Operations, Salaries, Utilities, Other.
- Mockup: Packaging, Software, Office and internet, Transport, Airtime and rewards, Photography, Bank charges, Other.
- Acceptance criteria:
  - [ ] New list: Packaging, Software, Office and internet, Transport, Photography, Bank charges, Salaries, Marketing (not Meta), Other.
  - [ ] Old to new: COGS to Packaging (GUESS: check old COGS rows first; if they are product purchases, they already post through shipments and need a manual look), Delivery to Transport, Marketing to Marketing (not Meta), Operations to Other, Salaries to Salaries, Utilities to Office and internet, Other to Other.
  - [ ] The migration prints a count per old category and the owner reviews it before it runs.
  - [ ] The mockup category "Airtime and rewards" and the sample expense "Call rep airtime reward, September GH₵500" are removed from sample data.
  - [ ] Category is a controlled list stored per tenant, not free text.
- Data: `ExpenseCategory` list in `SystemConfig` (JSON) or a table (GUESS: JSON is enough). API: `GET /api/financial/expense-categories`.
- Permissions: the list is read by anyone who can add an expense; edit by Owner.
- Edge cases and errors: An expense with an unknown old category maps to Other and is listed in the migration log.
- Tests: Unit: map function. Migration test on a copy of production data.

### F-919: Expense receipts: upload and view
- Priority: P2. Milestone: M5.
- Description: The current app has a receipt column. The mockup dropped it. Keep it. A receipt is an image or PDF stored on R2 through the existing upload service.
- Current app: `Expense.receiptUrl`, `/api/upload` (images only, 15 MB).
- Mockup: not in mockup. Build in the v2 style: a file picker in the Add expense modal and a "View" link in the table.
- Acceptance criteria:
  - [ ] The modal has "Attach receipt" (jpeg, png, webp, pdf; max 15 MB).
  - [ ] The table shows a paperclip with "View" when a receipt exists. It opens in the same tab (no `target=_blank`, owner rule for Nigeria in-app browsers) in a modal viewer.
  - [ ] `/api/upload` accepts `application/pdf`.
  - [ ] Receipt URLs are tenant-prefixed on R2 and are not public-listable.
- Data: none new (`receiptUrl`). API: `POST /api/upload` accepts PDF.
- Permissions: same as F-917.
- Edge cases and errors: File too large or wrong type shows the limit. Upload offline fails with retry.
- Tests: Integration: upload PDF. E2E: attach and view.

### F-920: Manual journal entry
- Priority: P2. Milestone: M5.
- Description: The Owner and Finance clerk can post a manual balanced entry. The modal shows live debit and credit totals and a state (Empty, Balanced, Out of balance). Post is disabled until balanced with at least two lines.
- Current app: `JournalEntryModal`, `POST /api/gl/journal-entries` (hard-coded super_admin only), `POST /journal-entries/:id/void` (super_admin only).
- Mockup: `finance.html` modal "New journal entry".
- Acceptance criteria:
  - [ ] Fields: Date, Reference (auto `JE-nnnn`, editable), Description, lines (Account, Debit, Credit, remove) and "Add line".
  - [ ] The account list shows live codes (F-903).
  - [ ] Totals and state tag update as the user types. Post button is disabled until the state is Balanced and there are two or more lines.
  - [ ] The route uses `gl:create` and `gl:update` permission (default: Owner, Finance clerk) instead of a hard-coded role (the matrix already gives `accountant` gl create/update). Void needs the Owner.
  - [ ] A line cannot have both debit and credit. Amounts are Decimal.
  - [ ] Reference unique per tenant.
- Data: none new. API: permission change only.
- Permissions: post: Owner, Finance clerk. Void: Owner.
- Edge cases and errors: Date in the future is allowed with a warning. Posting to an inactive account (1020 after F-904) is blocked.
- Tests: Unit: balance check. Integration: permission matrix. E2E: post and see in ledger.

### F-921: Chart of accounts and ledger browse
- Priority: P2. Milestone: M5.
- Description: Browse the chart with balances, open an account ledger with running balance and export it to CSV. The account pick list in the mockup is a short list; the full chart stays searchable.
- Current app: `GET /api/gl/accounts`, `/accounts/:id/ledger`, `/ledger/export`; General Ledger sub-tab.
- Mockup: `finance.html#t-accounting` General ledger.
- Acceptance criteria:
  - [ ] Chart list: search by name or code, type badge, balance, "View ledger". Paginated.
  - [ ] Ledger table: Date, Entry (JE-nnnn or source id), Description, Debit, Credit, Balance. Page size 20. Export CSV.
  - [ ] Rows from Meta spend show "₦530k at ₦112" style text: the original amount and the rate of that day (O5).
  - [ ] A trial-balance line under the list: total debits equal total credits.
  - [ ] Account 1020 shows as inactive.
- Data: none new. API: unchanged.
- Permissions: `gl:view`.
- Edge cases and errors: A big ledger (more than 50,000 lines) exports in a background job and downloads when ready (GUESS: check size on production).
- Tests: Integration: running balance equals account balance. E2E: open ledger.

### F-922: Financial statements: income statement and balance sheet
- Priority: P1. Milestone: M5.
- Description: Show an income statement and a balance sheet for a date or range. The balance sheet needs an equity account (3010) because the live chart has none. Retained earnings today = all-time revenue minus expenses; keep it, shown as "Result to date". Keep PDF export (not shown in the mockup).
- Current app: `GET /api/financial/profit-loss`, `/balance-sheet`; Export PDF.
- Mockup: `finance.html#t-accounting` Statements: Income statement (1-17 Oct) and Balance sheet at 17 Oct.
- Acceptance criteria:
  - [ ] Income statement lines: Delivered revenue, Product cost, Gross profit (and %), Delivery fees (5070; one line for 3PL and agents, all outcomes), Rep commission and rewards (5050), Meta ad spend (5080), Paystack fees (5060), Other expenses (5100), Net profit (and margin %).
  - [ ] Balance sheet lines: Cash (1010), Cash with partners (1015), Paystack receivable (1030), Inventory (1200), total assets; Commissions payable (2020), Unapplied receipts (2040), Supplier payables (2050), Refund liability (2010), total liabilities; Owner's equity (3010) and Result to date.
  - [ ] Assets equal liabilities plus equity. If not, a warning "Out of balance by GH₵N" shows (kept from today).
  - [ ] Fixture: assets 41,900 + 23,400 + 41,600 = GH₵106,900.
  - [ ] Owner's equity is set by an opening entry in the migration so that the balance sheet balances (supplier payables, which the mockup shows as GH₵9,800, use account 2050, decision R4).
  - [ ] Export PDF stays on both statements. CSV per statement is added (G8 direction).
  - [ ] The monthly P&L table appears here and on the Overview, from one component (section 4 item 6).
- Data: account 3010. API: `GET /api/financial/profit-loss`, `/balance-sheet` return the new lines.
- Permissions: `financial:view`.
- Edge cases and errors: A date with no entries shows zeros. A tenant that has no 3010 balance shows equity 0 and a hint.
- Tests: Unit: statement builder on a fixed ledger. Integration: balance equation holds after every posting test.

### F-923: Monthly profit and loss, with the Aug and Sep note (D5)
- Priority: P1. Milestone: M5.
- Description: One table shows delivered revenue, product cost, delivery fees, rep commission, Meta ad spend (converted at each day's rate), other expenses, net profit and net margin (target 35 percent). Columns: Aug, Sep, 1-17 Sep (same days last month), 1-17 Oct. Aug and Sep stay as booked (D5). A note on those two columns says they were booked at an older cost per set and are not restated.
- Current app: none (P&L is a single range).
- Mockup: `finance.html#t-overview` card "Monthly profit and loss"; Export CSV.
- Acceptance criteria:
  - [ ] Four columns as above. Months are by delivery date.
  - [ ] "Rep commission and rewards" is its own row (account 5050). October (1-17 Oct) shows GH₵2,768 (commission 2,128 + upsell reward 640). Aug and Sep show "not split out" because they stay as booked (D5).
  - [ ] Aug and Sep show a note icon with the text "Booked with the older cost per set. Not restated." The note text is stored in a setting (`periodNotes`, key `2026-08`, `2026-09`) so the Owner can edit it.
  - [ ] "1-17 Sep" is computed with the same day numbers as the current month's to-date range. On 18 Oct it shows 1-18 Sep (the column label follows the range).
  - [ ] Meta ad spend row shows "₦112 = GH₵1" under the label, or "mixed rates" with a link to the rate history (F-1232) if the rate changed in the range.
  - [ ] Net margin row shows the target 35 percent.
  - [ ] Export CSV downloads all rows and columns.
  - [ ] No recomputation of Aug or Sep from current landed cost.
- Data: `SystemConfig.periodNotes` (JSON). API: `GET /api/financial/monthly-pl?months=2&compare=to-date`.
- Permissions: `financial:view`.
- Edge cases and errors: A month with no data shows "n/a". Month before the first order shows no column.
- Tests: Integration: columns on the fixture. Unit: to-date column range.

### F-924: Profit by product
- Priority: P1. Milestone: M5.
- Description: A table shows, for each product, delivered orders, revenue, product cost, fees, Meta ads, profit and margin. The profit per delivered order for each product uses the same data (copybook -GH₵57 before rep commission, overall -GH₵38 after it). The card text such as "The copybook set lost GH₵20,400" is computed from the table (section 4 item 14). The product delivered counts here are the canonical counts that Products and Reports read (section 4 item 13).
- Current app: Profitability tab: `GET /api/financial/profitability`, `/export`, CSV and Excel; uses current `product.cogs`.
- Mockup: `finance.html#t-accounting` Profit by product (table and 3-month chart).
- Acceptance criteria:
  - [ ] Columns: Product, Delivered, Revenue, Product cost, Fees, Meta ads, Profit, Margin. Total row and rows "Meta spend with no product" and "Other expenses".
  - [ ] Product cost uses the landed cost frozen on the order at delivery (`Order.landedCostTotal`, Builder B2), not today's cost. Until that field exists, GUESS: `product.cogs` at delivery time.
  - [ ] Meta ads per product come from the campaign mapping (F-1003). Unmapped spend is the row "Meta spend with no product".
  - [ ] The agent card text and the table agree (a test compares them).
  - [ ] Profit per delivered order = profit / delivered orders, shown per product.
  - [ ] CSV and Excel export stay.
  - [ ] Fixture: net 376 delivered, GH₵92,000, cost 12,000, fees 12,200, Meta 76,200, rep commission and rewards 2,768 (commission 2,128 + upsell reward 640, account 5050), net profit -14,268 (margin -15.5 percent, shown as -16 percent, decision R6; before the commission line it was -11,500). Aug and Sep show the line as "not split out".
  - [ ] The copybook line in the mockup (306 delivered, -17,300) and the Products page figure (328) are replaced by this one source.
- Data: none new beyond `Order.landedCostTotal`. API: `GET /api/financial/profit-by-product?from&to`.
- Permissions: `financial:view`.
- Edge cases and errors: A product with no cost shows "Cost missing" and is flagged. A digital product has cost 0 and fees = Paystack fee.
- Tests: Unit: product math. Integration: table total equals income statement.

### F-925: October order cohort card
- Priority: P1. Milestone: M5.
- Description: The card shows projected profit for orders placed in the period, using the projected yield (not what is delivered so far). It answers "will this month's orders make money?" Formula: delivered = orders x yield; revenue = delivered x average order value; cost = delivered x landed cost per set; fees = delivered x weighted average delivery fee (R5); rep commission and rewards = the cohort commission and upsell rewards (R6); ads = Meta spend in GH₵.
- Current app: none.
- Mockup: `finance.html#t-overview` card "October order cohort".
- Acceptance criteria:
  - [ ] Inputs: cohort = orders placed in the range; yield = order-to-cash yield on closed cohorts (F-1008), 34 percent now.
  - [ ] Output on the fixture: delivered 491 (1,445 x 34 percent); revenue GH₵120,300; product cost -GH₵14,700 (491 x 30); fees -GH₵15,900; Meta -GH₵76,200 (₦112 = GH₵1); rep commission and rewards -GH₵3,600 (about GH₵7.4 a delivered order); profit before other expenses GH₵9,900 (8 percent).
  - [ ] The card says "Projected at 34% yield" and names the yield used.
  - [ ] The page shows both numbers in one place with a one-line explanation: "By delivery date: -GH₵14.3k. By order cohort: GH₵9.9k." (the same sentence as Reports, F-1055).
  - [ ] Cohort profit per delivered order = GH₵20 (9,900 / 491).
- Data: none. API: `GET /api/financial/cohort-profit?from&to`.
- Permissions: `financial:view`.
- Edge cases and errors: No closed cohort yet: the card shows "Not enough closed orders" and no number. Yield 0 shows loss equal to ad spend.
- Tests: Unit: cohort formula with rounding. Integration: fixture.

### F-926: Cost of failed deliveries
- Priority: P2. Milestone: M5.
- Description: The card shows what failed and returned orders cost: delivery fees charged on failed orders plus returned units lost times landed cost. In October: fuel fee on failed (Kofi 70 x GH₵5, Kwesi 22 x GH₵5) GH₵460 plus 5 returned units lost x GH₵30 = GH₵150, total GH₵610.
- Current app: GL 5020 and 5030 exist (they stop receiving fee postings; fees go to 5070, decision F3); no card.
- Mockup: `finance.html#t-overview` card "Cost of failed deliveries".
- Acceptance criteria:
  - [ ] Fees on failed orders = sum of 5070 postings with outcome `failed` in the range, split by partner.
  - [ ] Units lost = returned units sent by the 3PL minus units received (`Returned units missing`, Builder B2) times landed cost per unit.
  - [ ] Total GH₵610 on the fixture.
  - [ ] The customers page figure "GH₵40 per refused order" (section 4 item 17) reads this card's source; this card gives GH₵0 to GH₵5 fees plus lost units.
  - [ ] Click on a partner row opens that partner in Deliveries.
- Data: none. API: `GET /api/financial/failed-delivery-cost?from&to`.
- Permissions: `financial:view`.
- Edge cases and errors: Logiswift charges nothing on failed or returned orders, so its row is GH₵0 in fees. A partner with no fee rule shows the default fee 0 and a hint.
- Tests: Unit: sum with split. Integration: fixture 610.

### F-927: Cash runway
- Priority: P1. Milestone: M5.
- Description: Cash runway = cash at bank and MoMo (account 1010) divided by daily ad spend. It tells the owner how many days of ads the cash pays for. Fixture: GH₵41.9k / GH₵4,500 a day = 9.3, shown as 9 days.
- Current app: none.
- Mockup: `finance.html#t-overview` tile "Cash runway".
- Acceptance criteria:
  - [ ] Daily ad spend = average of the last 7 days of Meta spend in GH₵ (GUESS: 7 days; owner sets). The assumption text is shown under the tile ("GH₵4,500 ads a day").
  - [ ] Result is rounded down to whole days.
  - [ ] If there is no Meta data, the tile shows "Connect Meta Ads" with a link to Connections.
  - [ ] The tile tag: under 7 days "Tight", under 3 days "Critical".
- Data: none. API: part of F-902 overview.
- Permissions: `financial:view`.
- Edge cases and errors: Ad spend 0: runway "n/a". Negative cash: "0 days".
- Tests: Unit: runway math and rounding.

### F-928: Cash position and 30-day forecast (double-count fix)
- Priority: P1. Milestone: M5 (check in M1).
- Description: The design doc says `getCashFlowReport` may double count (GUESS). The code check on 2026-10-18 shows it does. It sets `cashAvailableNow = 1010 + 1020`, `totalCashPosition = 1010 + cashInTransit + 1020 + cashExpected` and `totalCashPipeline = cashAvailableNow + cashInTransit + cashExpected`. Cash in transit is the order total of delivered, not deposited orders, which also sits in account 1015. Cash expected is out-for-delivery orders, which is not cash yet. After F-904 account 1020 is 0. Rebuild the report so each unit of money is in one bucket. The forecast uses terms per partner and not a flat daily average.
- Current app: `financialService.getCashFlowReport`, `generateCashFlowForecast` (30-day average of collections and expenses), CSV export.
- Mockup: `finance.html#t-forecast` KPI tiles, chart "Cash balance, next 30 days", scenario switch, table "Week by week".
- Acceptance criteria:
  - [ ] Buckets: Cash at bank and MoMo (1010). Cash with partners (1015, net of expected fee). Expected from out-for-delivery orders is shown as a forecast item only, never added to cash.
  - [ ] No two buckets hold the same order. A test delivers orders at each stage and checks the sum.
  - [ ] Forecast inflows: partner payouts on their usual pay day (Logiswift: average days to pay from history; agents: within 4 days; new deliveries paid after 7 days). These are settings per partner with defaults from history.
  - [ ] Forecast outflows: Meta ads per day, supplier payables by date, rep commissions on the pay date, other expenses at the last 30-day average.
  - [ ] Scenario switch: "Today's pace, 48% delivery success" and "If delivery success reaches 60%". The scenario changes only the inflow side.
  - [ ] KPI tiles: Cash today GH₵41.9k; Expected in, 30 days; Expected out, 30 days; Cash on the lowest-point date with tag Safe, Tight or Runs out.
  - [ ] Table "Week by week": Week, Money in, Money out, Net, Cash at end. Export CSV.
  - [ ] Agent card text changes with the scenario and opens Marketing; "Chase Logiswift now" opens a pre-filled message (G10).
  - [ ] The projected balance is not floored at 0 (today `Math.max(0, ...)` hides a negative balance). Negative is shown.
- Data: `PartnerSettlement` history feeds the pay-day averages. API: `GET /api/financial/cash-flow?scenario=pace|target`, `/cash-flow/export/csv`.
- Permissions: `financial:view`.
- Edge cases and errors: No payout history for a partner uses the default 7 days. Supplier payables (2050) are zero until a shipment with unpaid terms is recorded (decision R4).
- Tests: Unit: bucket disjointness. Unit: scenario inflows. Integration: forecast on fixture.

### F-929: Revenue and expense trend chart
- Priority: P2. Milestone: M5.
- Description: The current app has a "Revenue and Expense Trends" chart. The mockup has no chart; the monthly table replaces the numbers. Keep a chart on the Overview: delivered revenue per day (by delivery date) against total daily cost, with a selectable range. The gap-matrix verdict is MISSING-IN-MOCKUP.
- Current app: `FinancialDashboard.tsx` chart, `GET /api/financial/reports?period=daily`.
- Mockup: not in mockup. Build in the v2 style: a `.card` with `.ct` title "Revenue and expenses per day", a line chart for revenue, bars for expenses, legend, range as the page date control.
- Acceptance criteria:
  - [ ] Revenue line uses delivered revenue per delivery date (F-900). Expense bars use total expenses per entry date.
  - [ ] Hover shows date, revenue, expenses, net.
  - [ ] Works in dark mode with the shared tokens.
  - [ ] Empty range shows an empty state.
- Data: none. API: `GET /api/financial/reports?period=daily` returns revenue by delivery date.
- Permissions: `financial:view`.
- Edge cases and errors: Days with no data show 0. A range over 366 days groups by week.
- Tests: Integration: series sums to the tile totals.

### F-930: Export menu
- Priority: P2. Milestone: M5.
- Description: The Finance header has an Export menu with four CSV files: Profit and loss, Agent aging and collections, General ledger, Cash-flow forecast. Each downloads a real file (the mockup shows only a toast). A link "More in Reports" opens Reports. Excel is added to match Reports (G8).
- Current app: CSV buttons per tab.
- Mockup: `finance.html` header Export menu.
- Acceptance criteria:
  - [ ] Four items download CSV with the page date range. Each file name has the range.
  - [ ] "Excel" is available for Profit and loss and Profit by product.
  - [ ] Amounts in the file use 2 decimals, a dot as the decimal mark and no thousand separator.
  - [ ] "More in Reports" opens `reports.html` on Products and profit.
- Data: none. API: existing export endpoints plus `/profit-loss/export`.
- Permissions: `financial:view`.
- Edge cases and errors: Empty range gives a file with headers only.
- Tests: Integration: CSV columns and totals.

### F-931: Finance health check and backfills
- Priority: P2. Milestone: M5.
- Description: Keep the admin endpoints for the integrity check and the backfills. Extend the check with the new rules.
- Current app: `GET /api/financial/health`, `POST /refresh-aging`, `/backfill-collections`, `/backfill-delivery-dates`, `/backfill-commissions`.
- Mockup: not in mockup (no UI today).
- Acceptance criteria:
  - [ ] The check reports: unbalanced entries; account balance vs sum of lines; 1015 vs unreconciled collections; 2020 vs open commission and reward entries; delivered orders with no `deliveryDate`; accounts with no tenant; open `ledger_gap` days.
  - [ ] The check returns a list of failures with counts, never a single "ok" without detail.
  - [ ] Backfills run per tenant and are safe to re-run.
- Data: none. API: unchanged paths.
- Permissions: Owner and Admin.
- Edge cases and errors: A check that takes more than 30 seconds runs as a job and returns a job id.
- Tests: Unit: each check on a planted fault.

### F-932: Money columns become Decimal (D4)
- Priority: P0. Milestone: M0.
- Description: Decision D4 converts the money columns of Order, Product, Expense, Payout and others from Float to Decimal in M0. This file lists the Finance part. The schema comment says a Decimal migration was started but did not change the columns.
- Current app: `Order.subtotal`, `shippingCost`, `totalAmount`, `codAmount` (Float); `Expense.amount`, `Payout.amount` (Float); `User.commissionAmount`, `totalEarnings` (Float; `deliveryRate` is removed, decision F1); `product_cost_entries.amount` (Float). Ledger, collections, deposits, shipments are already Decimal.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] Columns become `Decimal(19,4)`: `Expense.amount`, `Payout.amount`, `User.commissionAmount`, `User.totalEarnings`, `product_cost_entries.amount`. (`Order` and `Product` columns are owned by Builder B1/B2 and use the same migration.)
  - [ ] Before any column is converted, a check on production data in M0 finds which money columns hold minor units (R15), first `Order.depositPaid` and `Order.balanceDue` (file 04, F-405). The check result is written down. Only then does the migration run.
  - [ ] The migration copies values with rounding to 4 places and checks that column sums before and after match to 0.0001. It stops if they do not.
  - [ ] Services use `Prisma.Decimal` for add, subtract, multiply and divide. No `number` arithmetic on money in Finance code.
  - [ ] API returns money as numbers with 2 decimals for display endpoints. Exports use 2 decimals. Ledger endpoints return 4 decimals as strings.
  - [ ] Test: adding 0.1 a thousand times gives exactly 100.00.
  - [ ] Rollback script exists and is tested on a copy.
- Data: the column changes above. API: shape rules above.
- Permissions: not applicable.
- Edge cases and errors: Float values with more than 4 decimals round half up. Values above 1e15 are rejected by the migration check.
- Tests: Migration test on a copy of production data. Unit: Decimal helpers.

### F-933: Meta ad spend posts to the ledger
- Priority: P1. Milestone: M8.
- Description: Each day's Meta spend posts as an expense: DR 5080, CR 1010, in the store currency at that day's rate (O5). The spend comes in the ad account's currency (sample: ₦). The original amount and currency stay on the record. Spend is not entered by hand.
- Current app: none. (Linear MAN-49 and MAN-50 are stale.)
- Mockup: ledger text "Meta daily spend, ₦530k at ₦112".
- Acceptance criteria:
  - [ ] After each spend pull (F-1001) the system posts one `Expense` of `source = meta` for each (ad account, day), with `amount` in the store currency = ad-account spend converted at that day's rate (sample: ₦ spend / that day's ₦ per GH₵ rate). Description: "Meta daily spend, ₦530,000 at ₦112".
  - [ ] When Meta restates a day's spend, the system voids the old entry and posts the new one.
  - [ ] The rate is the stored rate of that day (F-1232). If none exists, it uses the nearest earlier day and flags the entry "rate carried forward".
  - [ ] The entry cannot be edited by hand (F-917).
  - [ ] Daily total on the ledger equals `MetaSpendDay` total for that day in the store currency.
  - [ ] Unmapped campaigns still post (the spend is real). They show under "Meta spend with no product".
- Data: `Expense.source = meta`, `Expense.originalCurrency`, `originalAmount`, `fxRate`. API: none public.
- Permissions: system action.
- Edge cases and errors: Missing rate on the first day: the job waits and raises a Finding `fx_missing`. Ad account in GH₵ (Magic Groove GH account may bill in a different currency than Manny Dynamics NG): each account uses its own currency (O5).
- Tests: Unit: conversion and restatement. Integration: pull then ledger total.

### F-934: Paystack payout posting
- Priority: P2. Milestone: M5.
- Description: A digital sale debits account 1030 (Paystack receivable). Nothing credits 1030 when Paystack pays the bank, so the account only grows. The code check found 1030 only in the sale entry. Add the posting for the bank payout. This is a GUESS-checked gap: if a manual journal entry clears 1030 today, move that practice into this posting.
- Current app: `createDigitalSaleEntry` only. `GET /api/paystack/...` has no payout import.
- Mockup: not in mockup.
- Acceptance criteria:
  - [ ] An owner action "Record Paystack payout" (amount, date, reference) posts DR 1010, CR 1030.
  - [ ] The Overview shows no balance on 1030 older than 7 days without a payout (a Finding `paystack_unsettled`).
  - [ ] Check production for a manual entry on 1030 before build (how: ledger of 1030 on production).
- Data: `Finding.type = paystack_unsettled`. API: `POST /api/financial/paystack-payouts`.
- Permissions: Owner, Finance clerk.
- Edge cases and errors: Payout bigger than 1030 balance: warn and allow with a note.
- Tests: Integration: sale then payout leaves 1030 at 0.

### F-935: Failed-delivery and return postings from the state machine
- Priority: P0. Milestone: M1.
- Description: Setting an order to `failed_delivery` posts no ledger entry today (section 3 item 11); only a separate path does. The new order state machine (D7, M1) calls one function for each outcome. Failed delivery posts the failed delivery fee from the fee rule. A return posts the reversal.
- Current app: `orderService.updateOrderStatus`; `glAutomationService.createFailedDeliveryEntry`; `deliveryService.markDeliveryFailed` (no callers).
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] Moving an order to `failed_delivery` posts DR 5070 for the failed fee from the fee rule (0 if none) and the credit as in F-936. The entry is idempotent.
  - [ ] Moving a delivered order to `returned` posts the reversal dated `returnedAt` and voids unpaid `CommissionEntry` rows (F-914).
  - [ ] The old default fee 50.00 (`GL_DEFAULTS.FAILED_DELIVERY_FEE`) is removed. The fee comes from the fee rule only.
  - [ ] Dead methods `markDeliveryFailed`, `createDelivery`, `autoAssignAgent`, `getAgentStats` are removed or reused by the state machine (section 3 item 22).
- Data: none. API: no new routes.
- Permissions: system action.
- Edge cases and errors: A failed order that later succeeds (re-delivery) keeps the failed fee as booked. A second failure posts a second fee.
- Tests: Unit: each transition posts the right lines. Integration: fixture failed cost 460.

### F-936: Delivery fee posting (booked once when the outcome happens; true-up at settlement)
- Priority: P0. Milestone: M5.
- Description: Decisions F1 to F4. The delivery fee is what we pay whoever delivers an order, a 3PL company or an own agent. It is booked once, as a delivery fee expense (5070), on the day the outcome happens: delivered, failed or returned (F3). There is no second expense and no extra P&L line. The partner keeps the fee from the cash it collects and hands in the rest (F4). So the expected cash from a partner is cash collected minus fees. The 3PL payout and the agent deposit are both matched against that net amount. At settlement a 3PL's real charge replaces the fee booked from the rule (true-up).
- Current app: `Tenant.defaultDeliveryFee` is never read; public checkout shipping fixed at 0 (section 3 item 42).
- Mockup: `deliveries.html` fee rules (Logiswift GH₵35 per delivered, none on failed; Kofi GH₵25, GH₵5 on failed; Esi GH₵25; Kwesi GH₵30, GH₵5 on failed; Kasapa GH₵30). The sample "pay-per-delivery for agents" amounts are removed.
- Acceptance criteria:
  - [ ] Each partner has one fee rule in Settings (F2): fee per delivered, per failed and per returned order. The rule valid on the outcome date is used.
  - [ ] `Order.deliveryFee` (Decimal) is set when the outcome happens from the fee rule. Delivered: DR 5070 and DR 1015 for the total minus the fee, CR 4010 for the total. Failed or returned: DR 5070, CR 1015 for the fee (section 2.2).
  - [ ] No second expense is posted for the same outcome. The P&L has one line "Delivery fees" for 3PL and agents together (decision R6).
  - [ ] Expected cash from a partner = cash collected minus fees kept. The failed and returned fees also reduce it. The 3PL payout and the agent deposit are matched against this net amount (F-906, F-908, F-912).
  - [ ] An agent keeps their fees from the cash they collect and hands in the rest. The agent app shows the deposit amount due as collected minus fees kept.
  - [ ] No fee payout exists. The payout form (F-913) has no fee line, and no `CommissionEntry` is created for a fee.
  - [ ] Settlement true-up posts the difference between `charge` and `deliveryFee` to 5070 and 1015 (F-906).
  - [ ] Delivery fee per delivered order for margin math and break-even = weighted average of `deliveryFee` over the delivered orders of the product in the range (decision R5). No fixed GH₵34. On the fixture the weighted fee from the rules is about GH₵31.3 and the statements imply GH₵32.4 (see Q-F6).
  - [ ] `Tenant.defaultDeliveryFee` is dropped.
  - [ ] One-time backfill for October: orders already delivered get `deliveryFee` from the rule valid then, and one adjusting entry moves the agent commission booked in 5040 to 5070. Aug and Sep stay as booked (D5).
- Data: `Order.deliveryFee Decimal(19,4)`; fee rule per partner (Builder B2 `FeeRule`, Deliveries area). API: none new.
- Permissions: system action.
- Edge cases and errors: No fee rule for a partner: fee 0 and a Finding `fee_rule_missing` once a day. A partner with no cash to net a failed fee from keeps it as a negative balance on 1015 until its next collection; a 3PL deducts it from the next payout.
- Tests: Unit: rule lookup by date. Integration: deliver, fail, return, settle and compare; expected cash equals collected minus fees.

### F-937: Tenant scoping for Finance models and the system user
- Priority: P0. Milestone: M0 (scoping) and M2 (system user).
- Description: Twelve models lack `tenantId` (section 3 item 36). The Finance ones are `AgentCollection`, `AgentDeposit`, `AgentAgingBucket`, `Payout`, `product_cost_entries`. The aging refresh deletes all rows (item 34). The reconciliation job assumes user 1 exists (item 33).
- Current app: see above; `SYSTEM_USER_ID = 1`.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] The five models get required `tenantId`, backfilled from their parent order or user. They join the tenant-scoped list.
  - [ ] No finance query runs without a tenant context (queues and crons set one).
  - [ ] Each tenant has a system user; the reconciliation job uses it as the actor.
  - [ ] Two-tenant test: a second tenant sees none of the first tenant's collections, deposits, aging rows or payouts, and its refresh does not delete the first tenant's rows.
- Data: the column changes above. API: none.
- Permissions: not applicable.
- Edge cases and errors: Rows whose parent is missing are listed by the backfill and not guessed.
- Tests: Integration: two-tenant isolation for each model.

### F-938: Remove orphaned Finance code
- Priority: P3. Milestone: M5.
- Description: Remove unused Finance components and calls (section 3 item 21): `AgentAgingTab`, `AgentReconciliationTab`, `CashFlowTab`, `components/financial/OverviewTab`, `DepositActionModal`, and the unused calls `/financial/transactions`, `/financial/cod-collections`, `/financial/profit-margins`, `/financial/agent-cash-holdings`.
- Current app: listed above, imported nowhere.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] Files and unused service calls are deleted. Build, lint and tests pass.
  - [ ] Any logic worth keeping (bulk select in `DepositActionModal`) is reused in F-912 first.
- Data: none. API: unused routes removed.
- Permissions: not applicable.
- Edge cases and errors: Check no other caller (grep) before delete.
- Tests: Build and lint.

### F-939: Finance permissions and menu
- Priority: P1. Milestone: M5.
- Description: Finance actions need clear permissions. The base matrix stays (`financial`, `gl`). New tool names map to it (F-1153). Delivery agents have `financial:create` today so they can submit deposits; keep that, limited to their own rows.
- Current app: `RP(financial, view|create|update)`, `RP(gl, ...)`.
- Mockup: `staff.html` tools "Record payout", "Export data".
- Acceptance criteria:
  - [ ] Menu "Finance" shows for `financial:view`.
  - [ ] Verify, reject, block, unblock: Owner, Admin, Manager, Finance clerk as today (deposit verify and reject: Owner and Finance clerk only, as today).
  - [ ] Record payout: new permission `payouts:create`, default Owner, Admin, Manager, Finance clerk.
  - [ ] Write off a Finding: Owner only.
  - [ ] Delivery agents see their own deposits and balance only.
- Data: matrix gets resource `payouts` [view, create]. API: permission checks.
- Permissions: as listed.
- Edge cases and errors: A user with view only sees buttons disabled with a tooltip.
- Tests: Integration: permission matrix per role.

---

## 4. Cross-area dependencies

I rely on these items from other files (exact IDs where known, otherwise the area):
- Order state machine and `Order.deliveryDate`, `returnedAt`, `deliveryFee`, `landedCostTotal` (Builder B1, orders F-300 range; Builder B2 landed cost F-600/F-650 range).
- `FeeRule` model and edit screen, partner `daysToPay`, partner list (Builder B2, F-700 range).
- Landed cost per unit on counted quantity (D2) and shipment receive (Builder B2, F-650 range).
- Returned units missing (Builder B2, F-700 range).
- `UpsellLine` and the confirming rep (Builder B2, rep screen, F-750 range).
- Delivery agent app deposit form with reference number (Builder B2, F-800 range).
- Inbox item for a Finding assigned to a person (Builder B1, F-550 range).
- Orders list filter "Unpaid by agent" (Builder B1, F-300 range).
- Meta spend pull and campaign mapping (this builder, F-1000 to F-1049 in file 11).
- FX rate store and daily rate (this builder, F-1232 in file 12).
- Rewards settings (F-1231) and attainment (F-1110) in file 12.
- Outside agents call with a normal API or MCP key (decisions O1 and O7; the partner key F-1214 was removed by O7).
- Command palette actions "Record a 3PL payout" (Builder A shell, F-100 range).
- Audit log for every money write (Builder A, F-1300 range).
- Tool registry: `financial_summary`, new KPI tools (Builder A, F-1300 range).

## 5. Open questions and GUESS items

| ID | Item | How to check or who decides |
|---|---|---|
| Q-F1 | Mockup shows "Cash at bank and MoMo" (1000). Live has only 1010 "Cash in Hand". Keep one cash account or split bank and MoMo? This file keeps one (1010) and relabels it. | Owner |
| Q-F2 | Mockup shows "Supplier payables GH₵9,800" and a forecast outflow of GH₵5,000. | RESOLVED (decision R4): add a supplier payables account (2050). Shipment terms stay a setting in Products and stock. |
| Q-F3 | Mockup P&L has no pay line; pay-per-delivery for agents would have moved the margin to about -15 percent. | RESOLVED (decisions F1, F3, R6): there is no pay-per-delivery for agents. Delivery fees are one P&L line, rep commission is its own line, October margin is about -16 percent once the commission line is in (formula wins, R1); updated 2026-10-19. NUMBERS.md was refreshed on 2026-10-19 and no longer has the pay-per-delivery for agents GH₵12/10. |
| Q-F4 | Mockup agent card says "38 orders unpaid after 8 days ... GH₵17.3k". In the table, 38 orders over 8 days are worth GH₵9,100; GH₵17.3k is all cash Logiswift holds. | RESOLVED (decision R1): computed numbers follow the written formula. Fix the sample text. |
| Q-F5 | Are the agent fee rule (Kofi GH₵25) and the pay-per-delivery for agents rate (GH₵12) both paid? | RESOLVED (decisions F1, F2, F4): there is one fee rule per partner (Kofi GH₵25). The agent keeps it from the cash they collect. The GH₵12/10 "pay-per-delivery for agents" is removed. |
| Q-F6 | Break-even in NUMBERS.md uses a fee of GH₵34; the rules give about GH₵31.3 and the statements imply GH₵32.4. | RESOLVED (decision R5): the fee comes from each partner's fee rules. Break-even and max CPA use the weighted fee from data. |
| Q-F7 | Settlement mockup: Logiswift paid GH₵9,880 against an order list of GH₵10,720, "short 840". The mockup ignores charges. | RESOLVED (decisions F4, R1): expected payout = cash collected minus fees. Fix the sample data. |
| GUESS | How an outside agent keys its rows (order id or reference) for payout matching (F-906). | Ask the owner who runs the agent |
| GUESS | Seven-day average for cash runway (F-927). | Owner |
| GUESS | Five percent charge variance limit (F-906). | Owner |
| GUESS | Old COGS expense rows (F-918). | Query production: count by category |
| GUESS | No manual entry clears 1030 today (F-934). | Query production ledger for 1030 |
| GUESS | Production chart has no manual account with codes 2040, 2050, 3010, 5070, 5080 (F-903). | Query production `accounts` |

## 6. Coverage table (gap-matrix rows in this file's scope)

Rows are listed in the same order as the matrix. Section 1.10 has 28 rows, section 3 items in scope are 10 rows, and section 4 items in scope are 5 rows.


### Section 1 rows

| Matrix row | Verdict | Covered by |
|---|---|---|
| FI-01 Overview KPIs | CHANGE | F-902 |
| FI-02 Revenue and expense trends chart | MISSING-IN-MOCKUP | F-929 |
| FI-03 Pipeline revenue, in-transit | DROP | DROP: matrix DROP, replaced by "Cash outstanding" tile (F-902) |
| FI-04 30-day cash forecast | KEEP+RESTYLE | F-928 |
| FI-05 Payout reconciliation table | NEW | F-906, F-907 |
| FI-06 Unpaid delivered by age | NEW | F-910 |
| FI-07 Cohort profit card | NEW | F-925 |
| FI-08 Cost of failed deliveries | NEW | F-926 |
| FI-09 Monthly P&L table | NEW | F-923 |
| FI-10 Cash runway | NEW | F-927 |
| FI-11 Agent aging and collections | KEEP+RESTYLE | F-911 |
| FI-12 Send reminder, block, unblock | KEEP+RESTYLE | F-911 |
| FI-13 Collections chain (verify, approve, deposit, reconcile) | CHANGE | F-912, F-904 |
| FI-14 Deposit verify and reject with reason | KEEP+RESTYLE | F-912 |
| FI-15 Record partner payout | NEW | F-908 |
| FI-16 Findings list (cash gap, short-pay, stock gap) | NEW | F-909 |
| FI-17 Record journal entry | KEEP+RESTYLE | F-920 |
| FI-18 Chart of accounts and ledger | CHANGE | F-903, F-921 |
| FI-19 Financial statements | KEEP+RESTYLE | F-922 |
| FI-20 Profit by product | CHANGE | F-924 |
| FI-21 Expenses (add, edit, delete, search, breakdown) | KEEP+RESTYLE | F-917 |
| FI-22 Expense categories | CHANGE | F-918 |
| FI-23 Expense receipt upload and view | MISSING-IN-MOCKUP | F-919 |
| FI-24 Expense "Paid from" | NEW | F-917 |
| FI-25 Rep commissions and payouts | CHANGE | F-913, F-914 |
| FI-26 Export menu | KEEP+RESTYLE | F-930 |
| FI-27 Delivery-agent pay in the books | Removed (decision F1) | F-915 (removed); delivery fee in F-936 |
| FI-28 Finance health and backfill endpoints | KEEP as-is | F-931 |

### Section 3 broken items in scope

| # | Item | Covered by |
|---|---|---|
| 8 | Agent deposit credits 1020; delivery debits 1015; 1020 never debited | F-904 |
| 11 | Failed delivery GL entry not posted when status set to `failed_delivery` | F-935 |
| 21 | Orphaned finance components (`AgentAgingTab`, `AgentReconciliationTab`, `CashFlowTab`, `OverviewTab`, `DepositActionModal`) and unused finance calls | F-938 |
| 22 | Dead service methods: `markDeliveryFailed`, `createDelivery`, `autoAssignAgent`, `getAgentStats`; customer merge/tags/top; `notifyOrderAssigned` and two more; analytics time series | F-935, F-938 |
| 33 | `SYSTEM_USER_ID = 1` assumed to exist | F-937 |
| 34 | `agingService.refreshAll` global `deleteMany({})` | F-911, F-937 |
| 35 | Chart seeded with NULL tenant; global unique `Account.code`, `JournalEntry.entryNumber` | F-903 |
| 36 | 12 models lack `tenantId` | F-937 |
| 47 | `getCashFlowReport` may double count; financial summary may omit digital revenue and Paystack fees | F-901, F-928 |
| 48 | Expense delete may not reverse GL entry | F-917 |

### Section 4 mockup fixes in scope

| # | Issue | Covered by |
|---|---|---|
| 5 | Payouts recorded in Finance and in Staff; different histories; pay-per-delivery for agents missing from books (now: delivery fee booked once, decision F3) | F-913, F-1164, F-936 |
| 13 | Product delivered counts disagree (306 vs 328, pens 172 vs 116, grip 89 vs 58, guide 58 vs 63) | F-924, F-1052 |
| 14 | Copybook loss GH₵20,400 vs table −GH₵17,300 | F-924 |
| 15 | Logiswift missing orders are GH₵280 each; prices are GH₵249 | F-907 |
| E1 | Chart of accounts numbers in the mockup (1000, 1100, 2100, 4000, 5100, 5200) differ from live codes (1010, 1015, 1020, 2020, 4010, 5040, 5100) | F-903 |

Count check: section 1 rows 28, section 2 rows 0, section 3 rows 10, section 4 rows 5. Total 43.
