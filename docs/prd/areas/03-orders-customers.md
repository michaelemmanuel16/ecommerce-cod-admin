# PRD area 03: Orders and Customers

Date: 2026-10-18. Builder B1. Status: draft for Opus review.

## 1. Scope

This file covers:
- Gap matrix 1.3 Orders (OR-01 to OR-25). F-IDs F-300 to F-349.
- Gap matrix 1.4 Customers (CU-01 to CU-12). F-IDs F-350 to F-399.
- Broken items (matrix section 3): #7, #11, #12, #22 (customer part), #25, #27, #36, #46, #49.
- Mockup fixes (matrix section 4): #10, #11, #12, #17, #25 (dead buttons), #29, E3, E4.

Screens: Orders list, order details drawer, New order drawer, Import modal (`index.html#orders`); Customers (`customers.html`); customer detail page (not in mockup).

Roles that use these screens:
- Owner (`super_admin`), `admin`, `manager`: full access.
- Call rep (`sales_rep`): own orders, create orders, add and edit customers (G9).
- Delivery agent (`delivery_agent`): own orders only, status steps they are allowed to take.
- Accountant (`accountant`): read orders, export.
- Inventory manager (`inventory_manager`): read orders, pre-dispatch steps (preparing, ready for pickup).
- AI agents and 3PL connectors act through the state machine as "integration" actors (F-302).

Decisions used (final, from `docs/prd/decisions.md`): D4 (money to Decimal in M0), D7 (rebuild order state machine in M1; multi-store out), D8 (paid digital order is delivered revenue; free bundled digital item is not), D6 and G5 (time to first call counts only inside operating hours), G6 (refusal rule), G9 (reps create orders and customers), G10 (AI cards never change data in release one).

Terms used in this file:
- "Order number" means the number people see. It is `#` plus `Order.id`.
- "Machine" means the order state machine in F-301 and F-302.
- "Dispatch" means an order entering `out_for_delivery`.
- "Region" means one of the regions of the store's country (list in F-413 in the checkout area; decision O3). "Town" means the town or area inside a region.

Order of milestones used here follows design doc section 10.

---

## 2. Requirements: Orders (F-300 to F-349)

