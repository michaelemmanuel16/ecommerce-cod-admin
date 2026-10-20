# M1-T25 / M1-T27: analytics routes, kept and deleted (for the PR body)

Callers were searched in `frontend/src`, `backend/src/mcp` and `e2e` for each path. Every `/api/analytics/*` route has a
caller in `frontend/src/services/analytics.service.ts` (reached through `analyticsStore`), so no route is deleted in M1.
The frontend deletions are M3.

## Kept: `/api/analytics/*` (11 routes, all `analytics:view`)

| Route | Source after M1-T25 |
|---|---|
| `GET /dashboard` | KPI layer: `deliveredRevenue` (revenue, delivered orders) and `rates` (`confirmationRate`, `deliverySuccessRate`, `orderToCashYield`). `deliveryRate` is gone. |
| `GET /sales-trends` | Orders by placement day; revenue and delivered orders from `deliveredRevenueByDay` (new, `kpi/revenue.ts`). `conversionRate` is gone. |
| `GET /conversion-funnel` | Order counts by status (no revenue, no rate). Unchanged. |
| `GET /rep-performance` | `repRates` (`confirmationRate`, `deliveredFromConfirmedRate`) and `deliveredRevenue` per rep. `successRate`, `avgResponseTime`, `unpaidDeliveredRevenue` are gone. |
| `GET /agent-performance` | `partnerRates` (`deliverySuccessRate`). `successRate` is gone. `onTimeRate` stays (not a KPI, no KPI definition yet). |
| `GET /customer-insights` | `activeCustomers` deleted (it was a copy of `totalCustomers`). `avgOrderValue` = KPI revenue / KPI delivered orders. |
| `GET /pending-orders` | Unchanged (list of orders). |
| `GET /recent-activity` | Unchanged (notifications). |
| `GET /status-distribution` | Order counts by status. Unchanged. |
| `GET /product-performance` | `productDeliveredUnits` (units, line revenue). `orderCount` is gone. |
| `GET /area-distribution` | `deliveredRevenueByArea` (new, `kpi/revenue.ts`). `orderCount` is now delivered orders. |

Date inputs on all of them follow the KPI rule: a date-only value is a store-zone day (`to` inclusive); no dates means
month to date.

## Deleted

| What | Why |
|---|---|
| `GET /api/financial/profit-margins` (route, controller `getProfitMargins`, service `calculateProfitMargins`) | M1-T25. The frontend call and store state were never rendered; the Finance cards read `summary.profitMargin`. Returns 404 now. |
| `analyticsService.getTimeSeriesData` | No route, no caller. Revenue on `createdAt`. |
| `getCustomerInsights().activeCustomers` | Copy of `totalCustomers`. |

## Left on purpose

| What | Why |
|---|---|
| `analyticsService.getRealTimeStats` | No route and no caller, but it is not a time series and it computes no revenue. Delete in a dead-code pass if wanted. |
