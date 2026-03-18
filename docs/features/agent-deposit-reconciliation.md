# Agent Deposit Reconciliation (MAN-13)

Implementation of a formal process for tracking and reconciling agent deposits against their collected cash, including FIFO matching to collections and GL automation.

## Overview
Agents can now submit records of their deposits (bank transfers, cash, etc.). Accountants verify these deposits, and the system automatically matches the verified amount against the oldest outstanding collections for that agent.

## Changes Made

### 1. Database Schema
Modified the `AgentDeposit` model:
- Added `depositMethod` field.
- Added unique constraint to `referenceNumber` to prevent duplicates.
- Added database indexes on `depositDate` and `[agentId, depositDate]` for performance.

### 2. GL Automation
- Implemented `createAgentDepositEntry` in `GLAutomationService` to automate journal entries:
    - **Debit**: `Cash in Hand` (`1010`)
    - **Credit**: `Accounts Receivable - Agents` (`1020`)

### 3. Service Logic
- **FIFO Matching**: Optimized logic to automatically match the deposit amount against the oldest `approved` collections.
- **Scalability**: Uses bulk updates (`updateMany`) to eliminate performance bottlenecks.
- **Balance Validation**: Prevents deposits exceeding the agent's outstanding balance.

### 4. API Endpoints
- `GET /api/reconciliation/deposits`: List and filter deposits.
- `POST /api/reconciliation/deposits`: Submit a new deposit (with `express-validator` safety).
- `POST /api/reconciliation/deposits/:id/verify`: Verify and match a deposit.

### 5. Real-time Notifications
- Socket events (`agent:deposit-submitted`, `agent:deposit-verified`) for live dashboard updates.

---

## MAN-28 — Mobile Deposit Submission & Per-Agent Deposit History
**Date:** 2026-03-17 | **Type:** feat | **Branch:** feature/mobile-inventory-history | **Commit:** b8c3594

### Summary
Agents can now submit deposits with receipt photos from the mobile collections view. Admins see an agent's deposits alongside their collections in a unified tabbed modal, with inline verify/reject actions. Also fixed a critical self-deadlock in bulk deposit verification.

### Changes
- **Backend:** Added `receiptUrl` to AgentDeposit schema. Fixed bulk verify self-deadlock by replacing `$queryRaw FOR UPDATE` with Prisma ORM calls. Added deposit creation endpoint with receipt URL support.
- **Frontend:** Added Deposits tab to CollectionActionModal with per-agent deposit table (Reference, Amount, Method, Date, Receipt link, Status, Verify/Reject actions). Removed global DepositActionModal from AgentCollections page. Added mobile deposit submission form with receipt photo upload to MobileCollections. Added collection modal pagination (50/page). Improved deposit reference format to date-based (DEP-YYYYMMDD-XXXX). Added double-click guard on verify buttons with loading states. Extended API timeouts for verification endpoints.
- **Database:** Migration `20260317130000_add_receipt_url_to_agent_deposits` adding optional `receiptUrl` column.

### Key Files
- `frontend/src/components/financial/modals/CollectionActionModal.tsx` — Tabbed modal with Collections + Deposits
- `frontend/src/pages/mobile/MobileCollections.tsx` — Mobile deposit form with receipt photo
- `frontend/src/pages/financial/AgentCollections.tsx` — Removed global deposit modal, renamed button
- `backend/src/services/agentReconciliationService.ts` — Bulk verify deadlock fix
- `backend/prisma/schema.prisma` — receiptUrl field on AgentDeposit

---

## Verification Results

### Automated Tests
- Comprehensive unit tests (19 tests) covering FIFO matching, balance validation, and GL integration.
- Final `pre-push-check.sh` validation passed successfully.
