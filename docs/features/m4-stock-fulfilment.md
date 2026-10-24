# M4 Stock and Fulfilment

Milestone M4 of the CodAdmin rebuild. Stock lives per location (3PL, agent, in transit). It moves only through stock movements, and delivery partners get their own profiles, proof and attempts. Plan: `docs/plan/M4.md`. PRD: `docs/prd/areas/06-products-stock.md`.

---

## COD-38 — Stock schema, migration script and stock fixture
**Date:** 2026-10-23 | **Type:** feat/refactor | **Branch:** feature/m4-stock-fulfilment | **Commits:** 08c8d7a, 71644ae, 98616a4, a008953, b8eb714, 0079c61, 78d5b86

### Summary
Schema for stock per location and for delivery partners. A per-tenant script moves the old stock numbers (`Product.stockQuantity`, `AgentStock`) into `StockLevel` rows, with a dry run that fails when the sum per product changes. The test fixture now holds the M4 stock numbers. Plan tasks: M4-T01 to T05.

### Changes
- **Database:** new tables `stock_locations`, `stock_levels`, `stock_counts`, `stock_count_lines`, `delivery_partner_profiles`, `delivery_attempts`; new enums `StockLocationType`, `TransferStatus`, `TransferReason`, `StockCountSource`, `ClaimStatus`, `PartnerDataSource`; shipment claim, destination and landed-cost columns, transfer from/to location columns, `orders.landed_cost_total`, `products.low_stock_days`. `Product.cogs` is now `Decimal(19,4)` (F-611). All new models are tenant scoped (`prismaExtensions.ts`).
- **Script:** `backend/scripts/migrate-stock-to-levels.ts` (`--dry-run`, `--tenant`, `--default-location`, `--allow-production`).
  - Creates the locations: 3PL Logiswift (default) and Kasapa Express, one agent location per active or stock-holding agent, and one in-transit location.
  - The old warehouse number goes to Logiswift, and agent stock goes to each agent's location.
  - It also writes two correction movements:
    - (a) Out-for-delivery orders that were taken at dispatch.
    - (b) Open COD checkout orders that were taken at creation.
  - It maps the old transfers to locations.
  - The sum per product before and after must be equal. A difference fails the dry run and rolls back the real run. A tenant that already has levels is skipped. The script never writes to `AgentStock`.
- **Fixture:** stock levels as in F-652:
  - Logiswift has 200 / 62 / 180 on hand. 116 copybooks are reserved through orders.
  - Kofi has 36 / 18 / 45, with 21 reserved and 20 in transit.
  - The 9 October shipment: 300 shipped, 288 counted, 12 short, cost 8,700, claim 324.
  - A 3PL count of 188 against 200.
  - Returns: 41 sent, 36 received.
  - Available to sell is never negative.

### Verification
- Integration tests 1253 pass (`stockMigration`, `numbersFixture`, `m4StockSchema`, two-tenant model checks). Unit tests 1594 pass. Build and lint pass.
- Production-dump copy (`ecommerce_cod_m3copy`): the dry run and the real run give equal sums for all 4 products in all 4 tenants. The second run changes nothing, and 7389 old transfers were mapped. `GET /api/products` answers with the same numbers as before.

### Open points
- Production run (T41, owner approval and a verified backup first): correction (b) puts back units for stale `pending_confirmation` orders (Dictamni 147 → 4573 at Logiswift). Proposal: limit (b) to confirmed and later orders.
- `Product.stockQuantity` still holds the old warehouse number after the migration. T06 must rebuild the cache (sum of levels) once, or the T17 nightly check opens a Finding for each product.

