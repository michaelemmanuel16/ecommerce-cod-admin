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
