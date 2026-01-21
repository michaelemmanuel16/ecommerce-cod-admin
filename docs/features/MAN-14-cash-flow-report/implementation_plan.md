# Implementation Plan - MAN-14 Cash Flow Report

Implement a real-time Cash Flow Report with KPI cards, a 30-day forecast, and an agent breakdown to provide visibility into the business's cash position.

## Proposed Changes

### Backend

#### [MODIFY] [financialService.ts](file:///Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/services/financialService.ts)
- Implement `getCashFlowReport(filters: DateFilters)`:
    - **KPIs**:
        - `Cash in Hand`: Balance of GL account `1010`.
        - `Cash in Transit`: Balance of GL account `1015`.
        - `AR-Agents`: Balance of GL account `1020`.
        - `Cash Expected`: Sum of `totalAmount` for orders with status `out_for_delivery`.
        - `Total Cash Position`: Sum of the above.
    - **30-day Forecast**:
        - Use historical data (average collections/deposits per day over the last 30 days) to project future cash flows.
        - Generate daily data points for the next 30 days.
    - **Agent Breakdown**:
        - Aggregate pending collections (`reconciliationStatus: pending`) by agent.
        - Sort by descending amount.
- Implement `exportCashFlowCSV()` and `exportCashFlowPDF()`.
- Implement `emailCashFlowReport()`.

#### [MODIFY] [financialController.ts](file:///Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/controllers/financialController.ts)
- Add `getCashFlowReport` controller action.
- Add export and email actions.

#### [MODIFY] [financialRoutes.ts](file:///Users/mac/Downloads/claude/ecommerce-cod-admin/backend/src/routes/financialRoutes.ts)
- Register `GET /cash-flow`.
- Register export and email routes.

### Frontend

#### [MODIFY] [CashFlowTab.tsx](file:///Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/components/financial/CashFlowTab.tsx)
- Refactor to include:
    - **KPI Section**: 5 cards for the different cash positions.
    - **Forecast Section**: Line chart showing projected bank balance and collections.
    - **Agent Breakdown Section**: Table showing each agent's pending collections.
    - **Export Actions**: Buttons for PDF, CSV, and Email.

#### [MODIFY] [financialStore.ts](file:///Users/mac/Downloads/claude/ecommerce-cod-admin/frontend/src/stores/financialStore.ts)
- Add `cashFlowReport` state.
- Add `fetchCashFlowReport` action.

## Verification Plan

### Automated Tests
- **Unit Tests**:
    - Create `backend/src/__tests__/unit/cashFlow.test.ts` to test forecast logic and KPI calculations.
    - Run: `npm test backend/src/__tests__/unit/cashFlow.test.ts`
- **Integration Tests**:
    - Add tests to `backend/src/__tests__/integration/financial.test.ts` (create if missing) to verify API responses.
    - Run: `npm test backend/src/__tests__/integration/financial.test.ts`

### Manual Verification
1.  Navigate to **Financial Management** -> **Cash Flow** tab.
2.  Verify KPI values match expected GL balances (can be checked via `prisma studio`).
3.  Check the 30-day forecast chart for smooth projections.
4.  Test "Export PDF" and "Export CSV" buttons.
5.  Trigger "Email Report" and verify backend logs for email sending.