### Key Files
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261024090000_m4_stock_schema/`, `20261024090100_m4_partner_schema/`, `20261024090200_m4_product_cogs_precision/`
- `backend/scripts/migrate-stock-to-levels.ts` (new)
- `backend/src/__tests__/fixtures/numbersFixture.ts`, `backend/src/__tests__/integration/fixtureChecks/stock.ts` (new)
- `backend/src/__tests__/integration/stockMigration.test.ts`, `m4StockSchema.test.ts` (new)
- `backend/src/__tests__/integration/helpers/twoTenants.ts`, `backend/src/utils/prismaExtensions.ts`

---

## COD-42 — Delivery partners API, proof and attempts
**Date:** 2026-10-24 | **Type:** feat | **Branch:** feature/m4-stock-fulfilment | **Commits:** 6c639ed, a77a024, 80dde3b, 8c2c193, 50bfc96, a3f925e (merge), 2884c85 (simplify)

### Summary
Read and write API for delivery partners (agents and 3PL companies), delivery proof with a signed photo URL, a delivery attempt row on each failed or rescheduled move, and the failure reason backfill. Plan tasks: M4-T18 to T20.

### Changes
- **Read API** (`/api/delivery-partners`): list with a total row (assigned, delivered, failed or returned, out now, success from `kpi.partnerRates`, medians, data source, fee rule read-only), `/summary` (5 tiles), `/waiting`, `/failure-reasons`, `/region-review`. Cash held and oldest unpaid show a dash until M5.
- **Write API:** `POST /` creates the user, the stock location and the profile; `PATCH /:id` saves profile fields with an audit row; `PATCH /:id/availability` keeps the `agent:availability_changed` event. Assignment code skips an unavailable partner. No coverage or resolve route (O4).
- **Regions:** new orders get the region of the store's country (O3); unknown values go to the review list.
- **Proof and attempts:** `GET /api/deliveries/by-order/:orderId` (recipient, time, cash, photo by signed URL, attempts); `GET /api/deliveries/proof-photo/:deliveryId` serves the signed photo; the order machine writes one `DeliveryAttempt` per failed or rescheduled move.
- **Removed:** dead `deliveryService` methods (`markDeliveryFailed`, `createDelivery`, `autoAssignAgent`, `getAgentStats`) and `GET /deliveries/routes/:agentId`.
- **Script:** `backend/scripts/backfill-failure-reason.ts` maps free text to `Order.failureReason` (Other by default) and prints the counts.
- **Known point:** the partner type comes from `User.kind`. A 3PL user without `kind = company` shows as an agent; the COD-39 stock migration sets it for users it links to a 3PL location.

### Verification
- Integration 1324 pass on the milestone branch, unit 1607, frontend vitest 1057; builds and lints pass.
- Fixture rows equal NUMBERS.md (Logiswift 590 / 220 / 270 / 100 / 45%; total 926 / 376 / 402 / 148 / 48%); reasons sum to 402.
- API check on the production-dump copy: list, summary, failure reasons, waiting, region review and by-order answer; no token gives 401.
- Simplify: 23 API responses equal before and after.

### Key Files
- `backend/src/routes/deliveryPartnerRoutes.ts`, `controllers/deliveryPartnerController.ts`, `controllers/deliveryProofPhotoController.ts` (new)
- `backend/src/services/deliveryPartnerService.ts`, `deliveryPartnerAdminService.ts`, `deliveryProofService.ts`, `deliveryAttemptHook.ts`, `regionService.ts`, `failureReasonBackfill.ts` (new)
- `backend/src/utils/failureReasonText.ts` (new), `utils/regions.ts`, `services/deliveryService.ts`, `services/orderStateMachine.ts`, `services/workflowService.ts`, `queues/workflowQueue.ts`

---

## COD-39 — Stock service, order wiring and transfers
**Date:** 2026-10-24 | **Type:** feat | **Branch:** feature/m4-stock-fulfilment | **Commits:** fb46e60, e898bc0, 8a4c1d9, ce78e38, 1b8bb12, cabee2d, 7c55715, d7ebaf2 (simplify), ed4dc70, bcf5321 (merge)

### Summary
One service writes all stock quantities. Stock leaves once, when an order becomes delivered, and comes back once when it leaves delivered. Transfers between locations go through "in transit" and need a receive step. Plan tasks: M4-T06 to T10.

### Changes
- **`stockService`** (`backend/src/services/stockService.ts`): `applyMovement` writes the movement row and the level change in the caller's transaction. Negative on hand is allowed. `lockProduct` locks the product row (tenant scoped, physical only). `getOnHand`, `getReserved` (confirmed, preparing, ready, out for delivery at the holder) and `getAvailableToSell`. `rebuildCache` sets `Product.stockQuantity` to the sum of on hand over the physical locations. A grep test (`stockWriteGrep.test.ts`) fails when other code writes quantities.
- **Order wiring:** `fulfilOrder` runs once on entering `delivered` (also by a jump), with one `order_fulfillment` movement per line, upsell lines included, from the holder at that moment. `reverseOrder` runs once on leaving `delivered`. Creation, dispatch, failed delivery and cancel move no stock. The decrement in `publicOrderService` and at `out_for_delivery` is gone, and so is the M1 `legacyStockHook`. No holder gives "Assign a delivery partner first". A short holder goes negative and opens one `stock_gap` Finding. `deliveryService.completeDelivery` uses the machine path.
- **Tests flipped:** the M0 double-decrement test now expects -3 and -2. `stockOnce.test.ts` covers deliver, return and re-deliver, a repeated delivered call, cancel of a pending public order, upsell lines, a holder change before delivery, and two parallel delivered calls.
- **Transfers** (`transferService.ts`): create (allocation, agent transfer, return to warehouse) as `in_transit`, with the source level down at once. Receive with a counted quantity: equal gives `received`, below gives `disputed` with a reason (short in package, damaged, not received), above is refused. Resolve (`return_to_source` or `write_off`), cancel (units go back to the source). An agent receives only stock addressed to them (403 otherwise). Same-location transfers are refused. An open transfer older than 3 days shows as overdue. Audit rows and a notification to the agent.
- **Routes** (`/api/inventory`): `POST /transfers`, `/transfers/:id/receive`, `/:id/resolve`, `/:id/cancel`, `POST /adjust` (new quantity, reason, a note for "Other"). Writes need `products:update_stock`. The old `/api/agent-inventory/*` write routes and `PATCH /api/products/:id/stock` are removed. The old GET routes stay as aliases for one release.
- **Permissions:** admin gets `products:update_stock` in the default matrix. The stock migration grants it on stored permission lists.
- **Migration script:** after the sum check it rebuilds the cache. This closes the COD-38 open point.

### Verification
- Milestone branch after the merge: integration 1384 pass (11 skipped), unit 1613, frontend vitest 1057; builds and lints pass.
- Production-dump copy: a fresh migration gives the cache 735 / 4573 / 217 / 62, equal to the sum of levels, and grants admin `update_stock` on 3 tenants.
- API check on the copy (port 3300): allocate 4 refill ink from Logiswift to VDL (201), receive (200), second receive (409), adjust Logiswift to 5 (200), cancel of an in-transit transfer gives the unit back (200), cancel of a received one (409), more than on hand (400 "Only 10 available"), in-transit location (400), bad reasons (400 with the list), no token (401), `PATCH /api/products/:id/stock` (404). Levels and cache balance after each step (cache 61 = 5 + 56).

### Open points
- A database migrated by the COD-38 version of the script keeps the old cache, because a second run skips the tenant. Production has not been migrated, so the T41 run uses the current script. The local `ecommerce_cod_m3copy` copy was fixed with `rebuildCache`.
- The no-holder rule sits in two layers, and the default permission matrix has two copies. Backlog at Phase 7.

### Key Files
- `backend/src/services/stockService.ts`, `transferService.ts`, `controllers/inventoryController.ts`, `routes/inventoryRoutes.ts` (new)
- `backend/src/services/orderStateMachine.ts`, `orderSideEffects.ts`, `publicOrderService.ts`, `deliveryService.ts`, `findingService.ts`, `agentInventoryService.ts`, `glAutomationService.ts`, `tenantDefaultsService.ts`, `adminService.ts`, `middleware/auth.ts`
- `backend/src/routes/agentInventoryRoutes.ts`, `productRoutes.ts`, `controllers/productController.ts`, `controllers/agentInventoryController.ts`
- `backend/scripts/migrate-stock-to-levels.ts`
- Tests: `stockService.test.ts`, `stockOnce.test.ts`, `transfersApi.test.ts`, `stockDoubleDecrement.test.ts`, `unit/stockWriteGrep.test.ts`, `integration/helpers/stock.ts`

---

## COD-40 — Shipments, receiving and landed cost
**Date:** 2026-10-24 | **Type:** feat | **Branch:** feature/m4-stock-fulfilment | **Commits:** 32626c5, f65024b, 89a6022, 659f3cf (simplify), 9c0ca23 (merge)

### Summary
Incoming shipments get their own service and routes. Receiving a shipment counts the units, adds them to a location, sets the landed cost and the average product cost, posts one ledger entry and opens a supplier claim for short units. A delivered order stores its landed cost, and the ledger uses that amount. Plan tasks: M4-T11 to T13.

### Changes
- **`shipmentService`** and routes `/api/shipments`: list (filter by status and product), `/summary` (3 tiles: pending count, units on the way, cost to land in store currency), get, create, edit, delete. One currency per shipment. The rate comes from `fxService.rateOn`, or the user types one (`manual`). A foreign currency with no rate gives 400 with a clear message. Edit and delete work only while `pending` (409 otherwise). Audit rows on each write. The old `/api/products/shipments*` routes are removed; only the URLs in `frontend/src/services/shipments.service.ts` changed.
- **Receive** (`POST /api/shipments/:id/receive`): one transaction under a shipment row lock, then the product lock. Location must be own store, 3PL or agent and active; the date not in the future; counted 0 to shipped. Writes:
  - one `receipt` movement for the counted units (none when counted is 0);
  - `totalCostStore` at the rate of the received date, landed cost per unit = total ÷ counted (D2);
  - weighted-average `Product.cogs` (on hand before floored at 0);
  - one ledger entry DR 1200 / CR 1010 for the full total, dated the received date (`createInventoryPurchaseEntry`, idempotent per shipment);
  - for short units: an open claim of short × supplier unit cost (at the same rate) and one `stock_gap` Finding;
  - for the 3PL dashboard source: one `StockCount` row with its line (system = shipped).
- **Claim** (`POST /api/shipments/:id/claim`): settle with an amount recovered (above 0, not above the claim) posts one entry DR 1010 / CR 1200 with source type `inventory_claim`; write-off posts nothing. Both close the Finding as `explained`. Only an open claim (409 otherwise).
- **Old rows:** a SQL migration maps `arrived` shipments to `received` (counted = quantity, short = 0, received date = arrived date). They keep their old ledger entry.
- **Landed cost on orders:** `fulfilOrder` sets `Order.landedCostTotal` (quantity × product cost at delivery) when stock moves. The revenue entry's COGS leg uses that amount (`cogsOfOrder`). On leaving delivered, the reversal uses the COGS amount of the entry it reverses (`cogsBooked`), and `landedCostTotal` goes back to null. Orders delivered before this change keep null.
- **Database:** new enum value `JournalSourceType.inventory_claim`; migrations `20261024100000_m4_arrived_shipments_to_received`, `20261024110000_m4_inventory_claim_source`.
- **Fixture:** 3 pending shipments from the mockup (tiles 3 / 1,500 / GH₵24,950).

### Verification
- Milestone branch after the merge: integration 1437 pass (11 skipped), unit 1613, frontend vitest 1057; builds and lints pass.
- Worked example on the fixture: total 8,700; counted 288; short 12; landed 30.21; product cost 30.1145; claim 324; one entry DR 1200 / CR 1010 of 8,700; second receive 409; settle 300 posts DR 1010 / CR 1200 once.
- API check on the production-dump copy (port 3300): CNY shipment without a rate 400; with a typed rate 1.6 the store total is 83.20; edit while pending 200; tiles 1 / 10 / 83.20; receive into the in-transit location 400, future date 400, counted above shipped 400; receive 8 of 10 at rate 1.5 gives total 78.00, landed 9.75, claim 15.00; second receive, edit and delete 409; settle above the claim 400, settle 10 200, second settle and write-off 409; old `/api/products/shipments` 404; no token 401. Database: entry 1200/1010 of 78 on the received date, claim entry 1010/1200 of 10 (`inventory_claim`), Logiswift 5 → 13, cost (61 × 5 + 8 × 9.75) ÷ 69 = 5.5507, a `StockCount` line 8 of 10, the Finding `explained`.
- The production-dump copies hold 0 `arrived` rows. The migration was proved on inserted test rows on `ecommerce_cod_m3copy_a`.
- Simplify: API answers before and after are equal, except the claim entry's source type.

### Open points
- The 3PL-dashboard count line of a receive compares counted with shipped, not with the whole location. Check that the COD-41 overview does not read it as a full location count.
- The `cogs` write in `receiveShipment` is a separate product update after the movement's cache update; one update would need an allow-list entry in the stock grep test.

### Key Files
- `backend/src/services/shipmentService.ts`, `routes/shipmentRoutes.ts` (new); `controllers/shipmentController.ts` (rewritten)
- `backend/src/services/glAutomationService.ts`, `stockService.ts`, `orderSideEffects.ts`, `financialSyncService.ts`, `routes/productRoutes.ts`, `server.ts`
- `backend/prisma/schema.prisma`, migrations `20261024100000_m4_arrived_shipments_to_received/`, `20261024110000_m4_inventory_claim_source/`
- `frontend/src/services/shipments.service.ts`
- Tests: `shipmentsApi.test.ts`, `shipmentReceive.test.ts`, `landedCostOrders.test.ts`; fixture `numbersFixture.ts`, `fixtureChecks/stock.ts`



---

## COD-41: Stock counts, inventory read APIs, Products API and nightly check (M4-T14 to T17)

- **Date:** 2026-10-24
- **Type:** feat
- **Branch:** `m4/cod-41` (with `m4/cod-41-schema`), merged into `feature/m4-stock-fulfilment` at 48a579c (schema b2cdcd6)
- **Commits:** c83aae7, a83448e (schema and fixture); d9ea3b4, 4ec4efd, d146682, 9efac3a, 6aee706, 84db221, 9459a93 (simplify), a30f0dd, 5c7c1e4

### Summary
- **Stock counts** (`/api/inventory/counts`, F-653): create a count at one location (date, source, note, lines). Each line stores system, counted and difference (counted − system); a line with a difference opens one `stock_gap` Finding. `POST /counts/:id/lines/:lineId/apply` with a reason (and an optional shipment for "Short on arrival") writes one adjustment movement; a second apply is 409.
- **Inventory reads:** `/api/inventory/overview` (location cards: on hand, reserved, products, in transit, count tag), `/levels`, `/product/:id/holders`, `/returns/summary`. Owner, admin, manager, accountant and stock keeper read; a sales rep and a delivery agent get 403. Value columns only for roles in `utils/costAccess.ts`.
- **Products API:** list with tabs (active, archived, all), month, on hand, reserved, days of cover, delivered in the month, delivery success and status; `/api/products/summary` (active and archived counts, best seller, average margin, low stock); create with `openingStock {quantity, locationId}` (needs `products:update_stock`); `stockQuantity` in a body is 400; archive and restore return open orders and units on hand; nullable `Product.maxDownloads` (the digital delivery used it and always fell back to 5).
- **Margin rule (owner-review item):** revenue-weighted average; a physical product with cost 0 or null shows no margin and is left out of the average; a digital product with cost 0 stays in. Fixture average 86.
- **Nightly check** (`stockCheckService`, Bull queue, 02:30 Africa/Accra): compares the product cache with the sum of levels and opens a Finding for a gap.
- **Bug found in Opus review:** the order edit check counted reserved units twice (84db221).

### Verification
- Milestone at 48a579c: build and lint pass; unit 1626; frontend vitest 1057; all 128 integration files pass. The first full run hit its time limit at load 17 (three lanes testing at once); the files that timed out pass when run alone.
- API check on the production-dump copy (port 3300): overview 200 (Logiswift 5,524 on hand, 925 reserved); levels 200; holders 200; returns summary 200; rep and agent 403 on overview and levels; no token 401; products list 200 with cost and margin for admin, none for a rep; summary 200 (4 active, best seller Magic Copybook 460, margin 88), rep 403; low stock 200; create with `stockQuantity` 400; create with opening stock 20 at Logiswift 201 and holders show 20; count 18 of 20 opens the line, holders show "off", apply 200 and holders show 18 and "matches", apply again 409, rep apply 403; archive 200 (archived tab lists it), restore 200.
- The copy needed the admin `products:update_stock` grant once (it was migrated with the COD-38 script version, before the grant). The production migration (T41) uses the current script, which grants it.

### Open points
- The read API's count `difference` is records − counted, while a count line's `difference` is counted − records. Fix in COD-44 so both use one sign.
- `/api/products/summary` is 403 for a role without cost access (it holds the average margin). An alternative is to leave out only the margin. Owner-review item.
- Create, update, archive and restore responses must pass through `forRole` (security review). Fixed in COD-43.
- Days of cover can be very large for a slow product (Dictamni on the copy: 32,011). The UI should cap the display.
- Follow-up done in COD-43: `StockCount.shipmentId` replaces the 7-field match for receive counts.

### Key Files
- `backend/src/services/stockCountService.ts`, `inventoryReadService.ts`, `productService.ts`, `stockCheckService.ts`, `queues/stockCheckQueue.ts`, `utils/costAccess.ts`
- `backend/src/routes/inventoryRoutes.ts`, `productRoutes.ts`; controllers for both
- `backend/prisma/migrations/20261024120000_m4_product_max_downloads/`
- Tests: `stockCountsApi.test.ts`, `inventoryReadApi.test.ts`, `inventoryFixtureApi.test.ts`, `productsApi.test.ts`, `stockCheck.test.ts`; `fixtureChecks/products.ts`
