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

## Verification Results

### Automated Tests
- Comprehensive unit tests (19 tests) covering FIFO matching, balance validation, and GL integration.
- Final `pre-push-check.sh` validation passed successfully.