### F-300: One order number format
- Priority: P1. Milestone: M3.
- Description: The mockups show three order id formats: `#24xxx` (admin), `CA-482xx` (rep and agent apps) and `#MG-104xx` (workflows). The real app shows the plain database id. We pick one format for every screen, message, export and API: `#` plus `Order.id`, for example `#24118`. No new column. The format is a display rule only.
- Current app: `frontend/src/pages/Orders.tsx` line 607 shows the raw id. The rep screen (F-771, file 08) and the agent app (F-818, file 09) use this one format. The Meta Purchase event id also uses `order.id` (`pixelTracking.ts` `trackPurchase`, `metaCapiService.ts` line 168). Search in `orderService.getAllOrders` parses a number as the id.
- Mockup: `index.html#orders` uses `#24xxx`. `rep.html`, `agent.html`, `workflows.html`, `inbox.html` use other formats. Replace them with `#24xxx` style.
- Acceptance criteria:
  - [ ] One helper `formatOrderNumber(id)` returns `#<id>`. Every screen, WhatsApp or SMS text, export column and toast uses it.
  - [ ] Search accepts `24118` and `#24118`. Both find the same order.
  - [ ] No screen shows `CA-` or `MG-` ids.
  - [ ] The Pixel and CAPI event id stays the raw numeric id (or the payment reference for online payments). It does not change when the display format changes.
  - [ ] Sample data in the built screens comes from one orders table. The same number never maps to two customers or two amounts (matrix section 4 #12).
- Data: none. API: none. A `displayNumber` string is added to order JSON responses for convenience (optional).
- Permissions: all roles that see an order.
- Edge cases and errors:
  - The id grows by one per order across all tenants today. A seller sees gaps in their numbers. This is fine for the owner's own business. A per-tenant order counter belongs to the SaaS phase.
  - GUESS: ids in production are five digits (about 24,000). Check with `SELECT max(id) FROM orders` on production before you fix the label width in the UI.
- Tests: unit test for `formatOrderNumber`; integration test that search for `#<id>` returns the order; e2e check that the number in the list, the drawer and the rep call card is the same.

### F-301: Order state machine: states and allowed transitions
- Priority: P0. Milestone: M1.
- Description: Rebuild the order state machine (D7, MAN-56). Today any status can move to any other (the check is commented out in `orderService.updateOrderStatus`). The new machine has one transition table, one function that changes status, and one audit row per change. It covers all 12 enum values, including `payment_pending`, `payment_failed` and `digital_delivered`. Normal moves are limited by state and by role. Rare moves need the override in F-302.
- Current app: `backend/src/services/orderService.ts` `updateOrderStatus` (line 965). `validateStatusTransition` is commented out. The API validator accepts 9 statuses and not the other 3. Branch `feature/man-56-order-state-machine` (local, unpushed) has `backend/src/lib/orderStateMachine.ts` and `statusVersion`. That branch made every move legal. We reuse its ideas (optimistic lock, actor type, one audit row). We do not reuse its permissive table.
- Mockup: `index.html#orders` has a status select with 9 values and no rules. Settings → Order statuses (`settings.html`) lists 6. Fix both: the orders list uses the 12 states (F-308); the Settings tab shows all 12, read-only (area C, F-1200 range). Matrix section 4 #10 is covered by this requirement.
- The 12 states:

| State | Meaning | Kind |
|---|---|---|
| `pending_confirmation` | Order placed. A call or customer reply must confirm it. | open |
| `payment_pending` | Order exists. Online payment is not complete yet. | open |
| `payment_failed` | The online payment failed or expired. | open |
| `confirmed` | Customer confirmed. Waiting to be packed. | open, pre-dispatch |
| `preparing` | Being packed. | open, pre-dispatch |
| `ready_for_pickup` | Packed. Waiting for the agent or 3PL. | open, pre-dispatch |
| `out_for_delivery` | With a delivery agent or 3PL. This is "dispatched". | open, in flight |
| `delivered` | Delivered. Revenue is booked on the delivery date. | closed |
| `digital_delivered` | Paid digital order. Download link sent. Counts as delivered revenue (D8). | closed |
| `failed_delivery` | A delivery attempt failed. The order can go out again. | closed or retry |
| `returned` | Units came back from the customer or partner. | closed |
| `cancelled` | Order stopped. A reason is required. | closed |

- Normal transitions (the only moves that need no override). "Pre-dispatch" means `confirmed`, `preparing`, `ready_for_pickup`.

| From | To (allowed) |
|---|---|
| `pending_confirmation` | `confirmed`, `cancelled`, `payment_pending` |
| `payment_pending` | `confirmed`, `digital_delivered`, `payment_failed`, `cancelled` |
| `payment_failed` | `payment_pending`, `cancelled` |
| pre-dispatch (each of the three) | the other two pre-dispatch states, `out_for_delivery`, `cancelled`; also `digital_delivered` when the order type is digital (system actor only, after the download link is sent) |
| `out_for_delivery` | `delivered`, `failed_delivery`, `returned` |
| `failed_delivery` | `out_for_delivery`, `returned`, `cancelled` |
| `delivered` | `returned` |
| `digital_delivered` | none |
| `returned` | none |
| `cancelled` | none |

- Who may make a normal move (role gate, on top of the row-level ownership check):

| Role | Moves allowed |
|---|---|
| `super_admin`, `admin`, `manager` | every normal move |
| `sales_rep` | `pending_confirmation` → `confirmed` or `cancelled` (call outcome, F-324), only on own orders |
| `inventory_manager` | moves between pre-dispatch states |
| `delivery_agent` | pre-dispatch → `out_for_delivery`; `out_for_delivery` → `delivered` or `failed_delivery`; `failed_delivery` → `out_for_delivery`; only on own orders |
| `accountant` | none |
| system (checkout, payment settlement, auto-confirm, workflow) | the moves named for that source in F-405, F-466 and F-510 |

- Acceptance criteria:
  - [ ] One function `transitionOrder(orderId, to, actor, options)` is the only code that writes `Order.status`. A grep for `status:` in `prisma.order.update` calls outside this function finds none (workflow `update_order`, `assign_agent`, `deliveryService.completeDelivery`, import, MCP all call it).
  - [ ] A move not in the table returns HTTP 409 with `{code: "INVALID_TRANSITION", from, to}` and a plain message such as "An order that is delivered can only be returned."
  - [ ] A move to the same status is a no-op that returns the order unchanged (idempotent).
  - [ ] The API validator accepts all 12 values.
  - [ ] Every move writes one `OrderHistory` row: status, actor id, actor kind, note, `forced` flag, `from` status in `metadata`.
  - [ ] `GET /api/orders/:id/transitions` returns the moves the caller can make now. The drawer status select shows only those.
  - [ ] Two people who change one order at the same time: the second gets HTTP 409 `STALE_ORDER` and a reload prompt (F-302).
  - [ ] Matrix section 3 #12 (no transition validation) is closed by this requirement.
- Data: `Order.statusVersion Int @default(0)` (name from MAN-56; not in this tree). Add `OrderHistory.fromStatus OrderStatus?`, `OrderHistory.actorKind`, `OrderHistory.forced Boolean @default(false)`. Enum `OrderStatus` is unchanged (12 values).
- API: `PATCH /api/orders/:id/status` (changed validation and errors). `GET /api/orders/:id/transitions` (new). `PATCH /api/orders/bulk/status` (new, see F-313).
- Permissions: `orders:update` plus the role gate above.
- Edge cases and errors:
  - `payment_pending` and `payment_failed` are never set by code today. Checkout uses a deferred model: no order exists until payment is confirmed (`paystackSettlementService.ts`). Keep that model (F-405). In release one these two states have no creation path. They exist in the table, filters, KPIs and reports so that physical prepaid orders (G1, later) can use them. The inventory (`inventory-backend.md` 2.2) says Paystack and digital flows set them. The code does not. See the conflict list in the report.
  - A pre-dispatch order with no delivery agent cannot move to `out_for_delivery` unless the owner uses own-store dispatch (F-305).
  - Orders imported as history (F-319) are created directly in their status. The machine runs the side effects but does not check the path.
- Tests: unit test for every cell of the 12 x 12 table (allowed, denied, same-state); unit test per role gate; integration test that workflow, MCP and import paths call `transitionOrder`; concurrency test with two parallel moves.

### F-302: Override, integration jumps, concurrency and audit
- Priority: P0. Milestone: M1.
- Description: Real COD work needs moves the normal table blocks. The owner revives a wrongly cancelled order. An outside agent marks an order delivered without the app seeing `out_for_delivery`. A delivered order is reopened for re-delivery. The machine allows these in two controlled ways: an override for people with a permission, and a short list of jumps for integration actors. Both leave a clear audit trail. This is a change from the MAN-56 branch, where every move was free.
- Current app: none (no checks at all). `orders_update_status` MCP tool (`backend/src/mcp/tools/orders.ts`) is the entry point for outside agents that run partner syncs (decision O1). It can send a backdated `deliveryDate`.
- Mockup: not in mockup. Build in v2 style: in the drawer status select, moves outside the normal list show under a "More options" group. Choosing one opens a small dialog with a required reason field and the line "This is outside the normal flow. It is saved in the order history."
- Acceptance criteria:
  - [ ] New permission `orders:force_status`. Default: `super_admin` only. The owner can grant it to `admin`.
  - [ ] With the permission, any status can move to any other distinct status. A reason of at least 5 characters is required. The history row has `forced = true` and the reason.
  - [ ] Integration actors (a role with the tool `orders_update_status` held by an AI agent or a 3PL connector, and the system) may use these jumps without a reason: pre-dispatch → `delivered`, `failed_delivery`, `returned`; `failed_delivery` → `delivered`. The history row has `actorKind = integration` and `metadata.jump = true`.
  - [ ] A jump to `delivered` sets `dispatchedAt` to the same time as the move (F-304) and marks `metadata.jump = true` so the KPI service can leave it out of "dispatched to delivered" days.
  - [ ] Moving out of `delivered` reverses the revenue journal entry and clears `deliveryDate`. If the order's `AgentCollection` is `verified` or later, the move is blocked with "Reverse the collection first" (the Finance area, C, F-900 range, owns the reversal screen).
  - [ ] The write uses `UPDATE ... WHERE id = ? AND status_version = ?`. Zero rows updated gives `STALE_ORDER`. A database trigger bumps `status_version` on every status change, as the MAN-56 branch did, so bare SQL writers take part in the lock.
  - [ ] The audit log (design 5.3 `AuditLog`: `actorKind`, `channel`, `before`, `after`) gets one row per forced move.
- Data: `Order.statusVersion` (F-301). `AuditLog.before/after/actorKind/channel` (design 5.3; owned by area A, F-1300 range). Trigger migration `orders_status_version_bump`.
- API: `PATCH /api/orders/:id/status` accepts `{status, note, force?: true}`. MCP `orders_update_status` accepts the same and passes the actor.
- Permissions: `orders:force_status` for override. Integration jumps need the tool in the actor's role.
- Edge cases and errors:
  - A forced move to `delivered` follows the stock rule (F-305): it needs a delivery partner. Without one the move is refused with "Assign a delivery partner first". A walk-in sale at the own store needs the own store as the partner (stock area, F-650 range; GUESS: own store is a location type in design 5.3, "coming soon" in the mockup).
  - Race between a rep call outcome and a customer confirm reply (F-466): the second move gets `STALE_ORDER` and the service treats it as a no-op when the order is already `confirmed`.
- Tests: unit tests for override and jump rules; integration test that a forced move out of `delivered` posts a reversal; trigger test with a raw SQL update.

### F-303: One path for status side effects
- Priority: P0. Milestone: M1.
- Description: Every status change runs the same side effects in the same order, whoever starts it. Today the failed-delivery journal entry is not posted when a status is set to `failed_delivery` (matrix section 3 #11). `deliveryService.completeDelivery` is a second route to "delivered" with its own transaction. Workflow actions skip the service (see F-510). The machine owns all side effects.
- Current app: `orderService.updateOrderStatus` (stock, delivery date, financial sync outside the transaction, reversal on return). `deliveryService.completeDelivery`. `glAutomationService` (entries for delivered, failed, return).
- Mockup: not applicable.
- Side effects by entered state:

| Entered state | Effects (inside one database transaction unless noted) |
|---|---|
| `confirmed` (first time) | set `confirmedAt` (F-304); stop the confirm message flow (F-466) |
| `out_for_delivery` (first time) | set `dispatchedAt`; units become reserved at the holder (no stock change; F-305); create the `Delivery` record if missing |
| `delivered` | one stock movement from the holder (`stockService.fulfilOrder`, F-305); set `deliveryDate` (default now; backdate allowed for integration actors and the owner); set `paymentStatus = collected` for COD; post revenue entry dated `deliveryDate`; create draft `AgentCollection`; create `CommissionEntry` rows when the commission ledger exists, only for an order a rep confirmed by call (P6; Finance area, C, F-900 range, M7); post the delivery fee (F-936, decisions F1 to F4); refresh customer stats (F-357) |
| `digital_delivered` | set `deliveryDate` = payment time; revenue is booked by the digital sale entry (checkout area, F-406) |
| `failed_delivery` | post the failed-delivery entry with the delivery fee rule for outcome `failed` (F-936); require a failure reason (F-306); refresh customer stats; add to the re-delivery queue |
| `returned` | post the return reversal; if the order was delivered, call `stockService.reverseOrder` (F-305); units coming back are tracked in the stock area (F-656) |
| `cancelled` | require a cancel reason (F-306); no stock movement if not yet dispatched; refresh customer stats |

- Acceptance criteria:
  - [ ] The failed-delivery journal entry posts on every move to `failed_delivery`, from the app, the agent app, the MCP tool and the workflow action.
  - [ ] The failed-delivery fee comes from the partner's fee rule (`FeeRule`, outcome `failed`; Deliveries area, B2, F-700 range). If no rule exists, the fee is 0. The old default of GH₵50 (`GL_DEFAULTS`) is removed. NUMBERS.md shows fees of GH₵0 to GH₵5 on a failed order.
  - [ ] The post-delivery financial sync runs inside the same flow as a queued job with a retry. The 15-minute reconcile job stays as a safety net.
  - [ ] `deliveryService.completeDelivery` calls `transitionOrder`. It no longer changes status itself.
  - [ ] Side effects are idempotent. A repeated call does not post a second entry.
- Data: none new beyond F-304 and F-306.
- API: none new.
- Permissions: not applicable (internal).
- Edge cases and errors:
  - The financial sync is outside the transaction today (fire and forget). If it fails the order is delivered with no revenue entry until the reconcile job runs. Keep the job. Add an alert in the Inbox (F-557) when an order stays `revenueRecognized = false` for more than 30 minutes.
  - GUESS: GL 4010 posts with `entryDate` = time of posting, not `deliveryDate` (design doc 5.4). The posting must use `deliveryDate`. Check `glAutomationService.ts` before M1.
- Tests: integration test for each row of the table; test that a `failed_delivery` move from the MCP tool posts the entry; idempotency test (call twice).

### F-304: Order timestamps: `confirmedAt`, `dispatchedAt`, `firstContactAt`
- Priority: P0. Milestone: M1.
- Description: The KPI service needs three new timestamps on the order. `confirmedAt` feeds "confirmed to dispatched". `dispatchedAt` feeds "dispatched to delivered" and "waiting to dispatch". `firstContactAt` feeds time to first call (target 15 minutes, alert at 30, counted only inside operating hours: D6, G5, R10). The app stores raw timestamps. The operating-hours maths belongs to the KPI service (Dashboard and KPI area, A, F-200 range).
- Current app: none. `Order.createdAt` is the order placed time. `Call.createdAt` and `OrderHistory.createdAt` exist.
- Mockup: not applicable (data). The drawer timeline (F-322) shows them.
- Definitions:
  - `confirmedAt`: the first time the order enters `confirmed`. Never cleared.
  - `dispatchedAt`: the first time the order enters `out_for_delivery`, or enters `delivered` or `failed_delivery` by a jump. Never cleared by a later failed delivery.
  - `firstContactAt` (decision R10): the time of the first rep call attempt on the order (the first `Call` row by a rep, any outcome). A customer YES to the auto-confirm message (button or reply, file 05, F-466) also sets it, because it confirms the order and closes the clock; the order counts as "auto-confirmed", not as a rep call. Messages sent by a person, other customer replies and automatic template messages (order received, auto-confirm request) do not set it.
- Acceptance criteria:
  - [ ] The machine sets `confirmedAt` and `dispatchedAt` in the same transaction as the status change, only if the field is empty.
  - [ ] `callService.createCall` sets `firstContactAt` if empty. The auto-confirm handler sets it when the customer replies YES (F-466). Manual replies do not set it (R10).
  - [ ] A backfill script fills the fields for old orders: `confirmedAt` from the first `OrderHistory` row with status `confirmed`; `dispatchedAt` from the first row with `out_for_delivery` (or the first `delivered` row if there is none); `firstContactAt` from the earliest `Call` on the order. The script prints counts of filled and unfilled rows.
  - [ ] Orders with no history get no value. They are left out of the medians. They are not filled with a guess.
  - [ ] Fields are indexed for the KPI queries: `(tenantId, confirmedAt)`, `(tenantId, dispatchedAt)`.
- Data: `Order.confirmedAt DateTime?`, `Order.dispatchedAt DateTime?`, `Order.firstContactAt DateTime?`.
- API: fields appear in order JSON.
- Permissions: read with the order.
- Edge cases and errors:
  - GUESS: `OrderHistory` has enough rows to backfill (design open item 11). Check the share of delivered orders with a `confirmed` history row on production before you promise medians for history. Orders imported or synced by jump may have no `confirmed` row.
  - An order that jumps from `pending_confirmation` to `delivered` by force has `confirmedAt` set to the move time.
  - Dates use UTC in the database. Africa/Accra has no daylight saving, so UTC equals Accra time.
- Tests: unit tests for set-once behaviour; backfill script test on a fixture of 20 orders with mixed history; test that an automatic message, a manual message and a non-YES reply do not set `firstContactAt`.

### F-305: Stock leaves once per order
- Priority: P0. Milestone: M0 (write the failing test), M4 (fix with the stock ledger).
- Description: Stock is taken twice today (matrix section 3 #7, design risk). `publicOrderService.createPublicOrder` decrements `Product.stockQuantity` when the order is created (line 284). The status machine decrements again when the order enters `out_for_delivery` or `delivered` (`orderService.ts` lines 1040 to 1070). The new rule: stock leaves exactly once, when the order is delivered, from the delivery partner's location. Creation and dispatch move no stock. The full rule, the ledger and the tests are in the stock area, F-657 (file 06). This requirement states what the orders side must do so that F-657 works.
- Current app: `publicOrderService.ts` line 284; `orderService.ts` `updateOrderStatus`, `updateOrder`, `cancelOrder`, `deleteOrder`; `agentInventoryService.recordOrderFulfillment`, `confirmOrderDelivery`, `reverseOrderFulfillment`. Manual orders (`createOrder`) only check stock. Public checkout also decrements only the package product, not upsell products.
- Mockup: not applicable.
- Rules for the orders side (the stock service decides the quantities):
  1. Creating an order (checkout, manual, import at start state, webhook) writes no stock movement. It may read "available to sell" (on hand minus reserved, F-651) to refuse an order the business cannot supply.
  2. Entering `out_for_delivery` writes no movement. The units count as reserved at the holder's location (F-657).
  3. Entering `delivered` (also by a jump) calls `stockService.fulfilOrder` once. It writes one `order_fulfillment` movement per order line, from the holder at that moment. An order with no delivery partner cannot move to `delivered` through the app ("Assign a delivery partner first"). This also applies to forced moves (F-302).
  4. Leaving `delivered` (returned, or moved back) calls `stockService.reverseOrder` once (`order_reversal`).
  5. `failed_delivery` and `cancelled` before delivery move no stock.
  6. Editing order lines before dispatch changes reserved units only (F-318).
  7. The holder can change between dispatch and delivery. The holder at delivery is used (F-314).
  8. Not enough units at the holder does not block the delivery. On hand may go below zero and a stock-gap Finding opens (F-657, decision R11).
- Acceptance criteria:
  - [ ] M0 test (written first, fails on current code): create a public order of 2 units, move it to `out_for_delivery`, then `delivered`. The test records the real change (expected with current code: -4) and is rewritten in M4 to expect -2.
  - [ ] After the fix, the sum of movements for the order is -2 and a repeated `delivered` call adds nothing.
  - [ ] A public order for 1 package unit with an upsell of 1 unit of another product changes no stock at creation.
  - [ ] No code outside the stock service changes a stock quantity. `Product.stockQuantity` becomes the sum over locations (design 5.3).
  - [ ] The state machine calls the stock service from one place (the `delivered` entry hook, F-303). `deliveryService.completeDelivery` goes through the machine (F-303).
- Data: none owned here. Uses `StockLevel` and the movement ledger of the stock area (F-651, F-657).
- API: none new.
- Permissions: not applicable.
- Edge cases and errors:
  - Orders already in `out_for_delivery` when this ships were drawn from stock at dispatch under the old rule. The stock migration in F-657 corrects them. Do not release the order-side change without that migration.
  - Two orders for the last unit delivered at the same time: both deliver; on hand goes negative and a Finding opens (F-657).
- Tests: the M0 test above; integration tests for rules 1 to 8 (owned jointly with F-657).

### F-306: Reasons on orders: decline, cancel, failure and next attempt
- Priority: P1. Milestone: M1 (fields), M7 (rep UI), M10 (agent app).
- Description: Orders need structured reasons. They feed decline-reason KPIs, the refusal rule (F-357) and the re-delivery queue. A rep who marks a call as Declined cancels the order with a reason. A delivery agent who reports a failed delivery gives a failure reason.
- Current app: none. The mockups show reason chips in `rep.html` (Queue) and `agent.html` (Report failed).
- Mockup: `rep.html#queue` decline chips; `agent.html` Report failed sheet (chips: Not reachable, Refused, Wrong address, Rescheduled).
- Acceptance criteria:
  - [ ] `Order.declineReason` enum: `price_too_high`, `prank_or_mistake`, `changed_mind`, `bought_elsewhere`, `wrong_number`, `other`. (F-758 in file 08 lists five reasons; `wrong_number` is added here because the matrix fix E3 says a wrong-number call cancels the order with that reason.) Required when the order enters `cancelled` from `pending_confirmation` by a call outcome. Optional (free note) for other cancels.
  - [ ] `Order.failureReason` enum: `not_reachable`, `refused`, `wrong_address`, `rescheduled`, `other`. Required when the order enters `failed_delivery`. The admin status dialog shows a select. The delivery agent app (B2, F-800 range) sends it.
  - [ ] `Order.nextAttemptDate Date?`. Set when the reason is `rescheduled`, or when someone plans a re-delivery. The order list shows the flag "Re-delivery Tue 20 Oct".
  - [ ] Reasons are visible in the drawer timeline and in exports.
  - [ ] A move back to `out_for_delivery` keeps `failureReason` in history and clears the current field.
- Data: `Order.declineReason`, `Order.failureReason`, `Order.nextAttemptDate`; enums `DeclineReason`, `FailureReason`.
- API: `PATCH /api/orders/:id/status` accepts `{declineReason?, failureReason?, nextAttemptDate?}`.
- Permissions: whoever may make the move.
- Edge cases and errors:
  - Bulk status change to `failed_delivery` or `cancelled` asks for one reason for all selected orders.
  - Orders in history (before M1) have no reason. Reports show "Not recorded".
  - "Rescheduled" is not a real failure. It stays a failure reason because the agent app lists it. The delivery success rate (Dashboard and KPI area, A, F-200 range) counts an order that is later delivered only once, as delivered.
- Tests: unit test that a move to `failed_delivery` with no reason is rejected; test that a Declined call writes `declineReason`.

### F-307: Orders list
- Priority: P0. Milestone: M3.
- Description: The orders list is the main working screen. It keeps all current columns and adds the call rep, delivery agent, flags and chips from the mockup. There is no Kanban (F-327).
- Current app: `frontend/src/pages/Orders.tsx`, `GET /api/orders`.
- Mockup: `index.html#orders`. Header text "1,445 orders in October." Buttons Import, Export, New order. Columns: select, Order (number, date), Customer (initials, name, phone), Product (first item x quantity, "+ n more"), Status (tag, flag line, chips "Reminder 20 Oct, 16:00" and "4 replies"), Call rep, Delivery agent, Amount, Assign.
- Acceptance criteria:
  - [ ] Columns: select, Order, Customer, Alternate phone (hidden by default, shown from the column menu), Product, Status, Call rep, Delivery agent, Amount, Date, Assign. Widths are resizable and saved per user in `localStorage` (try and catch; the page works without it).
  - [ ] "Unassigned" shows in grey when no rep or agent is set. Delivery agent shows "—" for orders not yet confirmed.
  - [ ] The status cell shows the tag, then a flag line when a flag applies (F-312), then the reminder chip and the reply-count chip when they exist.
  - [ ] Clicking a row opens the details drawer (F-321). Checkbox and Assign icon clicks do not open the drawer.
  - [ ] The footer reads "Showing n of N orders". Empty state: "No orders match."
  - [ ] The list refreshes on socket events `order:created`, `order:updated`, `order:status_changed` (as today). Rooms are scoped by tenant (area A, matrix section 3 #31).
  - [ ] Money uses the store currency from the config store (no hard-coded `$` or GH₵).
  - [ ] A rep sees only orders where `customerRepId` is their id. A delivery agent sees only their orders. Other roles see all.
  - [ ] First page loads in under 1 second for 1,445 orders at page size 25 on staging (GUESS target; confirm with a load test).
- Data: none new. List query joins call rep, delivery agent, first item, reminder (F-325), thread count (F-326).
- API: `GET /api/orders` gains `include=flags,reminder,threadCount`. Response adds `flags[]`.
- Permissions: `orders:view`; row scope by role.
- Edge cases and errors:
  - Orders with a deleted rep or agent user show the name with "(removed)".
  - A very long address is cut in the list and shown in full in the drawer.
- Tests: integration test for rep and agent row scope; component test for flag line; e2e: open the list, sort, open a row.

### F-308: Status tabs with counts
- Priority: P1. Milestone: M3.
- Description: Tabs filter the list by status and show counts. They replace the side filter panel with nine checkboxes. The counts come from the server and match NUMBERS.md for the October sample.
- Current app: `FilterPanel` with 9 checkboxes in `Orders.tsx`.
- Mockup: `index.html#orders` tabs: All 1,445; Pending confirmation 64; Confirmed 21; Preparing 41; Ready for pickup 38; Out for delivery 148; Delivered 376; Failed delivery 354; Returned 48; Cancelled 355; Unpaid by agent 38.
- Acceptance criteria:
  - [ ] One tab per status in the mockup plus the "Unpaid by agent" tab (F-309).
  - [ ] Two extra tabs show only when their count is above 0: "Digital" (`digital_delivered`) and "Payment issues" (`payment_pending` and `payment_failed` together).
  - [ ] Counts come from `GET /api/orders/counts` with the active filters except status. The sum of the nine physical tabs equals "All" minus the digital and payment tabs.
  - [ ] Confirmed 21 + Preparing 41 + Ready for pickup 38 = 100 "waiting to dispatch" (NUMBERS.md). The page can show a small note "100 waiting to dispatch" on the three tabs.
  - [ ] Tab labels use the status names in this PRD. "Not reachable" is never a tab (matrix section 4 #10; it is a call outcome).
  - [ ] The selected tab is kept in the URL (`?status=`) so a link opens the same view.
- Data: none.
- API: `GET /api/orders/counts` (new).
- Permissions: `orders:view`. Counts respect row scope.
- Edge cases and errors: counts must not use the tab page size; a big tenant needs an index on `(tenantId, status, deletedAt)`.
- Tests: integration test for counts on a fixture that matches the October numbers; e2e: click a tab and check the row count.

### F-309: "Unpaid by agent" tab
- Priority: P1. Milestone: M5 (needs deposits and days to pay).
- Description: The tab lists delivered orders whose cash the delivery partner still holds, past the partner's days to pay. It shows the owner and the finance clerk where cash is stuck. Sample: 38 orders.
- Current app: none.
- Mockup: `index.html#orders` tab "Unpaid by agent 38" and flag "Not paid after 11 days".
- Acceptance criteria:
  - [ ] The tab shows orders with status `delivered`, a delivery partner, no deposit allocated, and days since `deliveryDate` greater than the partner's days to pay (set in Deliveries, B2, F-700 range; default in Settings → Operations, C, F-1200 range).
  - [ ] The same rule feeds the KPI "Unpaid delivered orders by age" (Finance area, C, F-900 range). One query, shared.
  - [ ] Each row shows the flag "Not paid after N days".
- Data: none new. Reads `AgentCollection`, `PartnerSettlement` and the partner's days to pay.
- API: `GET /api/orders?tab=unpaid_by_agent`.
- Permissions: `orders:view` plus `financial:view`; call reps and delivery agents do not see this tab.
- Edge cases and errors: a partner with no days-to-pay set uses the Settings default. If that is also empty the tab uses 8 days (GUESS from the design sample "unpaid over 8 days"; owner confirms).
- Tests: integration test with three partners and different days to pay.

### F-310: Search, sort, pagination, page size and column resize
- Priority: P1. Milestone: M3.
- Description: Keep what exists and show it in the new design. Sorting moves to the server so it works across pages. The mockup footer shows only a count. We add the page controls.
- Current app: `SearchBar`, client-side sort on the loaded page, page sizes 25/50/75/100, resizable columns in `localStorage`.
- Mockup: search box (live), footer "Showing n of N orders". Page controls not shown.
- Acceptance criteria:
  - [ ] Search matches order number, phone (any format, F-362), customer first and last name. It runs 300 ms after the last key press.
  - [ ] Sort on Order, Customer, Amount, Date. The sort runs on the server (`sortBy`, `sortOrder`).
  - [ ] Page sizes 25, 50, 75, 100. Default 25. The page size is saved per user.
  - [ ] The footer has previous and next buttons and the page number.
  - [ ] Column widths are saved per user (see F-307).
- Data: none.
- API: `GET /api/orders` adds `sortBy`, `sortOrder`.
- Permissions: `orders:view`.
- Edge cases and errors: search with fewer than 3 characters waits for more input. A phone search with spaces or `+233` matches (F-362).
- Tests: integration test for server sort; e2e: search for a phone in two formats.

### F-311: Date range filter with a date basis
- Priority: P1. Milestone: M3.
- Description: The mockup has no date filter. The current app has one. Revenue uses the delivery date, so one filter on order date is not enough. The filter has a basis: order date or delivery date.
- Current app: `DateRangePicker`; `getAllOrders` filters `createdAt` only.
- Mockup: not in mockup. Build in v2 style: a button "This month" with a menu (Today, Yesterday, Last 7 days, This month, Last month, Custom) and a small segmented control "Order date | Delivery date" in the filter row.
- Acceptance criteria:
  - [ ] Default is "This month" on "Order date".
  - [ ] "Delivery date" filters on `Order.deliveryDate` and so shows only delivered orders.
  - [ ] Dates are in Africa/Accra time (UTC). The end date includes the full day.
  - [ ] The range is in the URL (`?from=&to=&basis=`).
  - [ ] Tab counts (F-308) use the same range.
- Data: index `(tenantId, deliveryDate)`.
- API: `GET /api/orders` adds `dateBasis=created|delivery`, `startDate`, `endDate`.
- Permissions: `orders:view`.
- Edge cases and errors: `startDate` after `endDate` returns HTTP 400 "The start date is after the end date."
- Tests: integration test of both bases on a fixture around midnight.

### F-312: Filters and order flags
- Priority: P1. Milestone: M3 (filters), M11 (flags from problem finders).
- Description: Four filters are dead buttons in the mockup: Product, Agent, Assigned to, Flagged by agent. They must work. "Flagged by agent" means flags from the AI assistant's problem finders (the page header says "The agent flags orders that need you"). Flags are computed, not stored.
- Current app: only status and date filters. `getAllOrders` supports `customerRepId`, `deliveryAgentId`, `area`, `customerId` in the API but not in the UI.
- Mockup: `index.html#orders` filter buttons; flag lines such as "Re-delivery Tue 20 Oct" and "Not paid after 11 days".
- Flag list (release one):

| Flag | Rule |
|---|---|
| No call rep | status `pending_confirmation` and no `customerRepId` |
| Re-delivery planned | status `failed_delivery` and `nextAttemptDate` set |
| Not paid after N days | the rule in F-309 |
| Waiting to dispatch too long | status in pre-dispatch and older than the Settings → Operations limit (GUESS default 3 days; NUMBERS.md oldest is 3 days) |
| Customer high risk or COD off | F-357 |
| Reminder due | an open reminder on the order is overdue |
| Digital delivery failed | order type digital, status `confirmed`, paid, and no download link sent after 5 minutes |

- Acceptance criteria:
  - [ ] Filter "Product" (multi-select from active products), "Delivery agent" (partners), "Assigned to" (call reps and "Unassigned"), "Flagged" (any flag, or one flag).
  - [ ] Filters combine with tabs, search and dates. The URL keeps them.
  - [ ] An order can have several flags. The cell shows the most urgent one and "+1".
  - [ ] Flags come from one service (`orderFlagService`). The same service feeds the suggestion cards on the Orders page (F-561 style, read-only).
- Data: none stored. Index `(tenantId, deliveryAgentId, status)` exists.
- API: `GET /api/orders` adds `productId[]`, `deliveryAgentId`, `customerRepId` (or `unassigned=true`), `flag`.
- Permissions: `orders:view`.
- Edge cases and errors: a deleted product still filters old orders by name. A customer with several flags counts once per order.
- Tests: unit test per flag rule; integration test for filter combinations.

### F-313: Change status (row and bulk) through the machine
- Priority: P0. Milestone: M3.
- Description: The status select in the row and the bulk "Change status" menu both call the machine (F-301). Bulk changes report results order by order.
- Current app: inline `<select>` of 9 statuses; bulk bar "Change Status...". `PATCH /api/orders/:id/status`. Bulk status loops client-side (GUESS).
- Mockup: bulk bar "n selected" with Change status menu of the 9 statuses.
- Acceptance criteria:
  - [ ] The row status control opens a menu of the moves from `GET /api/orders/:id/transitions`. A move that needs a reason opens a small dialog (F-306).
  - [ ] Bulk change sends one request. The server applies each order alone and returns `{succeeded: [...], failed: [{id, code, message}]}`.
  - [ ] The toast reads "18 orders moved to Confirmed. 2 could not move" with a link "Show the 2". The failed orders stay selected.
  - [ ] Bulk change shows only moves valid for all selected orders. If none is valid, the menu says "These orders have no move in common."
  - [ ] Each success writes its own history row and runs its own side effects.
- Data: none.
- API: `PATCH /api/orders/bulk/status` `{orderIds[], status, note?, declineReason?, failureReason?}`.
- Permissions: `orders:update` plus role gate (F-301).
- Edge cases and errors: more than 200 orders in one request returns HTTP 413 with "Select 200 orders or fewer."
- Tests: integration test for partial success; e2e: bulk confirm 3 orders.

### F-314: Assign call rep and delivery agent (row, bulk, drawer)
- Priority: P0. Milestone: M3.
- Description: The assign endpoints exist but no screen uses them (matrix section 3 #27). Build the UI in three places: the row Assign menu, the bulk bar, and the drawer. The assign action changes who owns the order. It does not change status.
- Current app: `PATCH /api/orders/:id/assign-rep` and `/assign-agent` (`orders:assign`). `assignmentService` skips inactive, unavailable and blocked agents.
- Mockup: row Assign icon menu (Call rep list, Delivery agent list, "Unassign both"); bulk bar "Assign to call rep" and "Assign to delivery agent"; drawer selects "Call rep" and "Delivery agent".
- Acceptance criteria:
  - [ ] Call rep list: users who hold the Call rep role (people and AI agents, e.g. Adwoa Darko, Nana Kyei, Confirm agent). Delivery agent list: partners (Kofi Appiah, Esi Badu, Kwesi Amoah, Logiswift, Kasapa Express).
  - [ ] Bulk assign works for up to 200 orders and shows the same result report as F-313.
  - [ ] "Unassign both" clears both fields.
  - [ ] A partner who is blocked (cash not deposited) shows a warning "Blocked for unpaid cash" and the owner can still pick them with a confirm. A partner marked unavailable shows "Not available today".
  - [ ] Changing the delivery agent is allowed in every open state (not in `delivered`, `digital_delivered`, `returned`, `cancelled`). In `out_for_delivery` the screen asks "This order is with <name>. Move it to <new name>?" and the history row records both names. The reserved units move with the order. Stock leaves the holder at delivery time (F-305 rule 7).
  - [ ] Each change writes an `OrderHistory` row (note "Assigned to Adwoa Darko by Manny") and an inbox notification "Order assigned to you" to the new holder (F-557).
  - [ ] The suggestion card "9 new orders have no call rep" opens the Orders list filtered to "Unassigned" with the 9 rows selected and the bulk assign menu open. It does not assign by itself (G10).
- Data: none.
- API: existing endpoints; add `PATCH /api/orders/bulk/assign` `{orderIds[], customerRepId?, deliveryAgentId?}`.
- Permissions: `orders:assign` (owner, admin, manager). Call reps cannot assign.
- Edge cases and errors: assigning an AI agent as call rep is allowed. Assigning to a deactivated user is blocked.
- Tests: integration tests for blocked agent, bulk result, reassign during `out_for_delivery`; e2e: assign from the row menu.

### F-315: Bulk delete with a count confirm
- Priority: P2. Milestone: M3.
- Description: Bulk delete has no confirmation in the mockup. Add one. Deleted orders are soft deleted (`deletedAt`).
- Current app: `DELETE /api/orders/bulk` (limiter), browser `confirm` for single delete.
- Mockup: bulk bar Delete, no confirm (matrix section 4 #29).
- Acceptance criteria:
  - [ ] One confirm dialog pattern for the whole app (F-328): title "Delete 12 orders?", body with the count and the line "You cannot undo this.", buttons Cancel and Delete.
  - [ ] Orders that cannot be deleted (rules in F-316) are skipped and listed in the result.
  - [ ] The call is audited: one `AuditLog` row with the id list.
- Data: none.
- API: `DELETE /api/orders/bulk` returns `{deleted: n, skipped: [{id, reason}]}`.
- Permissions: `orders:delete` (owner, admin).
- Edge cases and errors: deleting 0 selectable orders shows "None of these orders can be deleted."
- Tests: integration test with a mix of deletable and blocked orders.

### F-316: Delete a single order
- Priority: P2. Milestone: M3.
- Description: The row action "Delete Order" exists today and the mockup left it out. Keep it in the drawer footer menu and the row menu.
- Current app: `DELETE /api/orders/:id`, browser confirm. `deleteOrder` blocks `delivered` only.
- Mockup: not in mockup (add "Delete order" in the drawer "More" menu).
- Acceptance criteria:
  - [ ] Allowed states: `pending_confirmation`, `payment_pending`, `payment_failed`, `confirmed`, `preparing`, `ready_for_pickup`, `cancelled`, `failed_delivery`.
  - [ ] Blocked states: `out_for_delivery` (units are out), `delivered`, `digital_delivered`, `returned` (money or stock effects exist). The message says what to do: "Cancel or return the order first."
  - [ ] The same confirm dialog as F-315.
  - [ ] Delete removes a draft `AgentCollection`, refreshes customer stats and writes the audit row.
  - [ ] The message log and call log of the order stay (linked to the customer).
- Data: none.
- API: `DELETE /api/orders/:id`.
- Permissions: `orders:delete`; call reps cannot delete.
- Edge cases and errors: delete of an order that has an open reminder or thread: the reminder is closed and the thread is archived (F-552, F-553).
- Tests: integration test per state.

### F-317: New order (manual, phone or WhatsApp order)
- Priority: P0. Milestone: M3 (owner), M7 (rep, G9).
- Description: Staff add an order by hand from a phone call or a WhatsApp chat. Reps can do this (G9). The form adds Region and Town and an editable total. A rep-created order is assigned to the rep who made it, or the rep cannot see it.
- Current app: `OrderForm` (customer name, email, phone, alternate phone, status, items, street, state). `POST /api/orders` `createOrder`. It does not set `customerRepId`.
- Mockup: `index.html#orders` New order drawer: Customer name, Phone, Delivery address, Region (select), Town or area, product lines (Product, Qty, Price), Order total (editable), Status, Call rep, Delivery agent. Footer Cancel and Create order.
- Acceptance criteria:
  - [ ] Fields: customer name, phone, alternate phone, email (optional), address, Region (the store country's regions), Town or area, product lines (product, quantity, unit price, remove line, Add product line), discount, order total, notes, Call rep, Delivery agent.
  - [ ] The total starts as the sum of lines minus discount. The user can edit it. If the edited total differs from the computed one, the form shows "Total differs from the lines by GH₵X" and asks for a reason in the notes. The order keeps `subtotal`, `discount` and `totalAmount`.
  - [ ] Status is not a free field. Every manual order starts as `pending_confirmation`. The mockup shows a status select with 9 values; replace it with a checkbox "Customer already confirmed on this call" (also in the rep screen, F-765). When ticked, the order is created and then moved to `confirmed` through the machine, and a `Call` row (outcome confirmed, source manual) is saved for the person who made it, so the pay rule works. A walk-in sale uses a later move.
  - [ ] A phone that matches an existing customer links the order to that customer (F-362). The form shows "Existing customer: Abena Owusu, 3 orders" with a link. If the customer is COD-blocked (F-357) the form shows the notice and creates the order with `requiresManualCall = true`.
  - [ ] When a `sales_rep` creates the order, `customerRepId` is set to their id and `createdById` too. The rep sees it in their list and in their queue.
  - [ ] Call rep and Delivery agent fields are visible to roles with `orders:assign`. Reps do not see them.
  - [ ] Stock check: the form blocks a line when "available to sell" (on hand minus reserved, F-651) is below the quantity ordered, and shows the units available.
  - [ ] `source = manual`. `createdById` is set.
  - [ ] `order_created` workflows and the auto-confirm flow (F-466) run for manual orders too.
- Data: `Order.requiresManualCall Boolean @default(false)`.
- API: `POST /api/orders` accepts `deliveryState` (region), `deliveryArea` (town), `discount`, `totalAmount`, `customerRepId`, `deliveryAgentId`.
- Permissions: `orders:create` (owner, admin, manager, sales_rep).
- Edge cases and errors:
  - Customer row needs address, state and area (required columns). The form requires them.
  - Duplicate order within 30 minutes for the same phone, product and total: show "A similar order was placed at 14:05. Create it anyway?" (same rule as public checkout dedupe, GUESS that manual orders get it too).
  - Phone with 9 digits and no leading 0 is accepted (Ghana). Fewer than 9 digits is an error.
- Tests: integration tests for rep self-assign and visibility; blocked-customer flag; total-differs rule; e2e: rep creates an order and sees it in My orders.

### F-318: Edit order (items, contact, address) and alternate phone
- Priority: P0. Milestone: M3.
- Description: Reps fix addresses and quantities during the confirm call. The mockup drawer edits only status and assignment. Add edit mode to the drawer. Which fields can change depends on the status. Alternate phone is kept as a field (OR-14).
- Current app: `OrderForm` edit mode; `PUT /api/orders/:id` `updateOrder`. It rewrites the customer's name, email and phone for all their orders. It changes stock on lines only for `out_for_delivery` and `delivered`.
- Mockup: not in mockup. Build in v2 style: an "Edit" button in the drawer header turns Customer, Items and Payment blocks into inputs. Footer: Cancel, Save changes (the mockup footer already has Save changes).
- Acceptance criteria:
  - [ ] Editable fields by status:

| Status group | Editable |
|---|---|
| `pending_confirmation`, `payment_pending`, pre-dispatch | name, phone, alternate phone, email, address, region, town, items (add, remove, quantity, price), discount, total, notes |
| `out_for_delivery`, `failed_delivery` | phone, alternate phone, address, region, town, notes |
| `delivered`, `digital_delivered`, `returned`, `cancelled` | notes only |

  - [ ] Each save writes an `AuditLog` row with `before` and `after` for changed fields, and a timeline entry "Edited by Adwoa: address, total".
  - [ ] Changing items after dispatch is not allowed in the normal flow. Item edits before dispatch change reserved units only and never on-hand stock (F-305).
  - [ ] Changing the total on a `confirmed` order shows "The customer confirmed GH₵249. The new total is GH₵498." and needs a confirm tick.
  - [ ] Changing the phone: if the new number belongs to another customer, the save is blocked with "This number belongs to Kojo Agyeman" and a link. If the customer has only this order, the customer record updates. If the customer has other orders, the save asks "Update the number for all of this customer's orders?" with Yes or Cancel.
  - [ ] A rep can edit only own orders (`customerRepId`). The delivery agent cannot edit.
  - [ ] Version check: if another person saved first, the save fails with "This order changed. Reload to see the new data."
- Data: none.
- API: `PUT /api/orders/:id` with field rules per status; returns HTTP 409 `STALE_ORDER` on a version clash (send `statusVersion` or `updatedAt`).
- Permissions: `orders:update`; reps on own orders only.
- Edge cases and errors: removing every item is blocked ("An order needs at least one item"). Editing price to 0 is allowed only for the owner and admin (free bundle).
- Tests: integration tests per status group; phone-collision test; audit test.

### F-319: Import orders (CSV, XLSX, XLS)
- Priority: P1. Milestone: M3.
- Description: Keep import. Add a check step before the import runs, as the mockup shows ("42 rows read, 40 ready, 2 need a fix"). The import can create history orders in any non-payment status. It goes through the machine (F-301).
- Current app: `BulkImportModal`, `POST /api/orders/upload` (multer, 10 MB), `POST /api/orders/bulk` (batches of 50), duplicate window 24 hours, `isForwardStatus` moves a duplicate forward.
- Mockup: Import modal: Download template (columns `customer_name, phone, address, region, product, quantity, price, status`), drop zone "Up to 2,000 rows", result row, fix list, button "Import 40 orders".
- Acceptance criteria:
  - [ ] Step 1 (check): `POST /api/orders/upload/validate` reads the file and returns row counts, ready rows and per-row problems. Nothing is saved.
  - [ ] Step 2 (import): the user clicks "Import 40 orders". Only ready rows import. Fixable rows can be downloaded as a CSV with a "problem" column.
  - [ ] Limits: 2,000 rows and 10 MB per file. More rows return "Split the file into parts of 2,000 rows."
  - [ ] Checks: phone has 9 to 15 digits (a Ghana number with or without the leading 0); region matches one of the country's regions (a near match like "Ashante" shows "Did you mean Ashanti?" and is not auto-fixed); product matches a product name or SKU; quantity is a whole number above 0; price is a number.
  - [ ] Status column: `pending_confirmation`, `confirmed`, `cancelled` and later states are accepted. `payment_pending`, `payment_failed` and `digital_delivered` are rejected. Orders imported as `delivered` use the row date as `deliveryDate` and post revenue (the machine runs). Stock follows F-305 rule 3 for `out_for_delivery` and `delivered` rows.
  - [ ] Rep and agent name columns map to users by name (as today). Unknown names are a row problem.
  - [ ] Duplicates: same phone, address and amount within 24 hours (as today). A duplicate with a later status moves the existing order forward using the machine table. Otherwise the row is skipped and listed.
  - [ ] The result screen shows Successful, Failed, Duplicates and a link "Show the imported orders".
  - [ ] Import is audited: one `AuditLog` row with file name, row counts and the user.
- Data: none.
- API: `POST /api/orders/upload/validate` (new); `POST /api/orders/upload` (import ready rows).
- Permissions: `orders:bulk_import` (owner, admin, manager).
- Edge cases and errors: an XLSX with merged cells or several sheets: read the first sheet only and say so. A file with a BOM or semicolon separators is read. A file over 10 MB returns HTTP 413.
- Tests: unit tests for each row check; integration test of validate then import; test that a delivered row books revenue once.

### F-320: Export orders (CSV and Excel)
- Priority: P1. Milestone: M3.
- Description: Export what the list shows, with all filters. Lift the 500-row cap (the mockup exports 1,445 rows). Reports have their own exports (C, F-1050 range); this export is the raw order list.
- Current app: `GET /api/orders/export`, max 500 rows (`BULK_ORDER_CONFIG.EXPORT_MAX_RECORDS`), limiter 5 per 5 minutes.
- Mockup: Export button, toast "Exported 1,445 orders to orders-17-oct.csv".
- Acceptance criteria:
  - [ ] Export respects tab, search, date range, basis and filters.
  - [ ] Formats: CSV and XLSX. The user picks in a small menu. File name `orders-<date>.csv`.
  - [ ] The cap is 50,000 rows (GUESS; confirm with a memory test). The file streams. Above the cap the user sees "Narrow the date range."
  - [ ] Columns: order number, date, customer, phone, alternate phone, region, town, address, products, quantity, status, call rep, delivery agent, subtotal, discount, total, payment method, payment status, delivery date, decline or failure reason, source.
  - [ ] Phone numbers are text, so Excel keeps the leading 0.
  - [ ] Rate limit stays (5 per 5 minutes per user).
- Data: none.
- API: `GET /api/orders/export?format=csv|xlsx` plus the list filters.
- Permissions: new `orders:export`. Default: owner, admin, manager, accountant. Not call reps or delivery agents (a full customer phone list is sensitive).
- Edge cases and errors: if the connection drops the user can retry. Dates in the file are `YYYY-MM-DD HH:mm` Accra time.
- Tests: integration test of 1,445-row export; test that formulas in cells are escaped (a cell starting with `=` is prefixed with `'`).

### F-321: Order details drawer
- Priority: P0. Milestone: M3.
- Description: A side drawer replaces the read-only `/orders/:id` page. It is the full order view and the place to act. The URL `/orders/:id` still works and opens the list with the drawer open.
- Current app: `OrderDetails.tsx` (read-only). Cards: items, customer, payment, timeline (3 dates), assigned to, call history.
- Mockup: `index.html#orders` Order details drawer: header (number, "date, from Meta ad, checkout form", payment tag), Order status, Follow up (Set reminder), Items, Customer, Payment, Assigned to, Timeline, Call history, Team notes, footer Close and Save changes.
- Acceptance criteria:
  - [ ] Blocks in order: header, status (F-301 menu), follow up (F-325), items, customer (Call and WhatsApp buttons use `tel:` and `https://wa.me/<number>`), payment (F-323), assigned to (F-314), timeline (F-322), call history (F-324), messages sent to this customer about this order with status (F-464), team notes (F-326).
  - [ ] Source line shows the real source: "Checkout form: Magic Groove copybook set", "Manual", "Import", "Webhook: Landing page B". The text "from Meta ad" shows only when a campaign name is stored. GUESS: no campaign link is stored on the order today. Show the source only. Marketing (C, F-1000 range) may add the campaign later.
  - [ ] The drawer opens from the list, from a link in the Inbox, from the rep call card and from search. It has its own URL.
  - [ ] Esc and the Close button close it. Unsaved edits show a "Discard changes?" prompt.
  - [ ] The drawer works on a phone width (full screen).
- Data: none.
- API: `GET /api/orders/:id` returns items, customer, assignees, history, calls, messages, reminder, thread summary, flags, transitions.
- Permissions: `orders:view`; row scope by role. Buttons depend on permission.
- Edge cases and errors: a deleted order returns 404 "This order was deleted." An order from another tenant returns 404.
- Tests: component test for blocks; e2e: open, change status, add note.

### F-322: Order timeline
- Priority: P1. Milestone: M3.
- Description: The timeline shows every step with time, person and note. It is built from `OrderHistory`, the three timestamps (F-304), calls and the first messages.
- Current app: three dates (created, last updated, estimated delivery).
- Mockup: order placed, confirmed, packed, ready, out for delivery, delivered, failed, returned, cancelled with times and notes; a planned re-delivery step.
- Acceptance criteria:
  - [ ] One row per history entry: "Confirmed by Adwoa Darko, 14 Oct 10:42". Actor kinds show as person, AI agent, partner or system.
  - [ ] Forced moves show the reason and a small tag "Override".
  - [ ] A planned re-delivery shows as a future row from `nextAttemptDate`.
  - [ ] Edits (F-318), assignments (F-314) and calls (F-324) show as smaller rows.
  - [ ] Times are Accra time. Duration chips: "Confirmed after 12 min" (placed to confirmed), "Delivered after 4.1 days" (confirmed to delivered).
- Data: `OrderHistory.metadata` for edits and assignments.
- API: `GET /api/orders/:id/timeline`.
- Permissions: with the order.
- Edge cases and errors: old orders without `confirmedAt` show the history rows only. Statuses with no actor show "System".
- Tests: unit test of the timeline builder on a fixture with a forced move and a failed delivery.

### F-323: Payment block and payment tag
- Priority: P1. Milestone: M3.
- Description: The payment block shows method, status, amount and who holds the cash. Payment status is a separate field from order status (`PaymentStatus`: `pending`, `paid`, `collected`, `deposited`, `reconciled`). The header tag is derived.
- Current app: Payment card (method, status badge, total amount).
- Mockup: tag Paid / Cash with agent / Overdue from agent / Pay on delivery / No payment; Payment section with status tag, method "Cash on delivery", amount, "Cash held by" (agent name, "Paid in", "Nobody yet").
- Acceptance criteria:
  - [ ] Tag rules:

| Condition | Tag |
|---|---|
| COD, status not `delivered`, `paymentStatus = pending` | Pay on delivery |
| `paymentStatus = collected` and within the partner's days to pay | Cash with agent |
| `paymentStatus = collected` and past the partner's days to pay | Overdue from agent |
| `paymentStatus` is `deposited` or `reconciled` | Paid in |
| online payment `paid` (digital or prepaid) | Paid |
| `cancelled`, or `returned` with no payment | No payment |

  - [ ] Deposit orders (online deposit, rest on delivery) show "Deposit GH₵X paid. GH₵Y due on delivery". The deposit and balance use major units (F-405).
  - [ ] "Cash held by" shows the partner name from the order's `AgentCollection`, "Paid in" when reconciled, "Nobody yet" otherwise.
  - [ ] The block never changes the order status. Payment status moves only through collections and settlements (Finance area, C, F-900 range).
- Data: none new.
- API: order JSON adds `paymentTag`.
- Permissions: `orders:view`; the "Cash held by" line needs `financial:view`.
- Edge cases and errors: an order with no `AgentCollection` yet shows "Nobody yet".
- Tests: unit test of the tag function with one case per row.

### F-324: Calls on an order (log call, call history, outcomes)
- Priority: P0. Milestone: M0 (tenant id on `Call`), M7 (outcomes and rep flow).
- Description: Staff log calls from the drawer and the rep call card. The outcome list changes. Some outcomes move the order. A call also sets `firstContactAt` (F-304). `Call` gets a tenant id and a source.
- Current app: `LogCallModal` and `CallHistoryModal`; `POST /api/calls`; outcomes `confirmed`, `rescheduled`, `no_answer`, `cancelled`, `other`. `Call` has no `tenantId`.
- Mockup: drawer Log call form: Outcome (Confirmed, Rescheduled, No answer, Cancelled, Other), Called by, Note. Rep call card outcomes: Confirmed, Not reachable, Call back later, Declined, Wrong number (`rep.html#queue`).
- Outcome mapping (matrix section 4 E3). The five outcome names and the effects are defined in the rep screen area (F-757, file 08). The drawer Log call form uses the same five outcomes:

| Outcome | Old enum value | Effect on order |
|---|---|---|
| Confirmed | `confirmed` | move to `confirmed` (machine); store the rep as the confirming rep |
| Not reachable | `no_answer` | none; order stays `pending_confirmation`; stays in the queue |
| Call back later | `rescheduled` | none; order moves to the Call backs tab with a time |
| Declined | `cancelled` | move to `cancelled` with a required `declineReason` |
| Wrong number | new | move to `cancelled` with `declineReason = wrong_number`; mark the customer phone as wrong |

- Acceptance criteria:
  - [ ] Enum `CallOutcome` becomes `confirmed`, `not_reachable`, `call_back_later`, `declined`, `wrong_number` (F-757). A migration renames `no_answer` → `not_reachable`, `rescheduled` → `call_back_later`, `cancelled` → `declined`. Old `other` rows: see the check in F-757. The design doc lists only `not_reachable` and `declined`; the rep screen also needs `wrong_number`.
  - [ ] `Call` adds `tenantId` (required after backfill), `startedAt`, `source` (`manual`, `auto_confirm`, `tap_to_call`), `declineReason` and `callbackAt` (shared with F-768 in file 08).
  - [ ] Saving a call with the outcome Confirmed, Declined or Wrong number and the order move happen in one transaction. If the move is invalid (order already `confirmed`), the call is still saved and the response says "Order was already confirmed."
  - [ ] Call back later stores the callback time (`Call.callbackAt`) and creates a reminder for the rep (F-552).
  - [ ] The call history list shows outcome tag, caller, time, length and note. Empty state: "No calls yet. Log the first one."
  - [ ] Callers allowed: owner, admin, manager, sales_rep (as today), plus the AI agent that holds the Call rep role.
- Data: `Call.tenantId`, `Call.startedAt`, `Call.source`, `Call.declineReason`, `Call.callbackAt`; enum `CallOutcome` renamed values plus `wrong_number`; `Customer.wrongNumber Boolean @default(false)`.
- API: `POST /api/calls` accepts the new fields; `GET /api/calls/order/:orderId`.
- Permissions: `calls:create`, `calls:view`.
- Edge cases and errors: a call on an order that belongs to another rep is allowed for owner, admin, manager. A rep cannot log a call on someone else's order.
- Tests: unit test per outcome; integration test that a Declined call cancels the order with a reason; migration test that `Call` backfill sets `tenantId` from the order or customer.

### F-325: Reminder on an order
- Priority: P2. Milestone: M9.
- Description: A "Set reminder" button in the drawer opens a small popover: what, when, who (me or a teammate). The result is a chip on the order and on the list row. The reminder object and its rules are in F-552.
- Current app: none.
- Mockup: drawer Follow up block with popover (What default "Call back about this order", When "18 Oct, 09:00", Who: Me, Adwoa Darko, Nana Kyei, Kofi Appiah); chip "Reminder 20 Oct, 16:00".
- Acceptance criteria:
  - [ ] The popover creates a `Reminder` with `subjectType = order` and the order id (F-552).
  - [ ] The chip shows the next open reminder. A click opens it in the Inbox Reminders view.
  - [ ] The list row chip shows the same.
- Data: see F-552.
- API: `POST /api/reminders`.
- Permissions: any role that can see the order can set a reminder for self. Setting one for a teammate needs `orders:assign` or `manager`.
- Edge cases and errors: past dates are blocked.
- Tests: component test for the popover; integration test for the chip.

### F-326: Team notes thread on an order
- Priority: P2. Milestone: M9.
- Description: A threaded note area in the drawer. People write notes, reply and mention teammates with `@`. The thread object is in F-553.
- Current app: none (there is `Order.internalNotes`, a single text field).
- Mockup: drawer Team notes: threaded notes with replies, "n replies" chip, textarea "Write a note. Type @ to mention a teammate.", quick mention buttons, Post note, empty state "No notes yet."
- Acceptance criteria:
  - [ ] The drawer shows the thread for `subjectType = order`. A post creates a `Comment`.
  - [ ] A mention sends an inbox notification to that person (F-556).
  - [ ] "Open in Inbox" opens the thread in the Inbox Team threads view.
  - [ ] `Order.internalNotes` is shown as the first note "Imported note" until the thread has comments. A migration copies non-empty `internalNotes` into a first comment by the system user.
- Data: see F-553.
- API: `GET/POST /api/threads/order/:id/comments`.
- Permissions: roles that see the order can read and write. Delivery agents see only threads on their own orders.
- Edge cases and errors: a thread on a deleted order is archived.
- Tests: component test; integration test for the `internalNotes` migration.

### F-327: Remove the Kanban view
- Priority: P2. Milestone: M3.
- Description: The owner removed the Kanban board in round 2. Delete it and its settings. The order failed-delivery status is missing from Kanban today (matrix section 3 #49) and its currency is hard-coded as `$` (#25). Both problems disappear with the code.
- Current app: `OrdersKanban`, `components/kanban`, `GET /api/orders/kanban`, user preference `ordersDefaultView`.
- Mockup: none (no Kanban).
- Acceptance criteria:
  - [ ] `OrdersKanban.tsx`, `components/kanban/*`, the view toggle and `dnd-kit` use for orders are deleted. (`dnd-kit` stays if the checkout field builder uses it.)
  - [ ] `GET /api/orders/kanban` is removed.
  - [ ] The preference `ordersDefaultView` is ignored and removed from the preference schema. Old values do not cause errors.
  - [ ] No `$` is hard-coded in any order component.
  - [ ] `/orders` always shows the list.
- Data: remove `ordersDefaultView` from `User.preferences` handling (do not rewrite old rows).
- API: remove `GET /api/orders/kanban`.
- Permissions: not applicable.
- Edge cases and errors: bookmarked `?view=kanban` URLs open the list.
- Tests: build passes with no references (TypeScript, lint); e2e: `/orders?view=kanban` shows the list.

### F-328: Wire or remove every button; one confirm dialog
- Priority: P2. Milestone: M3.
- Description: About 40 buttons in the mockups do nothing (matrix section 4 #25). Every button on the Orders and Customers screens must work or be removed. Delete confirms must follow one pattern (matrix section 4 #29).
- Current app: Orders delete uses the browser `confirm`.
- Mockup: dead on Orders: filters Product, Agent, Assigned to, Flagged by agent; drawer Call and WhatsApp; "Dismiss" on the agent card. Dead on Customers: Export, Add customer, filter buttons, rows, "Draft the offer", "Dismiss".
- Acceptance criteria:
  - [ ] Wired: Orders filters (F-312), Call and WhatsApp links (F-321), Customers Export (F-361), Add customer (F-355), Customers filters (F-353), customer rows (F-354).
  - [ ] "Dismiss" on a suggestion card hides it for that user for 24 hours (browser `localStorage`, with a safe fallback).
  - [ ] Removed: Download report is not here (Dashboard, area A). Nothing else stays dead.
  - [ ] One shared `ConfirmDialog` component: title with the count, a plain sentence, Cancel and a red action button. All deletes in Orders, Customers, Checkout forms, Workflows and Staff use it. No browser `confirm`.
  - [ ] A test scans the Orders and Customers pages for buttons with no handler and fails the build.
- Data: none. API: none.
- Permissions: not applicable.
- Edge cases and errors: none.
- Tests: component test for `ConfirmDialog`; static test for missing handlers.

### F-363: Tenant scope for models in orders, customers, checkout and messages
- Priority: P0. Milestone: M0.
- Description: Matrix section 3 #36 and #46: twelve models have no `tenantId`, and the tenant extension lets queries through when there is no tenant context. This requirement covers the models in my areas. Area A covers the rest (M0 foundation).
- Current app: `Call`, `OrderHistory`, `OrderItem`, `FormSubmission`, `FormPackage`, `FormUpsell`, `SmsTemplate`, `WebhookLog`, `AuditLog` have no `tenantId`. `PendingCheckout` and `WebhookEvent` have a `tenantId` but are not in the extension's scoped list.
- Mockup: not applicable.
- Acceptance criteria:
  - [ ] Add required `tenantId` to `Call`, `OrderHistory`, `FormSubmission`, `SmsTemplate`, and to the new models in this PRD (`MessageEvent`, `Conversation`, `Reminder`, `Thread`, `Comment`, `Campaign`).
  - [ ] Backfill `Call.tenantId` from the order or customer; `OrderHistory.tenantId` from the order; `FormSubmission.tenantId` from the form.
  - [ ] Add `PendingCheckout` and `WebhookEvent` to the scoped list.
  - [ ] Make `SmsTemplate.name` unique per tenant.
  - [ ] A two-tenant test proves tenant B cannot read tenant A's calls, history, submissions or templates.
  - [ ] `OrderItem`, `FormPackage` and `FormUpsell` are child rows. They are reached only through a scoped parent. A test proves no route reads them alone.
- Data: as listed. API: none.
- Permissions: not applicable.
- Edge cases and errors: rows whose parent has a null `tenantId` stay null and are listed in a report for manual fix.
- Tests: two-tenant isolation tests; migration test on a copy of production.

---

## 3. Requirements: Customers (F-350 to F-399)

### F-350: Customer list
- Priority: P0. Milestone: M3.
- Description: The list shows who buys, who comes back and who refuses delivery. It adds orders, delivered, refused, delivered value, last order and risk to the current columns.
- Current app: `frontend/src/pages/Customers.tsx`; `GET /api/customers`. Columns: customer, phone, location (state), orders, total spent, actions. Row click opens the detail.
- Mockup: `customers.html` columns: Customer (initials, name, phone), City, Orders, Delivered, Refused, Delivered value, Last order, Risk (Low, Watch, High; tags Not reachable, Blocked). Footer "Showing 11 of 6,420 customers" and the risk rule text.
- Acceptance criteria:
  - [ ] Columns as in the mockup. "City" shows `Customer.area` (town). Region shows in the detail.
  - [ ] Counts come from the stored stats (F-357), not from joins per row.
  - [ ] The footer reads "Showing n of N customers" and the risk rule: "Low means no refusals, watch means 1, high means 2 or more."
  - [ ] Rows are clickable and open the detail page (F-354).
  - [ ] Row scope: owner, admin, manager see all customers. A call rep sees customers who have an order assigned to them, and customers they created (F-355). A delivery agent sees customers of their own orders.
  - [ ] Only active customers show (soft delete uses `isActive`).
- Data: stored stats (F-357).
- API: `GET /api/customers` returns the new fields.
- Permissions: `customers:view`.
- Edge cases and errors: a customer with no orders shows "—" in Last order.
- Tests: integration test for row scope; component test for risk tag.

### F-351: KPI tiles and segment tabs
- Priority: P1. Milestone: M3.
- Description: Four tiles and five tabs sit above the list.
- Current app: none.
- Mockup: tiles Total customers 6,420 (+312 in Oct); First-time 4,980 (78%, 1 order); Repeat 1,440 (22%, 2 or more orders); Blocked for refusing delivery 23 ("Refused 3 times", COD off). Tabs All 6,420; Repeat 1,440; First-time 4,980; Refused before 612; Not reachable 318.
- Definitions:
  - First-time: `totalOrders = 1`. Repeat: `totalOrders >= 2`. (1 + 2 or more = total; customers with 0 orders count in All only.)
  - Refused before: `refusedOrders >= 1`.
  - Not reachable: the newest call on the customer has outcome `not_reachable` or `no_answer`, and no later `confirmed` call.
  - Blocked: `codBlocked = true` (F-357).
  - "+312 in Oct": customers created this month.
- Acceptance criteria:
  - [ ] Tile and tab counts come from one endpoint. They match the list total for the same filter.
  - [ ] The tiles show a period figure (this month) and a total.
  - [ ] A tab click filters the list. The URL keeps `?segment=`.
- Data: none new.
- API: `GET /api/customers/summary`.
- Permissions: `customers:view`; counts respect row scope.
- Edge cases and errors: percentages round to whole numbers and always sum to 100 for First-time plus Repeat among customers with orders.
- Tests: integration test of the definitions on a fixture of 12 customers.

### F-352: Customer search
- Priority: P1. Milestone: M3.
- Description: The mockup search is a button. Make it a live input.
- Current app: live search by name, email, phone.
- Mockup: button "Search name or phone" (dead; matrix section 4 #29).
- Acceptance criteria:
  - [ ] A text input. It searches first name, last name, phone (any format, F-362), alternate phone and email, 300 ms after the last key press.
  - [ ] Clear button. Search combines with tab and filters.
- Data: none. API: `GET /api/customers?search=`.
- Permissions: `customers:view`.
- Edge cases and errors: fewer than 2 characters waits for more input.
- Tests: component test; integration test with phone formats.

### F-353: Sort, pagination and filters
- Priority: P1. Milestone: M3.
- Description: Keep sort and paging. Wire the filter buttons.
- Current app: sort by Orders and Total Spent; page and limit; filter `area`.
- Mockup: filter buttons City, Risk, Flagged by agent (dead). No sort or paging shown.
- Acceptance criteria:
  - [ ] Sort on Customer, Orders, Delivered value, Last order. Server side.
  - [ ] Filters: City (towns in use), Region, Risk (Low, Watch, High), Blocked, Flagged. "Flagged" means the AI problem finder flagged the customer (repeat refuser, duplicate phone, not reachable). It uses the problem-finder service (design 7.3).
  - [ ] Page sizes 25, 50, 100.
  - [ ] Filters stay in the URL.
- Data: indexes `(tenantId, area)`, `(tenantId, refusedOrders)`.
- API: `GET /api/customers` adds `sortBy`, `risk`, `region`, `blocked`, `flagged`.
- Permissions: `customers:view`.
- Edge cases and errors: unknown `sortBy` returns HTTP 400.
- Tests: integration tests per filter.

### F-354: Customer detail page
- Priority: P0. Milestone: M3.
- Description: Reps need the customer's history on a call. The mockup rows are not clickable and there is no detail screen. Keep and extend the current detail page (`/customers/:id`).
- Current app: `CustomerDetails.tsx`: Total orders, Total spent, Average order value; contact; address; orders table; Edit.
- Mockup: not in mockup (rows not clickable). Build in v2 style: a page with a header (name, risk tag, Blocked tag), tiles, tabs Orders, Messages, Calls, Notes.
- Acceptance criteria:
  - [ ] Header: name, phone with Call and WhatsApp buttons, risk tag, "COD off" tag when blocked, Edit and Delete buttons by permission.
  - [ ] Tiles: Orders, Delivered, Refused, Delivered value, Average order value (delivered value divided by delivered orders), Last order.
  - [ ] Contact block: email, phone, alternate phone, opt-out flags (F-360). Address block: street, town, region, landmark. Internal notes.
  - [ ] Tab Orders: order number, date, status, amount, link to the drawer (F-321). Tab Messages: messages with status (F-464). Tab Calls: call history. Tab Notes: team thread for the customer (F-553).
  - [ ] Buttons "New order for this customer" (F-317, prefilled) and "Set reminder".
  - [ ] A rep can open a customer only if the row scope allows it (F-350).
  - [ ] When the customer is COD blocked, a banner shows the reason ("Refused 3 deliveries"), the date, and the override button for the owner (F-357).
- Data: none new.
- API: `GET /api/customers/:id` returns stats, flags and block state.
- Permissions: `customers:view`.
- Edge cases and errors: a deactivated customer shows a banner "This customer was deleted" and opens read-only for the owner. Others get 404.
- Tests: integration test for scope; e2e: open a customer from a call card.

### F-355: Add and edit customer (owner, staff and call reps)
- Priority: P0. Milestone: M3 (owner), M7 (rep, G9; the rep call-card entry points are in F-766, file 08).
- Description: Staff add and edit customers. Call reps can do both (G9). The add form was a dead button in the mockup. Today a rep who adds a customer cannot see them, because reps see only customers linked to their orders.
- Current app: `CustomerForm` (name, email, phone, alternate phone, street, state, notes); `POST /api/customers`, `PUT /api/customers/:id`. Row scope for `sales_rep` in `customerService.getAllCustomers`.
- Mockup: header button "Add customer" (dead). No form.
- Acceptance criteria:
  - [ ] Form fields: first name, last name, phone, alternate phone, email, region, town, street address, landmark, internal notes. Required: first name, phone, region, town, address.
  - [ ] Phone is checked and stored in one format (F-362). A phone that exists shows "This number belongs to Abena Owusu" with a link, and the save is blocked. A deactivated customer with that phone is offered for reactivation (as today in `findAndReactivateCustomerByPhone`).
  - [ ] `Customer.createdById` is set. A rep sees customers where `createdById` is their id, or where they have an order. This fixes the "I added a customer and cannot find them" problem.
  - [ ] A rep can edit a customer they can see. A rep cannot delete (F-356).
  - [ ] Audit: edits write `AuditLog` with before and after.
  - [ ] Opt-out flags are not on this form (F-360).
- Data: `Customer.createdById Int?`.
- API: `POST /api/customers`, `PUT /api/customers/:id`.
- Permissions: `customers:create`, `customers:update` (owner, admin, manager, sales_rep).
- Edge cases and errors: names with one word set `lastName` to empty (as today). A phone with letters is an error.
- Tests: integration tests for rep visibility and duplicate phone; e2e: rep adds a customer and finds them.

### F-356: Delete customer
- Priority: P2. Milestone: M3.
- Description: Soft delete with a confirm. The action is kept. The mockup left it out.
- Current app: `DELETE /api/customers/:id` sets `isActive = false`; the service allows only super_admin, admin, manager (the default permission matrix also lists `delete` for `sales_rep`, which the service refuses).
- Mockup: not in mockup (add to the detail page menu and the row menu).
- Acceptance criteria:
  - [ ] Confirm dialog (F-328): "Delete Abena Owusu? Their 3 orders stay. They disappear from the customer list."
  - [ ] The customer's open orders are not changed. A customer with an order in flight (`out_for_delivery`) cannot be deleted.
  - [ ] Remove `delete` from the default `sales_rep` customer permissions so the matrix matches the service.
  - [ ] Audit row written.
- Data: none. API: `DELETE /api/customers/:id`.
- Permissions: `customers:delete` (owner, admin, manager).
- Edge cases and errors: a later order from the same phone reactivates the customer (as today).
- Tests: integration test of the in-flight block.

### F-357: Refusals, risk level and the COD block (G6)
- Priority: P1. Milestone: M7.
- Description: Refused deliveries cost money and stock time. The rule (G6): at 2 refused deliveries the customer is High risk. At 3, COD is turned off for that customer and their next order goes to a manual call. The owner can override. The app stores stats on the customer and recomputes them from orders, so counts never drift.
- Current app: none. `Customer.totalOrders` and `totalSpent` are counters changed at order create and delete only.
- Mockup: `customers.html` Refused column, Risk column (Low, Watch, High), tag Blocked, tile "Blocked for refusing delivery 23".
- Definitions:
  - A refused delivery is one order that is closed as `failed_delivery` or `returned` with `failureReason = refused`. Count distinct orders. (An order refused on two attempts counts once. G6 says "refused deliveries".)
  - Risk: Low = 0 refusals, Watch = 1, High = 2 or more.
  - Blocked (`codBlocked`) = refusals since the last override is 3 or more, and no active override.
- Acceptance criteria:
  - [ ] Stored columns: `totalOrders` (all orders not deleted), `deliveredOrders`, `refusedOrders`, `deliveredValue`, `lastOrderAt`, `codBlocked`, `codBlockedAt`. A service `customerStatsService.recompute(customerId)` rebuilds them from orders. It runs after every order create, status change and delete. It is idempotent.
  - [ ] When `refusedOrders` reaches 2, a notification goes to the owner and the assigned rep ("Yaw Boateng is now High risk").
  - [ ] When it reaches 3, `codBlocked = true`. The customer's later COD orders are accepted (the customer sees a normal success page, nothing about the block). They are created with `requiresManualCall = true`. Auto-confirm is not sent (F-466). The order shows the flag "COD off: call first" in the list and in the rep queue.
  - [ ] A rep can call and log outcomes on such an order. The outcome Confirmed is blocked with "COD is off for this customer. Ask the owner to allow it." until the owner overrides.
  - [ ] Override: the owner (permission `customers:override_cod`, default `super_admin`) clicks "Allow COD again" on the customer. A note is required. The system stores `codOverrideAt`, `codOverrideById`, `codOverrideNote`. `codBlocked` becomes false. After an override the refusal count restarts at zero (decision P3): refusals counted for the risk and block rules start after `codOverrideAt`.
  - [ ] An override can be removed ("Turn COD off again") by the same permission.
  - [ ] The customers tile "Blocked" counts `codBlocked = true`.
  - [ ] When a refused order is later corrected (the status is changed so it is no longer refused), recompute lowers the count and may lift the block.
  - [ ] Prepayment is not offered in release one. When physical prepaid ships (G1, later), a blocked customer may pay online. Until then the manual call is the only route.
- Data: `Customer.deliveredOrders`, `refusedOrders`, `deliveredValue Decimal(19,4)`, `lastOrderAt`, `codBlocked`, `codBlockedAt`, `codOverrideAt`, `codOverrideById`, `codOverrideNote`; `Order.requiresManualCall` (F-317). `Customer.totalSpent` stays until the KPI service replaces its readers (M1), then it is removed.
- API: `POST /api/customers/:id/cod-override` `{allow: boolean, note}`.
- Permissions: view risk with `customers:view`; override needs `customers:override_cod`.
- Edge cases and errors:
  - A customer who changes phone number starts again with zero refusals. Out of scope.
  - Two customer records for one person (different phone formats) split the count. F-362 reduces this.
  - The block only affects COD orders. Digital orders are not affected.
  - Needs `failureReason` from every failed delivery (F-306). Failed orders with no reason do not count. An outside agent should send a reason when the partner gives one. GUESS: some partner data does not give a refusal reason. Check before M7. If it does not, only app-reported refusals count and the owner must know the count is a minimum.
- Tests: unit tests for risk and block thresholds; integration test for the override and for recompute after a status correction; e2e: a blocked customer's new order has the flag.

### F-358: Customer suggestion cards
- Priority: P2. Milestone: M11.
- Description: Two cards sit on the Customers page. They are read-only suggestions (G10). The "Ask for prepayment" action is removed because the business sells COD only (matrix section 4 E4). The refusal cost number is computed (matrix section 4 #17).
- Current app: none.
- Mockup: card 1 "9 customers refused 2+ deliveries" (Ask for prepayment, Show the 9); card 2 "212 repeat customers have not ordered in 60 days" (Draft the offer, Dismiss).
- Acceptance criteria:
  - [ ] Card 1 text: "9 customers refused 2 or more deliveries. Each refused order cost us about GH₵X in fees and Y units out of stock for Z days." X comes from the delivery fee rules for outcome `failed`. NUMBERS.md fees are GH₵0 to GH₵5, so the card must not say GH₵40. If the computed cost is under GH₵1 the card leaves the cost out.
  - [ ] Card 1 button: "Show the 9" (filters the list to High risk). No "Ask for prepayment" button.
  - [ ] Card 2 button "Draft the offer" opens Messages → Bulk send with the audience filter prefilled to these customers and a blank message. It sends nothing (G10). "Dismiss" hides the card for 24 hours.
  - [ ] Both cards come from the problem-finder service. They show only when the count is above 0.
- Data: none. API: `GET /api/customers/insights`.
- Permissions: owner, admin, manager.
- Edge cases and errors: with fewer than 5 customers matching, show the card anyway but with the exact number.
- Tests: unit test of the fee computation; component test that no prepayment button exists.

### F-359: Remove dead customer code
- Priority: P3. Milestone: M1.
- Description: Customer tags, merge, top customers, distribution and analytics API have no UI and no caller (matrix section 3 #22, CU-10). Delete them. The notification helpers `notifyOrderAssigned`, `notifyOrderStatusChanged`, `notifyDeliveryScheduled` have no caller. F-557 reuses `notifyOrderAssigned`, so it is kept and wired there. The other two are deleted unless F-557 needs them.
- Current app: `customerService.mergeCustomers`, `searchCustomers`, `getTopCustomers`, `getCustomerDistribution`, `getCustomerOrderHistory`, `getCustomerByPhone`, `add|removeCustomerTags`; routes `PATCH /:id/tags`, `GET /:id/analytics`; `Customer.tags` column.
- Mockup: none.
- Acceptance criteria:
  - [ ] The dead methods and the two routes are removed. Tests for them are removed.
  - [ ] The `Customer.tags` column stays (drop it later; no data loss now).
  - [ ] No other code references the removed methods (TypeScript build passes).
  - [ ] `getCustomerByPhone` is kept if F-362 uses it; otherwise removed.
- Data: none. API: remove `PATCH /api/customers/:id/tags`, `GET /api/customers/:id/analytics`.
- Permissions: not applicable.
- Edge cases and errors: MCP `customers_lookup` does not use the removed methods (check before delete).
- Tests: build and lint pass; the existing customer tests still pass.

### F-360: Opt-out flags on the customer
- Priority: P2. Milestone: M9.
- Description: The customer record holds SMS, WhatsApp and email opt-out flags. The Messages Opt-outs view (F-462) is the place to manage them in bulk. The customer page shows them and lets staff change them.
- Current app: `Customer.smsOptOut`, `whatsappOptOut`, `emailOptOut`, `unsubscribeToken`; managed in `Communications` → Opt-outs.
- Mockup: `messages.html#opt` (switches); customers page shows none.
- Acceptance criteria:
  - [ ] The customer contact block shows three switches. A change records the reason "Asked on a call" and the date (F-462 fields).
  - [ ] Permission: owner, admin, manager. Reps can see the flags but not change them.
  - [ ] An opted-out channel is never used by bulk sends, workflows or auto-confirm (F-466).
- Data: see F-462.
- API: `PATCH /api/customers/:id/opt-out`.
- Permissions: change needs `customers:update` plus manager or above.
- Edge cases and errors: opt-out never blocks one-to-one replies the customer starts (the customer wrote first).
- Tests: integration test that a workflow skips an opted-out channel.

### F-361: Customer export
- Priority: P2. Milestone: M3.
- Description: The Export button was dead. Export the filtered list as CSV or XLSX.
- Current app: none.
- Mockup: header button Export (dead).
- Acceptance criteria:
  - [ ] Export follows search, tab and filters. Columns: name, phone, alternate phone, email, region, town, orders, delivered, refused, delivered value, last order, risk, blocked, opt-out flags.
  - [ ] Cap and format rules as F-320.
  - [ ] Permission `customers:export` (owner, admin, manager). Not reps.
- Data: none. API: `GET /api/customers/export`.
- Permissions: `customers:export`.
- Edge cases and errors: phone as text; opted-out customers are included and flagged.
- Tests: integration test of export columns.

### F-362: Phone number format
- Priority: P1. Milestone: M1.
- Description: Customers are unique by phone per tenant, but phones are typed in many formats (`024 555 0103`, `0245550103`, `+233245550103`). Duplicates split orders, refusal counts and messages. This requirement adds no screen. It makes matching reliable. It supports F-310, F-317, F-355, F-357 and F-452.
- Current app: `formatPhoneNumber` in `whatsappService.ts` formats at send time only. `normalizePhone` in `orderService.ts` is local to import. Phone is stored as typed. Unique index `(phoneNumber, tenantId)`.
- Mockup: phones shown as `024 555 0103`.
- Acceptance criteria:
  - [ ] One shared function `normalizePhone(input, defaultCountry)` returns the number in international form without spaces (for Ghana: `+233245550103`). It accepts a leading 0, a missing 0 (9 digits), `233...` and `+233...`. Nigeria (`+234`) is supported for the future.
  - [ ] Every write path (checkout, manual order, import, webhook, customer form) stores the normalized value. The display shows a local format `024 555 0103`.
  - [ ] Search and duplicate checks compare normalized values.
  - [ ] A migration normalizes existing rows. Rows that would collide (two customers with the same normalized phone) are listed in a report. They are not merged automatically.
- Data: normalize `Customer.phoneNumber` and `alternatePhone` in place. No new column.
- API: none.
- Permissions: not applicable.
- Edge cases and errors:
  - GUESS: production has mixed formats. Count them with a query before the migration (`SELECT count(*) ... WHERE phone_number NOT LIKE '+233%'`).
  - Numbers that are not valid for the country stay as typed and get a "check number" flag in the list.
- Tests: unit tests for 12 input formats; migration test with colliding rows.

---

## 4. Cross-area dependencies

I rely on these items in other files. IDs are named by range when I do not know the exact ID.

| Needed | Area / range | Used by |
|---|---|---|
| KPI service (revenue, three rates, medians, operating hours maths) | Dashboard, A, F-200 range | F-304, F-309, F-312 |
| Audit log fields `before`, `after`, `actorKind`, `channel` | AI drawer, MCP, audit, A, F-1300 range | F-302, F-318 |
| Realtime rooms scoped by tenant; notification bell reads rows | Shell, A, F-100 range | F-307, F-557 |
| Stock ledger, locations, reserved quantity, one stock decrement at delivery (F-657), return handling (F-656) | Stock, B2, F-650 range | F-303, F-305 |
| Partner days to pay, fee rules, availability | Deliveries, B2, F-700 range | F-309, F-303, F-314 |
| Rep screen (queue, call card, outcomes F-757, decline reasons F-758, New order F-765, customer edit F-766, order id labels F-771) | Rep screen, B2, F-750 range | F-317, F-324, F-357, F-300 |
| Delivery agent app (failure reasons, complete delivery) | Agent app, B2, F-800 range | F-306, F-357 |
| Reminders, threads, mentions, notification events | Inbox, this team, F-552, F-553, F-556, F-557 | F-325, F-326, F-354 |
| Message status per order and customer | Messages, this team, F-464 | F-321, F-354 |
| Auto-confirm | Messages, this team, F-466 | F-317, F-357 |
| Region list (store country) | Checkout forms, this team, F-413 | F-317, F-319, F-353 |
| Digital settlement and fee hook | Checkout, this team, F-405, F-406 | F-301, F-303 |
| Collections, deposits, settlements, commission ledger, delivery fee posting | Finance, C, F-900 range | F-303, F-309, F-323 |
| Role presets and permission matrix (`orders:force_status`, `orders:export`, `customers:export`, `customers:override_cod`) | Staff and roles, C, F-1150 range | F-302, F-320, F-357, F-361 |
| Settings → Operations (operating hours, days to pay default, waiting limit) | Settings, C, F-1200 range | F-309, F-312 |
| Order statuses tab in Settings shows all 12 states read-only | Settings, C, F-1200 range | F-301 |

## 5. Coverage table

Every row of the matrix that this file covers. Count check at the end.

### 5.1 Section 1.3 Orders (25 rows)

| Row | Feature | Covered by |
|---|---|---|
| OR-01 | Orders list | F-307 |
| OR-02 | Status tabs with counts | F-308 |
| OR-03 | Kanban view and preference | F-327 |
| OR-04 | Search | F-310 |
| OR-05 | Date range filter | F-311 |
| OR-06 | Sort, pagination, page size, column resize | F-310 |
| OR-07 | Filters: product, agent, assigned to, flagged | F-312 |
| OR-08 | Change status (row, bulk) | F-313 |
| OR-09 | Assign rep and agent | F-314 |
| OR-10 | Bulk delete | F-315 |
| OR-11 | Single order delete | F-316 |
| OR-12 | New order | F-317 |
| OR-13 | Edit order | F-318 |
| OR-14 | Alternate phone | F-318 (and F-317 form field) |
| OR-15 | Import CSV/XLSX | F-319 |
| OR-16 | Export | F-320 |
| OR-17 | Order detail | F-321 |
| OR-18 | Timeline | F-322 |
| OR-19 | Payment card | F-323 |
| OR-20 | Call log and call history | F-324 |
| OR-21 | Reminder on order | F-325 |
| OR-22 | Team notes thread | F-326 |
| OR-23 | "Unpaid by agent" tab | F-309 |
| OR-24 | Order states payment_pending, payment_failed, digital_delivered | F-301 |
| OR-25 | Transition rules | F-301, F-302 |

### 5.2 Section 1.4 Customers (12 rows)

| Row | Feature | Covered by |
|---|---|---|
| CU-01 | Customer list | F-350 |
| CU-02 | KPI tiles and segment tabs | F-351 |
| CU-03 | Search | F-352 |
| CU-04 | Sort and pagination | F-353 |
| CU-05 | Customer detail page | F-354 |
| CU-06 | Add and edit customer | F-355 |
| CU-07 | Delete customer | F-356 |
| CU-08 | Risk, refusals, block COD | F-357 |
| CU-09 | Customer agent cards | F-358 |
| CU-10 | Tags, merge, analytics API | DROP: matrix verdict DROP (dead code, no UI). Code removal is done in F-359 |
| CU-11 | Opt-out flags | F-360 (bulk view in F-462) |
| CU-12 | Export | F-361 |

### 5.3 Section 3 broken items covered here (9 rows)

| Row | Item | Covered by |
|---|---|---|
| 3-#7 | Possible double stock decrement | F-305 |
| 3-#11 | Failed delivery GL entry not posted | F-303 |
| 3-#12 | No transition validation on order status | F-301, F-302 |
| 3-#22 | Dead service methods (customer merge, tags, top; notify helpers) | F-359 (other dead methods belong to areas B2 and C) |
| 3-#25 | Kanban `$` hard-coded | F-327 (moot with Kanban removed; Earnings History part belongs to area B2) |
| 3-#27 | Orders assign UI missing | F-314 |
| 3-#36 | 12 models lack `tenantId` | F-363 (my models); rest in area A |
| 3-#46 | `Call` has no `tenantId` | F-363, F-324 |
| 3-#49 | Failed delivery missing from Kanban | F-327 (moot) |

### 5.4 Section 4 mockup fixes covered here (8 rows)

| Row | Issue | Covered by |
|---|---|---|
| 4-#10 | Order statuses differ per screen; "Not reachable" shown as status | F-301, F-308, F-324 |
| 4-#11 | Order id formats | F-300 |
| 4-#12 | Same id maps to different customers | F-300 (one order table; sample data) |
| 4-#17 | Customers card says GH₵40 per refused order | F-358 |
| 4-#25 | Dead buttons (about 40) | F-328 for Orders and Customers; files 04 and 05 wire their own pages (F-409, F-454, F-500, F-550) |
| 4-#29 | Delete confirms inconsistent; Customers search is a button | F-328, F-352 |
| 4-E3 | Rep outcomes map to which order status | F-324 |
| 4-E4 | "Ask for prepayment" with COD only | F-358 (Paystack text: F-402 in the checkout area) |

### 5.5 Count check

| Section | Rows in matrix for this file | Rows in this table |
|---|---|---|
| 1.3 Orders | 25 | 25 |
| 1.4 Customers | 12 | 12 |
| Section 3 broken (assigned to this file) | 9 | 9 |
| Section 4 fixes and extras (assigned to this file) | 8 | 8 |
| Total | 54 | 54 |

Matrix check: section 1.3 has OR-01 to OR-25 (25 rows). Section 1.4 has CU-01 to CU-12 (12 rows). Counts equal.

F-IDs written in this file: F-300 to F-328 (29), F-350 to F-363 (14). Total 43.
