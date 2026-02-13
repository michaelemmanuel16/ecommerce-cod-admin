# Agent Inventory Tracking

Phase 1 implementation of inventory tracking for delivery agents, treating them as "mobile warehouses." When products leave the main warehouse to agents, the system now tracks exactly what each agent holds, provides a full audit trail of every stock movement, and prevents double-deduction when agents fulfill orders from their allocated stock.

## Problem Solved

Previously, stock was deducted from the warehouse at `out_for_delivery` with no visibility into what physical inventory agents held. This caused:
- No accountability for items going missing (shrinkage)
- No way to reconcile agent-held inventory at end of period
- No record of which agent delivered which products

## Overview

Agents (riders and shop owners) can now receive bulk stock allocations from the warehouse. The system tracks every movement — allocations out, order fulfillments, agent-to-agent transfers, returns, and reconciliation adjustments — with a complete audit trail. Admin staff can view agent stock distribution directly from the Products page via expandable rows.

---

## Changes Made

### 1. Database Schema

**New enum: `TransferType`**
```
allocation          — Warehouse → Agent (bulk stock send)
order_fulfillment   — Agent stock consumed for a delivered order
agent_transfer      — Agent → Agent
return_to_warehouse — Agent → Warehouse
adjustment          — Shrinkage / reconciliation correction
```

**New model: `InventoryTransfer`**
- Immutable audit record for every stock movement
- Links to product, from/to agents, order (for fulfillments), and the user who created it
- Indexes on productId, fromAgentId, toAgentId, transferType, createdAt, orderId

**New model: `AgentStock`**
- Running totals per agent+product pair (unique constraint)
- Tracks: `quantity` (current on-hand), `totalAllocated`, `totalFulfilled`, `totalReturned`, `totalTransferIn`, `totalTransferOut`

**Relation updates:** User, Product, and Order models updated with back-relations.

**Migration:** `20260212133256_add_agent_inventory_tracking`

---

### 2. Backend Service (`agentInventoryService.ts`)

| Method | Description |
|--------|-------------|
| `allocateStock` | Deducts from warehouse, increments AgentStock, creates transfer record |
| `transferStock` | Moves stock between two agents atomically |
| `returnStock` | Returns stock from agent to warehouse |
| `recordOrderFulfillment` | Called inside order transactions — fulfills order items from agent stock instead of warehouse |
| `adjustStock` | Reconciliation: sets agent quantity to specific value, records adjustment |
| `getProductAgentStock` | Returns all agents holding a given product with totals |
| `getAgentInventory` | Returns all products held by a given agent |
| `getTransferHistory` | Paginated, filterable transfer log |
| `getSummary` | Overview of all agent-held inventory across the system |

All mutations run inside Prisma transactions to guarantee consistency.

---

### 3. Order Service Integration (`orderService.ts`)

When an order transitions to `out_for_delivery` or `delivered`, the stock deduction logic now checks the assigned delivery agent first:

1. For each order item, check if the agent has sufficient `AgentStock`
2. **If yes** → call `recordOrderFulfillment` (decrements agent stock, creates `order_fulfillment` transfer) — warehouse stock is NOT touched
3. **If no** → fall back to existing warehouse deduction (unchanged behavior)

This prevents double-deduction for pre-allocated stock while preserving full backwards compatibility for orders without agent stock.

---

### 4. API Endpoints

Base path: `/api/agent-inventory`

All endpoints require authentication. Mutations require `super_admin`, `admin`, `manager`, or `inventory_manager` role.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/allocate` | Allocate warehouse stock to an agent |
| `POST` | `/transfer` | Transfer stock between two agents |
| `POST` | `/return` | Return stock from agent to warehouse |
| `POST` | `/adjust` | Reconciliation adjustment (requires notes) |
| `GET` | `/product/:productId` | All agents holding a product + totals |
| `GET` | `/agent/:agentId` | All products held by an agent + totals |
| `GET` | `/transfers` | Paginated transfer history (filters: productId, agentId, type, date range) |
| `GET` | `/summary` | System-wide overview: total agents, quantities, values |

---

### 5. Frontend

**`Products.tsx`** — Products page updated with:
- Chevron toggle on each row (click to expand/collapse)
- **"With Agents"** column showing total quantity currently held by agents (purple badge)
- **"Warehouse"** column (renamed from "Stock") showing only warehouse quantity

**`AgentStockPanel`** — Expanded row panel showing:
- Table of all agents holding the product: Agent | Allocated | Fulfilled | Returned | On Hand | Value | Actions
- Per-agent action buttons: Transfer (→ another agent) and Return (→ warehouse)
- "Allocate" button to send new stock to an agent
- "History" button to view all transfers for that product
- Totals row when multiple agents hold stock

**`AllocateStockModal`** — Agent selector (active delivery agents only), quantity input with warehouse stock reference and max validation, optional notes

**`TransferStockModal`** — Pre-filled source agent, destination agent selector (excludes source), quantity with on-hand validation

**`ReturnStockModal`** — Quantity input with on-hand validation, optional return reason

**`TransferHistoryModal`** — Paginated table of all transfers: Date | Type | From | To | Qty | Order# | By | Notes; filterable by transfer type

---

### 6. State Management

**`agentInventoryStore.ts`** — Zustand store:
- Caches `ProductAgentStockResponse` by productId
- Refreshes cache automatically after every mutation
- All errors shown as toast notifications

**`agent-inventory.service.ts`** — Typed API client matching all 8 endpoints

---

## Verification

### Pre-push validation
All 7 checks passed: Backend ESLint, Frontend ESLint, Backend Tests, Frontend Tests, Backend Build, Frontend Build, GitHub Workflows Validation.

### E2E Tests (`e2e/08-agent-inventory.spec.ts`)
15 Playwright tests covering:

**UI flows:**
- Products page shows expandable chevrons and "With Agents" column
- Expanding a row renders the AgentStockPanel correctly
- Row collapses on second click
- AllocateStockModal opens with agent dropdown and warehouse stock reference
- Quantity validation prevents exceeding warehouse stock
- TransferHistoryModal opens with filter controls
- ReturnStockModal and TransferStockModal open with correct pre-filled data
- "With Agents" purple badge appears when stock is allocated

**API tests (direct requests with auth token):**
- `GET /product/:id` — correct response shape
- `GET /summary` — correct response shape
- `GET /transfers` — correct pagination shape
- `POST /allocate` with quantity 0 → 400 validation error
- Any endpoint without auth token → 401

Run with:
```bash
npm run test:e2e:agent-inventory
```

---

## Scope (Phase 1)

This implementation covers admin visibility and operations only. The following are **out of scope** for Phase 1:
- Agent-facing mobile app or self-service stock view
- Automated end-of-period reconciliation workflows
- Low-stock alerts for agent holdings
- SMS/email notifications for stock movements
