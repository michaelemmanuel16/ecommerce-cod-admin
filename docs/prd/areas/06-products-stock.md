# Area 06: Products and stock

Part of the CodAdmin rebuild PRD. Builder B2. Date: 2026-10-18.
Range: F-600 to F-649 (Products) and F-650 to F-699 (Inventory and stock).

Terms used in this file:
- Holder or location: a place where stock sits. One of: own store, a 3PL warehouse, a delivery agent, or in transit.
- On hand: units at a location, by our records.
- Reserved: units at a location that are held for open orders. Reserved units are still on hand.
- In transit: units sent to a location that the receiver has not yet confirmed.
- Counted: units a person counted by hand (or read from the 3PL dashboard).
- Short: shipped (or sent) quantity minus counted (or received) quantity.
- GUESS: the sources did not prove the statement. The text says how to check it.

---

## 1. Scope

This file covers gap-matrix section 1.7 Products (PR-01 to PR-15) and section 1.8 Inventory (IN-01 to IN-10). It also covers the §3 broken items and §4 mockup fixes that touch products and stock, and the Settings rows that feed them.

Mockup screens: `products.html` (Products tab, Incoming shipments tab, product drawer, add shipment modal, receive shipment modal) and `inventory.html` (location cards, stock table, recent transfers, stock modals, transfer history modal).

Roles:
- Owner (`super_admin`) and `admin`: all actions.
- Stock keeper (`inventory_manager`): all stock and product actions. No money actions outside stock.
- `manager`: view only.
- Finance clerk (`accountant`): view, including cost and landed cost.
- Call rep and delivery agent: no access to these screens. They see only what the rep screen and the agent app show (files 08 and 09).

Decisions that apply (final, from `decisions.md` and the design doc):
- Decision 8: stock locations (own store, each 3PL, each agent), transfers, periodic counts against the 3PL dashboard, shipment receiving with counted against shipped, landed cost per unit.
- D2: landed cost per unit uses the counted quantity (288), not the shipped quantity (300).
- D4: money columns `Product.price` and the other Float money columns become Decimal in M0. New columns here are Decimal(19,4).
- O5, O6 (replace S3): supplier currencies convert to the store currency at the day's rate; the original amount and currency stay on the record. The store currency is not locked. Rates: daily automatic rate, manual override, per-day history. The stale-rate warning shows only for manual rates.
- D8: a paid digital order counts as delivered revenue. A free bundled digital item does not.
- G10: suggestion cards never change data in the first release. A card opens a pre-filled screen.

Pages in this file use the v2 style from `docs/mockups/v2/app.css`. Every button on these screens must work or be removed (fix #25).

---

## 2. Requirements: Products (F-600 to F-649)

### F-600: Product list, tiles and tabs
- Priority: P1. Milestone: M4.
- Description: The Products page lists every product with price, cost, margin, stock, days of cover, units delivered in the month and delivery success. Four tiles sit above the table. Tabs split Active and Archived. Cost and margin come from the landed cost (F-611), not from a typed number. This replaces `Products.tsx`.
- Current app: `frontend/src/pages/Products.tsx`, `GET /api/products`, `GET /api/products/low-stock` (`backend/src/controllers/productController.ts`). Columns today: Product, SKU, Category, Price, Warehouse, With Agents, Status, Actions.
- Mockup: `products.html#products` (list, tiles, tabs, agent cards).
- Acceptance criteria:
  - [ ] Columns: Product (expand arrow, image, name, note), SKU, Price, Cost, Margin, Stock (units and days of cover), Delivered in month, Delivery success, Status, Actions.
  - [ ] Search works on name, SKU and category (as today).
  - [ ] Tabs: Active, Archived, All. Each shows its count. Default tab is All.
  - [ ] Tile "Active products" shows the active count and the archived count (4 and 2 in the sample).
  - [ ] Tile "Best seller this month" shows the product with the most delivered units in the month. Sample: Copybook set, 306 delivered (see F-610 for why 306).
  - [ ] Tile "Average margin" is the revenue-weighted margin: sum of units × (price − cost) ÷ sum of units × price, over delivered units in the month, physical and digital. On 1 to 17 Oct data this is 86% (decision R1: the written formula, not the mockup 66%).
  - [ ] Tile "Low stock" counts physical active products whose days of cover are under their low-stock days.
  - [ ] Margin per row is (price − cost) ÷ price, before delivery fees. Copybook set: (249 − 30) ÷ 249 = 88%. Refill pens 70%. Pencil grip trainer 69%. Smart Parent's Home Study Guide 95%.
  - [ ] Days of cover = total on hand across active locations ÷ average units delivered per day over the last 14 days (by delivery date). If the average is 0, show "No sales" and do not flag low stock.
  - [ ] Status tag: Low stock (days of cover under the limit), Active, Digital, Archived, Out of stock (physical, on hand 0 or less).
  - [ ] Delivered in month = sum of item quantity on delivered orders with `deliveryDate` in the month, per product. The same query feeds Finance "Profit by product" and Reports (F-610).
  - [ ] Delivery success per product = delivered ÷ (delivered + failed + returned) on closed orders that contain the product, same period. Digital products show "—".
  - [ ] Cost and margin columns show only for roles that may see cost (owner, admin, manager, finance clerk, stock keeper). `GET /api/products` returns no cost, margin or per-holder stock to call reps and delivery agents.
  - [ ] Every row action works: Edit (F-601), expand (F-603). Header buttons: Add product (F-601), Add shipment (F-605).
- Data: `Product` gains `lowStockDays` Int? (null means use the default from Settings → Operations). `lowStockThreshold` (units) is retired; see F-601. No other column. Derived values (days of cover, delivered, margin) are computed, not stored.
- API: `GET /api/products` adds query `tab=active|archived|all`, `month=YYYY-MM`. Response adds per product: `onHandTotal`, `reservedTotal`, `daysOfCover`, `deliveredInPeriod`, `deliverySuccess`, `marginPct`. New `GET /api/products/summary` returns the four tile values.
- Permissions: view for `super_admin`, `admin`, `manager`, `inventory_manager`, `accountant`. Not for `sales_rep` or `delivery_agent` (they keep the minimal list used by the New order form, without cost).
- Edge cases and errors:
  - A product with no delivered orders shows 0 delivered and "—" for success.
  - A digital product has no stock, no days of cover and no holder table.
  - Month with no data: tiles show 0 and "—", not errors.
  - Decision R1 settles this (computed numbers follow the written formula, not the mockup sample). The mockup tile "Average margin 66%" cannot be reproduced from the sample data. The weighted formula gives 86% on the Finance product table (units 306, 172, 89, 58). The PRD uses the weighted formula.
  - The mockup days of cover (copybook 7 days, pens 12 days) cannot be reproduced exactly. Decision R1 settles this: the PRD uses the written 14-day average.
- Tests:
  - Unit: margin, weighted margin, days of cover (rate 0, rate above 0), status tag rules.
  - Integration: `GET /api/products?tab=archived`; delivered-in-period equals the Finance profit-by-product figure on one fixture; a call rep gets no cost field.
  - E2E: owner opens Products, switches tabs, searches by SKU, sees the four tiles.

### F-601: Add and edit product drawer
- Priority: P1. Milestone: M4.
- Description: A side drawer adds or edits a product. It replaces the full page `ProductForm`. Physical products track stock. Digital products send a download link. Cost per unit is read-only once a shipment has been received, because landed cost sets it (F-611).
- Current app: `frontend/src/pages/ProductForm.tsx` (`/products/new`, `/products/:id/edit`); `POST /api/products`, `PUT /api/products/:id`. Fields today: productType, name, description, sku, category, image, price, cogs, stockQuantity, lowStockThreshold, isActive, digitalFileUrl, digitalFileType, downloadLinkExpiryHours.
- Mockup: `products.html` (product drawer).
- Acceptance criteria:
  - [ ] Product type toggle: Physical or Digital. The type cannot change after the product has any order.
  - [ ] Basics: name (required), description, SKU (required, upper case, unique per tenant), category (required), images (drop zone; png, jpg, gif up to 5 MB, uses `POST /api/upload`).
  - [ ] Pricing: selling price (required), cost per unit. A live line shows "Margin before delivery" (price − cost) ÷ price.
  - [ ] Cost per unit is editable only while the product has no received shipment. After the first received shipment the field is read-only with the text "Set by landed cost from shipments".
  - [ ] Physical: "Starting stock" shows only on create. It needs a location (default: the first active 3PL or own store) and writes an `opening` movement (F-651). On edit the field is disabled with the text "Change stock with Allocate stock or Adjust quantity".
  - [ ] Physical: "Low stock alert at" is in days of cover. Empty means use the default from Settings → Operations (14 days).
  - [ ] Digital: file URL (required), file type (PDF, EPUB, MP3, MP4 video, ZIP, Other), link expiry in hours (default 72), max downloads (default 5; this field is not in the mockup, add it).
  - [ ] Existing `digitalFileType` values map: pdf to PDF, ebook to EPUB, audio to MP3, video to MP4 video, zip to ZIP, other to Other.
  - [ ] Checkbox "Product is active and can be ordered".
  - [ ] Save shows field errors inline. Cancel asks to confirm only if the form changed.
  - [ ] The live margin uses the same function as the list (F-600).
- Data: `Product`: add `lowStockDays` Int?; `Product.sku` unique per tenant (not global); `Product.price` and `Product.cogs` Decimal(19,4) (D4); retire `lowStockThreshold` and `batch_quantity` from the UI (keep the columns until a cleanup migration). Migration: set `lowStockDays` to null for all products (a unit threshold cannot convert to days).
- API: `POST /api/products`, `PUT /api/products/:id` accept `lowStockDays`, `openingStock {locationId, quantity}` (create only), `maxDownloads`. `stockQuantity` is no longer accepted.
- Permissions: `products:create` and `products:update` (owner, admin, stock keeper). Cost field needs `products:update`.
- Edge cases and errors:
  - Duplicate SKU in the same tenant: "This SKU is already used."
  - Opening stock with no active location: the form asks the user to add a location first (F-650).
  - Price 0 or cost above price: allowed, with a warning "Margin is negative".
  - Digital product with a file URL that does not start with http(s): reject.
- Tests:
  - Unit: SKU upper-casing and per-tenant uniqueness; file type mapping; margin line.
  - Integration: create physical product with opening stock creates one `StockLevel` and one `opening` movement; edit cannot send `stockQuantity`; two tenants may use the same SKU.
  - E2E: add a physical product, add a digital product, edit price, see the list update.

### F-602: Archive and restore a product
- Priority: P2. Milestone: M4.
- Description: Archive replaces delete. An archived product cannot be ordered and does not show in new checkout forms. It keeps its history. The owner can restore it.
- Current app: `DELETE /api/products/:id` (soft delete), delete icon with confirm in `Products.tsx`.
- Mockup: `products.html` (checkbox "Product is active", tab Archived, status tag Archived).
- Acceptance criteria:
  - [ ] The product row menu has "Archive" (and "Restore" in the Archived tab). The delete icon is removed.
  - [ ] Archive asks for confirmation and shows how many open orders and how many units on hand the product has.
  - [ ] An archived product is hidden from the New order form product pick list and from the checkout form product pick list.
  - [ ] A checkout form that uses an archived product shows the existing "can't take orders yet" guard (CF-05, file 05 owner) and the public form shows "not available".
  - [ ] Archived products keep their stock rows and show in Inventory with an "Archived" tag until stock is zero.
  - [ ] Orders already placed with the product are not changed.
- Data: reuse `Product.isActive`. No new column.
- API: new `POST /api/products/:id/archive` and `POST /api/products/:id/restore`. `DELETE /api/products/:id` is removed from the API for products with any order history; for products with none, keep it for owner only (clean-up of test data).
- Permissions: owner, admin, stock keeper.
- Edge cases and errors:
  - Archive a product that is in an active checkout form: allow, with the warning above.
  - Restore a product whose SKU now clashes with another active product: block with a message.
- Tests:
  - Integration: archived product is absent from `GET /api/products?forOrder=true`; restore brings it back; delete of a product with orders returns 409.
  - E2E: archive, see it in the Archived tab, restore.

### F-603: Stock by holder (read-only expand)
- Priority: P1. Milestone: M4.
- Description: Expanding a physical product shows one table with a row per holder. It is read-only. Actions live in Inventory (fix #4, F-655). A link "Open in Inventory" goes to the Inventory page filtered to this product. Logiswift and every other 3PL appear as holders.
- Current app: `AgentStockPanel` inside `Products.tsx` with History, Allocate, Transfer and Return buttons; `GET /api/agent-inventory/product/:id`.
- Mockup: `products.html` (expanded row "Stock by holder"). The mockup shows action buttons in the expansion. The PRD removes them (fix #4).
- Acceptance criteria:
  - [ ] Columns: Holder (name and type), Allocated, In transit (with tag "Awaiting agent" for agents), Delivered, Returned, On hand, Value (on hand × cost).
  - [ ] Allocated = sum of movements into the holder (allocation, transfer in, receipt, opening). Delivered = sum of `order_fulfillment` movements out. Returned = sum of `return_to_warehouse` movements out. These come from the movement ledger (F-651), not from stored counters.
  - [ ] A total row sums every column. On hand total equals the sum of the holder rows.
  - [ ] A note appears for each location with a count gap: "Our records say 100 on hand at Logiswift. They count 88." The note links to the count (F-653).
  - [ ] A note names active holders with none of this product ("Kasapa Express holds none of this product.").
  - [ ] Digital product expansion: "Digital product, no stock to track", link expiry hours, number of links sent this month, file name and type.
  - [ ] The button "Open in Inventory" opens `/inventory?product=<id>`. There are no Allocate, Transfer, Return or Adjust buttons here.
- Data: none new.
- API: `GET /api/inventory/product/:productId/holders` (new, replaces `GET /api/agent-inventory/product/:id`).
- Permissions: same as F-600.
- Edge cases and errors:
  - Negative on hand (F-657) shows in red with the tag "Negative".
  - Archived holder with stock still shows.
- Tests:
  - Unit: holder row maths (allocated − in transit − delivered − returned equals on hand, within recorded adjustments).
  - Integration: totals equal the sum of rows on a fixture with 4 holders.
  - E2E: expand copybook set, click Open in Inventory.

### F-604: Incoming shipments tab
- Priority: P1. Milestone: M4.
- Description: The second Products tab lists shipments on the way and shipments that arrived, with cost and landed cost per unit. Three tiles sum what is pending.
- Current app: `IncomingInventoryView`, `GET /api/products/shipments`, `PATCH /api/products/shipments/:id` (`shipmentController.ts`).
- Mockup: `products.html#incoming`.
- Acceptance criteria:
  - [ ] Tiles: Pending shipments (count and the next expected date), Units on the way (and the number of products), Cost to land them (store currency).
  - [ ] Sample values: 3 pending, 1,500 units across 3 products, GH₵24,950. The 24,950 is the sum of totals: copybook 400 × 27.90 + 640 + 0 + 200 = 12,000; pens 600 × 9.50 + 1,200 + 600 + 0 = 7,500; grip trainer 500 × 8 + 900 + 450 + 100 = 5,450.
  - [ ] Tabs: All, Pending, Arrived, with counts.
  - [ ] Columns: Product, Supplier, Qty, Unit cost, Shipping, Customs, Other, Total, Landed per unit, Expected, Received at, Counted, Short, Status, Actions.
  - [ ] For a pending shipment, "Landed per unit" = total ÷ quantity shipped. For an arrived shipment it = total ÷ counted (F-611).
  - [ ] Money shows in the store currency. If the shipment currency differs, the cell shows the store-currency value and a small line with the original amount (for example "¥ 6,200").
  - [ ] Pending rows have "Mark arrived" (opens F-606), "Edit" and "Delete" (F-607). Arrived rows are read-only.
  - [ ] Footer text: "Landed cost per unit is the total divided by the units counted on arrival (the quantity until then)."
- Data: `InventoryShipment` changes in F-605, F-606.
- API: `GET /api/products/shipments?status=` adds the tile totals in the response. Routes move to `/api/shipments` (new `shipmentService`).
- Permissions: view for owner, admin, manager, stock keeper, finance clerk.
- Edge cases and errors:
  - No shipments: empty state with an "Add shipment" button.
  - A shipment in a foreign currency with no rate for the day: show the original amount and the tag "No rate", and block Mark arrived until a rate exists (F-605).
- Tests:
  - Unit: tile sums on the sample fixture equal 3, 1,500, 24,950.
  - Integration: filter by status.
  - E2E: open tab, filter Pending.

### F-605: Add shipment with supplier currency
- Priority: P1. Milestone: M4.
- Description: The owner records what is on the way and what it costs. A shipment has one supplier currency. The modal converts it to the store currency with the rate for the day (O5). The live "Landed cost per unit" updates as the user types.
- Current app: `AddShipmentModal`, `POST /api/products/shipments`. Fields: product, supplier, quantity, unitCost, shippingCost, customsDuties, otherCosts, expectedArrivalDate, notes.
- Mockup: `products.html` (modal "Add incoming shipment"). The mockup enters all costs in GH₵ even for a Guangzhou supplier.
- Acceptance criteria:
  - [ ] Fields: Product (physical products only), Supplier, Quantity, Currency (store currency by default, then the extra currencies from Settings → Currencies and FX), Unit cost, Shipping, Customs and duties, Other costs, Expected arrival, Notes.
  - [ ] All four cost lines use the one shipment currency (GUESS: shipping may be paid in another currency; check with the owner; if yes, split per line later).
  - [ ] When the currency differs from the store currency, the modal shows "Rate: 1 CNY = GH₵ x.xx (today's rate)" and the converted total. The user may type a manual rate. A manual rate is stored with the shipment.
  - [ ] Live "Landed cost per unit" = (quantity × unit cost + shipping + customs + other) × rate ÷ quantity, in store currency, shown with 2 decimals.
  - [ ] Save needs product, quantity above 0 and a unit cost of 0 or more.
  - [ ] The shipment is created with status Pending. No stock changes. No ledger entry.
  - [ ] The rate used when the shipment arrives is set in F-606, not here. Here the rate is an estimate for display.
- Data: `InventoryShipment` adds `currency` (String, ISO code, default store currency), `fxRate` (Decimal(19,8), rate to store currency, nullable until arrival), `fxRateSource` (`auto`, `manual`). Cost columns become Decimal(19,4) (now Decimal(10,2)). `totalCost` is kept in the shipment currency; add `totalCostStore` (Decimal(19,4)) set on arrival. Depends on `FxRate` (F-1200 range, Builder C: Currencies and FX, daily rate, manual override, per-day history).
- API: `POST /api/shipments`, `PATCH /api/shipments/:id` accept `currency`, `fxRate`. `GET /api/fx/rate?from=&to=&date=` (F-1200 range) is used by the modal.
- Permissions: `products:update_stock` (owner, admin, stock keeper).
- Edge cases and errors:
  - Currency not in the extra currency list: not selectable.
  - The store currency can change at any time (O6). A shipment keeps its own currency and its stored rate, so a store-currency change does not rewrite it (PRD section 5.7).
  - Rate missing for the day: use the latest earlier rate and show its date. If none exists, the user must type a manual rate.
- Tests:
  - Unit: landed cost per unit in a foreign currency, rounding to 4 decimals stored and 2 shown.
  - Integration: create a shipment in CNY with a manual rate; reject a negative quantity.
  - E2E: add the 22 Oct copybook shipment (400 units, unit 27.90, shipping 640, other 200) and see GH₵30.00.

### F-606: Receive shipment (counted against shipped)
- Priority: P0. Milestone: M4.
- Description: When a shipment arrives, a person counts the units and enters the count. Stock is added at the chosen location for the counted quantity only. The short quantity is recorded. Landed cost per unit is recalculated on the counted quantity (D2). The cost of the whole shipment goes into inventory, so the cost of the short units spreads over the units that arrived.
- Current app: `PATCH /api/products/shipments/:id/arrive` in `shipmentController.ts`. It adds the full shipped quantity to `Product.stockQuantity`, sets cost as a weighted average using the shipped quantity, and posts DR 1200 Inventory / CR 1010 Cash in Hand.
- Mockup: `products.html` (modal "Receive shipment"); `inventory.html` (recent transfer "Supplier, Accra to Logiswift, Copybook set × 300, Received, 12 short, Logiswift booked 288").
- Acceptance criteria:
  - [ ] Fields: Received at (own store, any 3PL location, any agent location, only active locations), Received date (default today), Units shipped (read-only), Units counted (default = shipped, minimum 0, maximum = shipped), "Short or damaged" (live = shipped − counted), Note, Rate (only for foreign currency, default the rate of the received date, editable), "Landed cost per unit" (live, on counted).
  - [ ] Save button text: "Save and add to stock".
  - [ ] On save: the shipment status becomes Arrived. `receivedAt`, `receivedById`, `quantityCounted`, `shortQuantity` and `destinationLocationId` are set. `StockLevel` at the destination increases by the counted quantity. One `receipt` movement is written (F-651).
  - [ ] Worked example (9 Oct copybook shipment): 300 shipped at 27.00, shipping 450, customs 0, other 150. Total = 300 × 27 + 450 + 150 = GH₵8,700. Counted 288. Short 12. Landed cost per unit = 8,700 ÷ 288 = GH₵30.21 (not 8,700 ÷ 300 = GH₵29.00).
  - [ ] The ledger entry is one entry for the full shipment total in store currency (DR 1200 Inventory, CR 1010 Cash in Hand), as today. It is posted at the rate on the received date.
  - [ ] If short is above 0, F-608 opens a supplier claim record on the shipment.
  - [ ] If counted is 0, the shipment is marked Arrived with no stock added and a claim for the full value.
  - [ ] The receive action is atomic and runs once. A second call returns an error and changes nothing.
  - [ ] The destination location can be a 3PL (like Logiswift). The owner enters the count the 3PL gave (source: "3PL dashboard" or "own count"). This count also writes a `StockCount` row at that location for that date (F-653) so the count and the receipt agree.
- Data: `InventoryShipment` adds `receivedAt` (DateTime), `receivedById` (User), `quantityCounted` (Int), `shortQuantity` (Int), `destinationLocationId`, `fxRate`, `totalCostStore`, `landedCostPerUnit` (Decimal(19,4)). `ShipmentStatus` enum adds `received` (keep `arrived` as a read alias until the migration completes; map old `arrived` rows: counted = quantity, short = 0, destination = the default 3PL location, receivedAt = `arrivedAt`).
- API: `POST /api/shipments/:id/receive {locationId, receivedDate, quantityCounted, fxRate?, note?, countSource?}` replaces `PATCH /shipments/:id/arrive`. Business logic moves from `shipmentController.ts` to a new `shipmentService` (design rule 1).
- Permissions: `products:update_stock` (owner, admin, stock keeper).
- Edge cases and errors:
  - Counted above shipped: block with "Counted cannot be higher than shipped. Use Adjust to add found stock."
  - Shipment already received: error "Already received."
  - Destination inactive: not selectable.
  - Ledger failure rolls back the stock change.
  - The mockup shows the landed cost as GH₵30.00 for this shipment. The calculation gives GH₵30.21 (decisions D2, R1: the written formula wins over the mockup sample). The app stores 30.2083 and shows 30.21.
- Tests:
  - Unit: landed cost on counted (8,700 ÷ 288); counted 0; counted equals shipped.
  - Integration: receive writes status, one movement, one ledger entry, one stock increase of 288; second receive fails; foreign-currency receive uses the stored rate.
  - E2E: receive the 9 Oct shipment at Logiswift with 288; see "12 short" tag and the claim chip.

### F-607: Edit and delete a pending shipment
- Priority: P2. Milestone: M4.
- Description: The owner can change or remove a shipment that has not arrived. The current app has these actions. The mockup does not show them. They stay.
- Current app: `PATCH /api/products/shipments/:id`, `DELETE /api/products/shipments/:id`, row actions in `IncomingInventoryView`.
- Mockup: not in mockup. Build the actions in the shipments table: a pencil icon (opens the Add shipment modal filled) and a bin icon (confirm dialog with the shipment name and quantity, one confirm pattern for the whole app, fix #29).
- Acceptance criteria:
  - [ ] Edit and delete show only on Pending rows.
  - [ ] Edit opens the same modal as F-605, with all fields filled.
  - [ ] Delete asks "Delete the shipment of 400 Magic Groove copybook set from Accra Print House?" and then removes it.
  - [ ] An Arrived shipment cannot be edited or deleted. The row shows a lock icon with the text "Fix stock with Adjust".
  - [ ] Both actions write an audit log row.
- Data: none new.
- API: `PATCH /api/shipments/:id`, `DELETE /api/shipments/:id` return 409 for received shipments.
- Permissions: `products:update_stock`.
- Edge cases and errors: editing the product of a pending shipment is allowed. Editing the quantity after a partial count is not possible because there is no partial receive.
- Tests: integration (409 on received); e2e (edit quantity, delete).

### F-608: Supplier claim for a short shipment
- Priority: P2. Milestone: M4.
- Description: When a shipment arrives short, the owner needs a record to claim the missing units from the supplier. The mockup only shows a toast "Flagged for supplier claim". The data model has no claim. Build a light record on the shipment itself, not a new module.
- Current app: none.
- Mockup: `products.html` (toast text after Save and add to stock). Not in mockup otherwise. Build: a chip "Claim open, 12 units, GH₵324" on the shipment row; a small panel on the shipment with status buttons.
- Acceptance criteria:
  - [ ] When `shortQuantity` is above 0, the shipment gets `claimStatus = open` and `claimAmount = shortQuantity × unit cost` in store currency. Sample: 12 × 27.00 = GH₵324.
  - [ ] The user can set the claim to Settled (with an amount recovered and a note) or Written off (with a note).
  - [ ] An open claim shows in the Findings list as type "stock gap" (Builder C owns the Findings list; this file creates the Finding row) and in the Inventory suggestion card for that location.
  - [ ] Settling a claim does not post to the ledger in this release. The owner records the refund as an expense or journal entry. The panel says so. (GUESS: owner may want an auto entry; ask.)
- Data: `InventoryShipment` adds `claimStatus` enum (`none`, `open`, `settled`, `written_off`), `claimAmount` Decimal(19,4), `claimRecovered` Decimal(19,4)?, `claimNote` String?.
- API: `POST /api/shipments/:id/claim {status, recovered?, note?}`.
- Permissions: owner, admin, stock keeper (set status); finance clerk (view).
- Edge cases and errors: no claim when short is 0. A claim cannot be re-opened after Settled.
- Tests: unit (claim amount); integration (receive 288 of 300 creates an open claim of GH₵324 and one Finding); e2e (settle a claim).

### F-609: Products suggestion cards
- Priority: P3. Milestone: M11.
- Description: The page shows one to three cards that find a real problem. In the first release a card opens a screen. It does not write data (G10). The cards read from the problem finders in the tool registry (design §7.3).
- Current app: none.
- Mockup: `products.html` (two cards: refill pens sell with copybook orders; copybook set runs out in 7 days).
- Acceptance criteria:
  - [ ] Card "Runs out in N days": shown for each physical product with days of cover under its limit. Button "See the shipment" opens the Incoming tab filtered to that product. The text names the next expected shipment and whether it lands before the stock-out date.
  - [ ] Card "Add-on sells with the main product": share = delivered orders with the add-on ÷ delivered orders with the main product (172 ÷ 306 = 56% on the Finance figures; the mockup text "35%, 116 of 328" uses figures that fix #13 removes). Button opens the checkout form editor Upsells tab (file 05, Builder B1) for the main product. The "Make a bundle" action is dropped: the product model has no bundle (GUESS: the owner asked only for the card).
  - [ ] Each card has Dismiss. A dismissed card returns after 7 days if the cause remains (GUESS: check the period).
  - [ ] No card shows a number that the KPI services do not return.
- Data: none (cards are computed).
- API: tool registry problem finders (`stock_gaps_by_location`, `products_low_cover`, `addon_attach_rate`); `GET /api/products/suggestions`.
- Permissions: roles that can view Products.
- Edge cases and errors: no problem found means no cards (no empty box).
- Tests: unit (attach rate); integration (card text uses the same numbers as F-600); e2e (click See the shipment).

### F-610: One source for product delivered counts
- Priority: P0. Milestone: M1.
- Description: The mockups disagree on how many units were delivered (copybook set 328 on Products, 306 on Finance and Reports; pens 116 against 172; grip trainer 58 against 89; guide 63 against 58). The right figures are the Finance and Reports ones: copybook set 306, pens 172, grip trainer 89, guide 58 (fix #13). The Products page, Finance, Reports, the stock holder table and the MCP tools must read one service.
- Current app: `analyticsService` product performance reads line totals for every order status (audit risk 1). `Products.tsx` has no delivered column.
- Mockup: `products.html` (328, 116, 58, 63), `finance.html` and `reports.html` (306, 172, 89, 58).
- Acceptance criteria:
  - [ ] One function `productDeliveredUnits(productId, from, to)` counts order item quantity on orders with status `delivered` (and `digital_delivered` for paid digital items, D8) and `deliveryDate` in range.
  - [ ] Finance "Profit by product", Reports "Products and profit", Products "Delivered in month" and the MCP tool `products_inventory` all call it.
  - [ ] On the 1 to 17 Oct fixture: copybook set 306, refill pens 172, pencil grip trainer 89, Smart Parent's guide 58, Dictamni cream 10. Revenue per line: 306 × 249 = GH₵76,194 (shown GH₵76,100 in the mockup; GUESS: a rounding choice; check), 172 × 40 = 6,880, 89 × 35 = 3,115, 58 × 59 = 3,422.
  - [ ] Item units are not orders. The total of delivered orders stays 376 (NUMBERS.md). A test asserts that 376 orders contain 635 item units in the fixture and never compares the two.
  - [ ] The "Delivered" column of the holder table (F-603) is a ledger sum per holder and cannot exceed that holder's delivered orders' unit count.
  - [ ] A free bundled digital item (not a paid order line) is not counted (D8).
- Data: none.
- API: shared service method; no new endpoint.
- Permissions: as the callers.
- Edge cases and errors:
  - Conflict found: the mockup holder table lists copybook delivered 176 + 98 + 70 + 44 = 388, which is more than 306 and does not match partner delivered orders (Logiswift 220, Kofi 82, Esi 48, Kwesi 26). It is sample data. The real column comes from F-651 movements.
  - Conflict found: 328 equals the Confirm agent's confirmed count (NUMBERS.md). It looks copied by mistake. 306 is the right copybook figure.
  - Items on cancelled or returned orders are excluded.
- Tests: integration (one fixture, five callers return the same number); unit (digital paid versus free bundle).

### F-611: Landed cost on counted quantity and product cost
- Priority: P0. Milestone: M4.
- Description: Landed cost per unit is the shipment total in store currency divided by the counted quantity (D2). It sets the product cost. Each delivered order stores the cost of its units at delivery time so later cost changes do not rewrite history.
- Current app: `shipmentController.ts` divides by the shipped quantity and updates `Product.cogs` as a weighted average of existing stock and the new shipment. `Order` has no cost snapshot.
- Mockup: `products.html` (footer text: "updates the product cost when the shipment arrives"; cost GH₵30).
- Acceptance criteria:
  - [ ] Landed cost per unit = (quantity shipped × unit cost + shipping + customs + other) × rate ÷ quantity counted.
  - [ ] On receive, `Product.cogs` becomes the weighted average: (units on hand across all locations × current cost + counted × landed cost) ÷ (units on hand + counted). The current code already uses a weighted average, so this stays. The footer text in the mockup ("updates the product cost") must say "updates the average product cost".
  - [ ] If on hand is 0 or less, cost = landed cost.
  - [ ] When an order becomes `delivered`, set `Order.landedCostTotal` = sum of item quantity × the product cost at that moment (Decimal). It never changes afterwards unless the order is returned (then it is reversed).
  - [ ] Profit per delivered order before ads (Builder C KPI) reads this value.
  - [ ] Owner-set cost GH₵30 per set on 18 Oct stands as the starting cost until the first shipment is received after migration.
  - [ ] The ledger entry on delivery uses the same cost for COGS.
- Data: `Order.landedCostTotal` Decimal(19,4) (design §5.3). `Product.cogs` Decimal(19,4). Backfill `landedCostTotal` for delivered orders as quantity × current `cogs` (GUESS: older months used an older cost; D5 says Aug and Sep stay as booked, so do not restate; leave the backfill empty for orders before 1 Oct 2026 and show "as booked").
- API: none new; computed in `shipmentService.receive` and `orderService` on delivery.
- Permissions: system.
- Edge cases and errors:
  - GUESS: weighted average is not stated in the owner decisions. The mockup says the cost updates to the new landed cost. Check with the owner which they want. The PRD keeps the weighted average because the code does it today and it protects margin when stocks at two costs mix.
  - Shipment currency conversion uses the rate stored with the receive action.
- Tests: unit (weighted average, zero stock, 8,700 ÷ 288); integration (delivering two orders before and after a new shipment keeps each order's own cost).

---

## 3. Requirements: Inventory and stock (F-650 to F-699)

### F-650: Stock locations
- Priority: P0. Milestone: M4.
- Description: A stock location is a place that holds stock: own store, a 3PL warehouse, a delivery agent, or in transit. Today there is no location model. All stock is "the warehouse" plus per-agent rows, and Logiswift is a delivery agent. The owner can set up their own store.
- Current app: none (`Product.stockQuantity` and `AgentStock`).
- Mockup: `inventory.html` (location cards; the "Own store, Coming soon" card with the button "Set up own store").
- Acceptance criteria:
  - [ ] Location types: `own_store`, `partner_3pl`, `agent`, `in_transit`. `in_transit` is one system location per tenant. It has no card.
  - [ ] A location of type `agent` or `partner_3pl` is linked to one `User` (person for agent, company for 3PL). It is created when the user is created with the Delivery role, and by migration for existing users.
  - [ ] "Set up own store" opens a small form: name (required), address (optional). It creates an `own_store` location. The tenant may have more than one.
  - [ ] A location can be deactivated only when its on-hand and in-transit quantities are 0.
  - [ ] The migration creates: a 3PL location for Logiswift (it is a delivery agent row today), agent locations for Kofi Appiah, Esi Badu, Kwesi Amoah, a 3PL location for Kasapa Express (trial), and one in-transit location.
  - [ ] Location names are unique per tenant.
- Data: new `StockLocation` {id, tenantId (required), type, name, userId?, address?, isActive, createdAt}. Unique (tenantId, name). Unique (tenantId, userId) where userId is not null. In the tenant-scoped model list (design rule 6).
- API: `GET /api/stock-locations`, `POST /api/stock-locations` (own store only), `PATCH /api/stock-locations/:id` (name, address, active).
- Permissions: view for owner, admin, manager, stock keeper, finance clerk; create and edit for owner, admin, stock keeper.
- Edge cases and errors: a user with the Delivery role is deactivated: the location stays; the page shows a tag "Person inactive" and blocks new allocations to it.
- Tests: unit (deactivate rules); integration (migration creates the five named locations, tenant isolation with two tenants); e2e (set up own store).

### F-651: Stock levels and the movement ledger
- Priority: P0. Milestone: M4.
- Description: Stock per product per location lives in `StockLevel`. Every change writes one movement row. `StockLevel` replaces `AgentStock` and the warehouse number in `Product.stockQuantity`. The existing `InventoryTransfer` model is the movement ledger, extended with locations. Nothing else may change a quantity.
- Current app: `Product.stockQuantity`, `AgentStock` (per agent, with counters), `InventoryTransfer` (agent only), `backend/src/services/agentInventoryService.ts`.
- Mockup: `inventory.html` and `products.html` (all tables read from this).
- Acceptance criteria:
  - [ ] `StockLevel.quantity` is the on-hand quantity. It may be negative (see F-657).
  - [ ] Every quantity change goes through one `stockService` (new, replaces `agentInventoryService` for writes). It runs in the caller's database transaction and writes the movement row and the level change together.
  - [ ] Movement types (`TransferType` enum): `allocation`, `order_fulfillment`, `agent_transfer`, `return_to_warehouse`, `adjustment` (exist today); new: `receipt` (shipment received), `opening` (starting stock), `order_reversal` (delivered order returned), `count_adjustment` (applied from a stock count).
  - [ ] A movement row has: type, product, quantity (always positive), from location, to location, order (if any), shipment (if any), reason, note, created by, status (F-654).
  - [ ] `Product.stockQuantity` stays as a cached sum of on-hand over active physical locations. `stockService` updates it in the same transaction. A nightly job compares the cache with the sum and opens a Finding if they differ.
  - [ ] Reserved quantity is computed: at a holder's location, the sum of item quantity on orders assigned to that holder in status `confirmed`, `preparing`, `ready_for_pickup`, `out_for_delivery`. Reserved units are still on hand.
  - [ ] Available to sell = on hand − reserved, summed over active locations.
  - [ ] The public checkout stock check uses available to sell, not the raw cached number (replaces `publicOrderService.ts` line 62).
  - [ ] Every new model carries a required `tenantId` and is in the scoped list (design rule 6).
- Data: new `StockLevel` {id, tenantId, locationId, productId, quantity Int, updatedAt}, unique (locationId, productId). `InventoryTransfer` adds `fromLocationId`, `toLocationId`, `shipmentId?`, `status`, `receivedQuantity Int?`, `receivedAt?`, `receivedById?`, `reason` (enum), `reversedAt?`. `fromAgentId` and `toAgentId` are kept for old rows only. `AgentStock` is read-only after migration and is dropped in a later milestone.
- API: `GET /api/inventory/levels?locationId=&productId=`; writes only through F-654, F-655, F-653, F-606. `/api/agent-inventory/*` write routes are removed when the new routes ship; `GET` routes stay for one release as aliases.
- Permissions: view for owner, admin, manager, stock keeper, finance clerk; the rep and agent never call these.
- Edge cases and errors:
  - Two requests change the same level at once: row lock on the level (`SELECT ... FOR UPDATE`) as `agentInventoryService` does today for the warehouse.
  - A movement for a digital product is rejected.
- Tests:
  - Unit: reserved, available, cache sum.
  - Integration: every movement type changes exactly one source and one target; tenant isolation (a level of tenant A is invisible to tenant B); concurrent allocations never create stock.
  - E2E: none alone (covered by F-652, F-654).

### F-652: Inventory page: location cards and stock table
- Priority: P1. Milestone: M4.
- Description: One page shows where every unit sits and where our records and the 3PL count disagree. It replaces `AgentInventoryManagement`. It is the owner screen for all stock actions (fix #4).
- Current app: `frontend/src/pages/AgentInventoryManagement.tsx` at `/agent-inventory` (not in the sidebar), tabs Summary, Detail, History.
- Mockup: `inventory.html`.
- Acceptance criteria:
  - [ ] The page is in the sidebar group Stock.
  - [ ] Header buttons: Transfer history (F-659), Move stock (menu: Allocate to an agent, Transfer between agents, Return to warehouse, Adjust a quantity; opens F-655), Start stock count (F-653).
  - [ ] One card per active location. Card fields: name, type and town, On hand, Reserved, Products (count), In transit (agents), a tag ("Matches" or "12 units off") from the latest count, and the count source and date ("Logiswift count, 15 Oct"). Card buttons depend on type (see F-655 for the rules).
  - [ ] The card "Own store" shows "Set up own store" when none exists (F-650).
  - [ ] Table "Stock by location": Product, Location, On hand, Reserved, In transit, "Our records vs <count source>", Difference, Actions (icons: Allocate, Return, Transfer, Adjust). One row per location and product with stock or with a recent count.
  - [ ] Difference = our records − the latest count at that location for that product. A tag shows "Matches" or "−12 units". A count older than the latest movement after it shows "Count is old" instead of a gap (GUESS: a stale count can mislead; check wording).
  - [ ] Sample values must hold: Logiswift copybook on hand 100, reserved 34, count 88, difference 12; Kofi copybook 36 on hand, 11 reserved, 20 in transit; Logiswift total on hand 342 (100 + 62 + 180), reserved 59 (34 + 11 + 14); Kofi total 99 (36 + 18 + 45). The page computes these. It does not store them.
  - [ ] Filters: product, location type, "Show only differences". A query `?product=<id>` pre-filters (used by F-603).
  - [ ] Table "Recent transfers": Date, Move, Items, Status (In transit, Pickup planned, Received, Received 12 short), button "View all with filters" (opens F-659).
  - [ ] Suggestion cards: F-661.
- Data: none new.
- API: `GET /api/inventory/overview` (cards and table), `GET /api/inventory/transfers?limit=` (recent).
- Permissions: view for owner, admin, manager, stock keeper, finance clerk. Actions for owner, admin, stock keeper.
- Edge cases and errors:
  - A location with no stock still shows a card.
  - Archived product with stock still shows in the table.
  - Mockup issue: "Reserved" (Logiswift copybook 34) is much lower than the 100 orders out with Logiswift. It is sample data. The page computes reserved from orders (F-651).
- Tests: integration (overview totals equal the sum of levels; difference uses the latest count); e2e (owner opens page, sees Logiswift "12 units off").

### F-653: Stock count
- Priority: P0. Milestone: M4.
- Description: The owner (or stock keeper) counts stock at a location and compares it with our records. For a 3PL, the count is the figure on the 3PL dashboard. The count creates a record. A gap opens a Finding. The user can apply the count to fix our records. This is the missing "Start stock count" screen (IN-04).
- Current app: none.
- Mockup: `inventory.html` has the button "Start stock count" and the card action "Start a stock count" with no screen behind them. Build a modal or full-width panel in v2 style.
- Acceptance criteria:
  - [ ] "Start stock count" asks for: Location (required), Count date (default today), Source (`own_count`, `3pl_dashboard`, `agent_count`), Note.
  - [ ] The count sheet lists every product that has on-hand stock at that location, plus an "Add product" row. Each row shows: product, our records (system quantity at the start), counted quantity (input), difference (live).
  - [ ] Save stores a `StockCount` with lines. The system quantity is frozen at start time.
  - [ ] A line with a difference opens a Finding of type "stock gap" for that location and product (subject: location; amount: difference × product cost). A line with no difference opens nothing.
  - [ ] After save, the sheet offers per line: "Apply count" (writes a `count_adjustment` movement; our records become the counted figure; reason defaults to "Physical count correction"; the user can pick another reason, including "Short on arrival" which links the shipment) or "Keep investigating" (the Finding stays open, our records stay).
  - [ ] Applying a count marks the matching Finding as Explained and links the movement.
  - [ ] The most recent count per location and product feeds F-652 "Our records vs count" and F-603 notes.
  - [ ] Worked example: Logiswift copybook set, our records 100, 3PL dashboard 88 on 15 Oct. Difference −12. Finding "Stock gap, Logiswift, 12 units, GH₵362.50 at cost" (12 × 30.21). The owner links it to the 9 Oct shipment short of 12 (F-606) and applies the count with reason "Short on arrival". On-hand becomes 88. The gap is 0. The same 12 units are not counted twice in the cost of failed deliveries (Builder C): the shipment claim (F-608) carries the loss.
  - [ ] Counts of agents: the agent app does not run counts in this release (GUESS: owner may want agents to count; ask). The owner enters the agent's count by hand (source `agent_count`).
  - [ ] The count date cannot be in the future.
- Data: new `StockCount` {id, tenantId, locationId, countDate, source, countedById, note, createdAt}; new `StockCountLine` {id, tenantId, countId, productId, systemQuantity, countedQuantity, difference, appliedMovementId?}. Depends on `Finding` (Builder C owns the model and list; this file creates rows of type `stock_gap`).
- API: `POST /api/stock-counts`, `GET /api/stock-counts?locationId=`, `POST /api/stock-counts/:id/lines/:lineId/apply {reason}`. Command palette action "Start a stock count" (SH-16) opens this.
- Permissions: create and apply for owner, admin, stock keeper; view for manager and finance clerk.
- Edge cases and errors:
  - Stock moved after the count started: apply uses the difference found at count time against the current level and warns when the level changed since ("Stock moved after this count. Check before applying.").
  - A line with a counted quantity above our records is a "found" gap; reason defaults to "Found extra stock".
  - Counted quantity must be 0 or more.
- Tests:
  - Unit: difference and value maths.
  - Integration: count with a gap creates one Finding; apply writes one movement and resolves the Finding; second apply is rejected.
  - E2E: start count at Logiswift, enter 88, save, apply, see "Matches" on the card.

### F-654: Transfers with status, receipt and disputes
- Priority: P0. Milestone: M4 (receipt by agents in the app: M10).
- Description: Moving stock to an agent or another location is not complete until the receiver confirms it. A transfer has a status: in transit, received, or disputed. The agent confirms receipt in the phone app (IN-07). For a 3PL, the owner or stock keeper confirms receipt for them.
- Current app: `InventoryTransfer` is a ledger only (no status). Allocation adds to the agent's quantity and to `totalInTransit` at once.
- Mockup: `inventory.html` (recent transfers, statuses "In transit, arrives 18 Oct", "Received, 2 short"); `agent.html` (Incoming stock, Confirm received).
- Acceptance criteria:
  - [ ] Allocate, transfer between agents and return create a transfer with status `in_transit`. The source level goes down by the sent quantity at once. The units sit in transit.
  - [ ] The receiver confirms with a counted quantity (default = sent). Receipt adds the received quantity to the destination level and sets `receivedQuantity`, `receivedAt`, `receivedById`.
  - [ ] If received equals sent, the status is `received`.
  - [ ] If received is below sent, the status is `disputed`. A reason is required: Short in package, Damaged, Not received. The transfer shows "Received 12 short". The difference stays in transit until the owner resolves it.
  - [ ] Resolve a dispute with: "Return to source" (the short units go back to the source level) or "Write off" (an `adjustment` with the reason; cost of lost units goes to the Finding and the loss figures). Either closes the dispute and sets the status `received`.
  - [ ] Received above sent is not allowed.
  - [ ] The owner can cancel an `in_transit` transfer. The units return to the source level.
  - [ ] The owner or stock keeper can confirm receipt for a 3PL or an own store location (it has no login). The action is audit-logged with the actor.
  - [ ] An agent can confirm only their own incoming transfers.
  - [ ] When a transfer is created for an agent, the agent gets an inbox item "20 copybook sets are waiting for you" (Builder A inbox, F-550 range, B1) and a push of the in-app notification.
  - [ ] Transfer from a 3PL to a person, 3PL to 3PL, own store to 3PL are all allowed. Transfer to the same location is not.
  - [ ] An open transfer older than 3 days shows the tag "Overdue" (GUESS: 3 days; check with the owner).
- Data: `InventoryTransfer` fields from F-651. New enum `TransferStatus` (`in_transit`, `received`, `disputed`, `cancelled`). New `reason` enum for disputes and returns.
- API: `POST /api/inventory/transfers {type, productId, quantity, fromLocationId, toLocationId, reason?, note?}` (allocate, transfer, return share this route), `POST /api/inventory/transfers/:id/receive {quantity, reason?}`, `POST /api/inventory/transfers/:id/resolve {action, note}`, `POST /api/inventory/transfers/:id/cancel`.
- Permissions: create, cancel, resolve: owner, admin, stock keeper. Receive: the receiving agent, or owner, admin, stock keeper on behalf.
- Edge cases and errors:
  - Source has fewer units than the sent quantity: block ("Only 100 available").
  - Concurrency: two transfers from the same level cannot send more than exists (row lock).
  - The receiving user is deactivated: the owner confirms on their behalf.
- Tests:
  - Unit: status machine; short, equal and over received.
  - Integration: allocate 20, receive 18, status `disputed`, resolve with return gives source +2.
  - E2E: allocate to Kofi, Kofi confirms in the agent app (file 09), the table shows Received.

### F-655: Stock modals: allocate, transfer, return, adjust (one owner)
- Priority: P1. Milestone: M4.
- Description: The four stock modals exist twice in the mockups (`products.html` and `inventory.html`). One component set exists, and Inventory owns it (fix #4, PR-13). Products links to Inventory. The command palette and the Inventory cards open the same components. All four now run through the transfer service (F-654, F-651).
- Current app: `AllocateStockModal`, `TransferStockModal`, `ReturnStockModal`, adjust modal in `AgentInventoryManagement`; `POST /api/agent-inventory/allocate|transfer|return|adjust`.
- Mockup: `inventory.html` (modals). `products.html` repeats them. Build once.
- Acceptance criteria:
  - [ ] Allocate: Product; From (a store or 3PL location, shows "n available"); To (any agent or 3PL location, active); Quantity; Hand over on (date picker, default today); Note. Text: "Units show as in transit until the agent confirms them." Button "Allocate stock".
  - [ ] Transfer: Product; From agent (shows "n on hand"); To agent; Quantity; Note. Text: "The warehouse is not involved." Button "Transfer stock".
  - [ ] Return: Product; From agent (shows "n on hand"); To (default: the location that sent the units; any store or 3PL); Quantity; Reason (Failed deliveries, Customer refused, Damaged, Agent stopped delivering, Other); Note. Button "Return stock".
  - [ ] Adjust: Holder (any location); Product; New quantity (live "Now 36. Change of −2."); Reason (Physical count correction, Damaged goods, Lost or stolen, Found extra stock, Other); Note (required when reason is Other). Button "Save adjustment". Every change is logged with who and when.
  - [ ] Quantity must be a whole number above 0 (adjust: 0 or more).
  - [ ] Each modal can open pre-filled from a card, a table row action, the command palette or a suggestion card.
  - [ ] Allocate and Return limit the quantity to what the source holds (minus units already in transit out).
  - [ ] Products expansion (F-603) has no buttons. Products and the Inventory table link here with `?action=allocate&product=&to=`.
  - [ ] On success the screen refreshes the card, the table and Recent transfers, and shows a toast. (The mockup toasts leave the tables unchanged. That is a mockup limit.)
  - [ ] The agent suggestion on a stock card never submits a modal by itself (G10).
  - [ ] Which actions show on a card: store and 3PL cards: Allocate, Adjust. Agent cards: Return, Transfer, Adjust.
- Data: movements from F-651.
- API: F-654 routes, plus `POST /api/inventory/adjust {locationId, productId, newQuantity, reason, note}`.
- Permissions: owner, admin, stock keeper.
- Edge cases and errors: adjust below 0 is rejected; adjust of a product with open transfers into the location warns. Adjust with no change is rejected ("No change").
- Tests: unit (adjust difference); integration (each modal route writes one movement); e2e (allocate then see the row in Recent transfers).

### F-656: Returned units: sent against received
- Priority: P1. Milestone: M4.
- Description: A 3PL sends failed or returned units back. We count what arrives. The difference is "returned units missing". In October, Logiswift sent back 41 units and we received 36. 5 are missing. Each missing unit costs the landed cost (5 × GH₵30 = GH₵150, part of the GH₵610 cost of failed deliveries in NUMBERS.md).
- Current app: none (a return moves stock from an agent to the warehouse; there is no sent-against-received check).
- Mockup: `deliveries.html` (note "Logiswift sent back 41 units. We received 36. 5 are missing."); `inventory.html` (transfer "Kofi Appiah to Logiswift, Returns × 9, Pickup planned").
- Acceptance criteria:
  - [ ] A return from a 3PL to our own store is a transfer of type `return_to_warehouse` with `quantity` = sent and `receivedQuantity` = received (F-654). Sent is entered from the 3PL's return list (GUESS: manual entry; an outside agent may enter it through the API later).
  - [ ] Missing = sent − received, per partner and per period. The Deliveries page shows the total (5) and the partner (F-706).
  - [ ] Each missing amount above 0 creates a Finding of type "stock gap" with the partner as subject and the value = missing × landed cost.
  - [ ] Resolving a dispute by "Write off" books the loss (F-654). "Return to source" is not offered for 3PL returns that never arrived (the owner picks Write off or Keep open).
  - [ ] The KPI "Returned units missing" = sum of (sent − received) in the period. Target 0. It is read by Builder C's cost-of-failed-deliveries figure.
  - [ ] Worked example: October fixture: sent 41, received 36, missing 5, value GH₵150 (at GH₵30).
- Data: `InventoryTransfer.receivedQuantity` (F-651). No new model.
- API: `GET /api/inventory/returns/summary?from=&to=&partnerId=` returns sent, received, missing.
- Permissions: view for owner, admin, manager, stock keeper, finance clerk; enter and resolve for owner, admin, stock keeper.
- Edge cases and errors: received above sent: block. Sent is 0 with received above 0: block.
- Tests: unit (missing); integration (41 sent, 36 received gives 5 and one Finding of GH₵150); e2e (record the return and see the Deliveries note).

### F-657: Stock decreases exactly once
- Priority: P0. Milestone: M0 (characterization test) and M4 (fix).
- Description: Today a public checkout order lowers `Product.stockQuantity` at creation (package quantity only) and the status machine lowers it again when the order goes to `out_for_delivery` or `delivered`. The result is a double decrement for the package product. Upsell lines are decremented once. A pending public order that is cancelled never gets its creation decrement back. The rebuild lowers stock once, at delivery, and only from the holder's location.
- Current app: `backend/src/services/publicOrderService.ts` lines 282 to 290 (decrement at creation); `backend/src/services/orderService.ts` lines 1049 to 1056 (decrement on entering the deducted zone); `orderService.ts` lines 1335 to 1340 (restock on cancel only from the deducted zone); `orderService.ts` lines 895 to 915 (order edit changes stock); `agentInventoryService.recordOrderFulfillment` (agent stock drawn at `out_for_delivery`). Checked in code on 2026-10-18.
- Mockup: `agent.html` history ("−1 delivered"); `inventory.html` (Reserved column).
- Acceptance criteria:
  - [ ] M0 test (before the fix): create a public order for a 3-set package; mark it `out_for_delivery`; mark it `delivered`; record the stock change. The test documents the real result (expected: −6 with the current code). The test stays as a regression test and is rewritten in M4 to expect −3.
  - [ ] Creating an order (any source) does not change any quantity. It checks available to sell only (F-651).
  - [ ] Moving an order to `out_for_delivery` does not change on-hand. The units count as reserved at the holder's location.
  - [ ] Moving an order to `delivered` writes one `order_fulfillment` movement per order line (including upsell lines) from the holder's location. The holder is the order's assigned delivery agent or 3PL. The movement is keyed by order line. A unique rule allows at most one active fulfilment per order line.
  - [ ] Failed delivery and cancel before delivery change no stock.
  - [ ] An order that leaves `delivered` (returned, or moved back) writes one `order_reversal` movement that puts the units back at the holder's location, and marks the fulfilment as reversed. A new delivery writes a new fulfilment.
  - [ ] Editing an open order's items changes reserved units only. It never changes on-hand.
  - [ ] `deliveryService.completeDelivery` and the state machine are one path: completing a delivery calls the order status service. No second route sets `delivered` without the stock step.
  - [ ] If the holder has fewer units than the order needs, the delivery still completes. On-hand goes negative and a Finding of type "stock gap" opens ("Kofi Appiah has −2 copybook sets"). Reason: blocking an agent's delivery in the field costs more than a negative number the owner can fix (decision R11).
  - [ ] An order with no assigned holder cannot move to `delivered` through the app (error "Assign a delivery partner first").
  - [ ] Digital items have no stock movement.
  - [ ] Integration test: ordering 3 sets and delivering it lowers the holder by exactly 3. Delivering, returning and re-delivering ends at −3.
  - [ ] Idempotent: a repeated `delivered` call does nothing extra.
- Data: `InventoryTransfer.reversedAt`; a partial unique index on (orderId, productId, itemKey) for active `order_fulfillment` rows. `OrderItem` is the line key.
- API: no new endpoint; `orderService.updateOrderStatus` calls `stockService.fulfilOrder` and `stockService.reverseOrder`.
- Permissions: system.
- Edge cases and errors:
  - Holder changed between `out_for_delivery` and `delivered`: use the holder at delivery.
  - Two simultaneous `delivered` calls: one wins by the unique rule.
  - Existing orders already in `out_for_delivery` at deploy time: the migration treats them as not yet fulfilled; their stock was already lowered at `out_for_delivery`. The migration adds those units back to the holder and writes one `opening`-style correction labelled "Migration: stock moved from out-for-delivery to delivery" so the first delivery after deploy lowers it once. (GUESS: check the count of such orders on production before the migration; there are 148 out now in the fixture.)
- Tests:
  - Unit: fulfilment key uniqueness; reversal.
  - Integration: the 3-set scenario; cancel of a pending public order leaves stock unchanged; negative stock path opens one Finding.
  - E2E: public order, assign Kofi, deliver, check Kofi's stock fell by 3 only.

### F-658: Remove the raw stock overwrite
- Priority: P0. Milestone: M4.
- Description: `PATCH /api/products/:id/stock` overwrites `Product.stockQuantity` with no record of why. It is removed. Stock changes only by movements (F-651), counts (F-653) and adjustments (F-655).
- Current app: `PATCH /api/products/:id/stock` in `productController.ts` line 179 to 186; frontend stock field in `ProductForm`.
- Mockup: `products.html` (drawer disables starting stock when editing).
- Acceptance criteria:
  - [ ] The route is deleted. A call returns 404.
  - [ ] `PUT /api/products/:id` ignores `stockQuantity` and returns 400 if it is sent.
  - [ ] No code outside `stockService` writes `StockLevel.quantity` or `Product.stockQuantity` (a lint rule or a test greps for direct writes).
  - [ ] `PATCH /api/products/shipments/:id/arrive` is removed in favour of F-606.
  - [ ] The MCP tool `products_inventory` reads `StockLevel`.
  - [ ] Dead code is deleted: the stock field in `ProductForm.tsx` is gone with the page (F-601).
- Data: none.
- API: removed routes as above.
- Permissions: n/a.
- Edge cases and errors: scripts under `backend/scripts` that call the route or write `stockQuantity` are listed and updated or removed (GUESS: some backfill scripts do; run a grep at build time).
- Tests: integration (404 and 400 as above); static test (no direct writes).

### F-659: Stock movement history
- Priority: P2. Milestone: M4.
- Description: One modal lists every allocation, delivery, transfer, return, receipt, count and adjustment, with filters. It opens from the Inventory header, the recent transfers table and (as a link) from Products.
- Current app: `TransferHistoryModal` (type filter, 20 per page); `GET /api/agent-inventory/transfers`.
- Mockup: `products.html` and `inventory.html` (Transfer history modal: tabs by type, filters Holder and Product, table Date, Type, From, To, Product, Qty, Order, By, Note; footer "Showing n moves · Last 30 days").
- Acceptance criteria:
  - [ ] Tabs: All, Allocation, Order fulfilled, Agent transfer, Return, Receipt, Count, Adjustment. Tab counts come from the data, not static numbers (fix #25).
  - [ ] Filters: location, product, date range (default last 30 days), status.
  - [ ] Columns: Date, Type, From, To, Product, Qty, Order (link to the order), By, Note, Status.
  - [ ] Pagination 20 per page. Export CSV for the filtered list (owner, admin, finance clerk).
  - [ ] Each row opens a side detail with the full audit trail (created, received, resolved).
- Data: none.
- API: `GET /api/inventory/transfers?type=&locationId=&productId=&from=&to=&status=&page=`.
- Permissions: view for owner, admin, manager, stock keeper, finance clerk. A delivery agent sees only their own moves, in the agent app (file 09).
- Edge cases and errors: empty result shows "No moves in this range."
- Tests: integration (filters); e2e (open history, filter by Kofi).

### F-660: Stock migration and nightly check
- Priority: P0. Milestone: M4.
- Description: Existing stock moves to the new model without changing a quantity. The migration reads `Product.stockQuantity` and `AgentStock` and builds `StockLevel` rows. A nightly check keeps the cached product total equal to the sum of levels.
- Current app: `Product.stockQuantity` (warehouse), `AgentStock`, `InventoryTransfer`.
- Mockup: n/a.
- Acceptance criteria:
  - [ ] Each `AgentStock` row becomes a `StockLevel` at that agent's location with the same quantity. In-transit counters (`totalInTransit`) become open `in_transit` transfers with status `in_transit` (Kofi's 20 copybook sets).
  - [ ] `Product.stockQuantity` (warehouse) becomes the level at the default 3PL location (Logiswift). The owner can pick another location during the run (a dry-run report shows the choice).
  - [ ] Old `InventoryTransfer` rows get `fromLocationId` and `toLocationId` from the agent ids (warehouse side = the default 3PL location) and status `received`.
  - [ ] A dry-run prints: per product, sum before and after. They must be equal. The run fails if any differ.
  - [ ] After migration, the Logiswift copybook level still reads 100 and the 3PL count (88) shows as a 12-unit gap (F-653). The migration does not "fix" it.
  - [ ] A nightly job compares `Product.stockQuantity` with the sum of levels and opens a Finding on any difference.
  - [ ] The job and the migration run per tenant with a tenant context (design risk 8).
- Data: backfill as above. `AgentStock` kept read-only.
- API: none.
- Permissions: system (migration script, owner-run).
- Edge cases and errors: an agent with an `AgentStock` row but no active location gets a location created and marked inactive. A negative `Product.stockQuantity` is copied as negative.
- Tests: integration (fixture with 4 holders: sums before and after equal); rollback test.

### F-661: Inventory suggestion cards
- Priority: P3. Milestone: M11.
- Description: Inventory shows one to three cards that find real stock problems. A card opens a pre-filled screen. It never changes data (G10).
- Current app: none.
- Mockup: `inventory.html` (cards "Magic Groove stock is 12 units short at Logiswift" and "20 copybooks reach Kofi tomorrow").
- Acceptance criteria:
  - [ ] Card "Stock is N units short at <location>": built from the latest count gaps. Button "Start a stock count" opens F-653 at that location.
  - [ ] Card "Transfer reaches <agent> on <date>": built from open transfers and the agent's stock and sales rate ("At 4 a day he runs out on 24 Oct without them"). Button "Remind Kofi" opens the Set reminder popover (Inbox, B1 range F-550) pre-filled. The reminder is created only after the user confirms.
  - [ ] Card "Returned units missing": shown when F-656 shows missing above 0. Button opens the return record.
  - [ ] Each card has Dismiss. Card text uses the numbers from F-652 only (fix #19: one text source).
- Data: none.
- API: `stock_gaps_by_location` problem finder (design §7.3).
- Permissions: roles that view Inventory.
- Edge cases and errors: no problem found means no cards.
- Tests: unit (text from the same numbers); e2e (click Start a stock count).

---

## 4. Cross-area dependencies

I rely on these. IDs in other files are named by range. Where I do not know the exact ID I give the area.

| Need | Where | Used by |
|---|---|---|
| `FxRate` model, daily auto rate, manual override, per-day history, stale-rate rule (S3) | F-1200 range (Builder C: Settings → Currencies and FX) | F-605, F-606 |
| Settings → Operations: default low-stock days (14) | F-1200 range (Builder C) | F-600, F-601 |
| `Finding` model and list screen | F-900 range (Builder C: finance and fraud) | F-608, F-653, F-656, F-657, F-660 |
| Ledger posting for inventory purchase, COGS, loss on write-off; cost of failed deliveries | F-900 range (Builder C) | F-606, F-611, F-654, F-656 |
| Profit by product (Finance) and Reports products tab read `productDeliveredUnits` | F-900 and F-1050 ranges (Builder C) | F-610 |
| New order form product pick list, order status service (`updateOrderStatus`), `OrderItem` lines | F-300 range (Builder B1: orders) | F-602, F-657 |
| Checkout form product and upsell pick list, "can't take orders yet" guard | F-400 range (Builder B1) | F-602, F-609 |
| Inbox items, reminders, notifications for transfers | F-550 range (Builder B1) | F-654, F-661 |
| Agent app stock page and Confirm received sheet | F-806, F-807 in `09-agent-app.md` | F-654 |
| Delivery partners, partner users and locations | F-700 range in `07-deliveries.md` | F-650 |
| Outside agent posting counts through the stock count API (no Logiswift-specific code, decision O1) | F-653, F-656 in this file | F-653, F-656 |
| Tool registry problem finders; suggestion card host | F-1300 range (Builder A) | F-609, F-661 |
| Command palette actions "Start a stock count" | F-100 range (Builder A: shell) | F-653 |
| Tenant scoping for every new model | M0 work in F-100 range (Builder A) | F-650 to F-660 |

---

## 5. Coverage table

Every row of gap-matrix section 1.7 and 1.8, then the §3, §4 and §2 rows that touch these areas.

### 5.1 Section 1.7 Products (15 rows)

| Matrix row | Covered by |
|---|---|
| PR-01 Product list | F-600 |
| PR-02 KPI tiles, Active/Archived tabs | F-600 |
| PR-03 Add and edit product | F-601 |
| PR-04 Digital product fields | F-601 |
| PR-05 Delete product (becomes Archive) | F-602 |
| PR-06 Raw stock overwrite | F-658 |
| PR-07 Stock by holder (expand) | F-603 |
| PR-08 Incoming shipments tab | F-604 |
| PR-09 Add shipment | F-605 |
| PR-10 Receive shipment | F-606 (with F-611) |
| PR-11 Edit and delete shipment | F-607 |
| PR-12 Supplier claim when short | F-608 |
| PR-13 Allocate, transfer, return, adjust, history modals | F-655, F-659 |
| PR-14 Live margin in form | F-601 |
| PR-15 Product agent cards | F-609 |

### 5.2 Section 1.8 Inventory (10 rows)

| Matrix row | Covered by |
|---|---|
| IN-01 Agent inventory (summary, detail, history) | F-652, F-659 |
| IN-02 Stock locations | F-650 |
| IN-03 Our records vs 3PL count, difference | F-652, F-653 |
| IN-04 Stock count | F-653 |
| IN-05 Reserved quantity | F-651, F-652 |
| IN-06 Transfers with status | F-654 |
| IN-07 Agent confirms receipt | F-654 (rules), F-808 in `09-agent-app.md` (screen) |
| IN-08 Adjust with reason | F-655 |
| IN-09 Own store | F-650 |
| IN-10 Agent "My Inventory" | F-807 and F-808 in `09-agent-app.md` (data from F-651) |

### 5.3 Related rows from §2, §3, §4 and the design doc

| Row | Covered by |
|---|---|
| §3 #7 Possible double stock decrement | F-657 (confirmed in code on 2026-10-18) |
| §3 #28 `PATCH /products/:id/stock` overwrites | F-658 |
| §4 #4 Stock modals and holder table in Products and Inventory | F-603, F-655 |
| §4 #13 Product delivered counts disagree (306 vs 328 and others) | F-610 |
| §2.3 Low stock days of cover (default 14, per-product override) | F-600, F-601 (setting field: F-1200 range) |
| §2.5 Supplier cost currency (per shipment) | F-605 |
| §2.7 Digital link expiry, max downloads | F-601 |
| Design §4.5 Returned units missing; Stock gap per location | F-656, F-653 |
| Design §5.3 `StockLocation`, `StockLevel`, `StockCount`, `StockCountLine`; `InventoryShipment` and `InventoryTransfer` changes | F-650, F-651, F-653, F-606, F-654 |
| Design §9 risk 12 No warehouse stock ledger; risk 17 Product cost conflict | F-651, F-611 |

Row counts:
- Section 1.7: 15 rows in the matrix, 15 rows above. Section 1.8: 10 rows in the matrix, 10 rows above. Total feature rows: 25 of 25.
- Extra related rows listed: 10 (the §3, §4, §2 and design rows above). None is dropped.
- F-IDs written in this file: 12 in the Products range (F-600 to F-611) and 12 in the Inventory range (F-650 to F-661). Total 24.

## 6. Open items (GUESS list for the owner or the build team)

1. RESOLVED (decision R1): the tile follows the written weighted formula (86% on the fixture), not the mockup sample of 66%. (F-600)
2. RESOLVED (decision R1): days of cover follows the written formula (14-day average of delivered units); mockup numbers are illustration only. (F-600)
3. RESOLVED (decisions D2, R1): landed cost uses the counted quantity (8,700 ÷ 288 = GH₵30.21). (F-606)
4. Weighted average cost (current code) against "latest landed cost" (mockup footer). The PRD keeps the weighted average. (F-611)
5. Shipping paid in a different currency from the product. One currency per shipment for now. (F-605)
6. RESOLVED (decision R11): stock may go negative at delivery; it does not block the delivery and it raises a Finding. (F-657)
7. Supplier claim settlement does not post to the ledger yet. (F-608)
8. Migration for orders already `out_for_delivery`: count them on production first. (F-657)
9. Overdue transfer age (3 days) and dismissed-card return period (7 days). (F-654, F-609)
