# Agent Blocking for Discrepancies (MAN-12)

Implemented a robust system to block agents from receiving new deliveries when settlement discrepancies or delays are detected.

## Overview
This feature ensures financial accountability by automatically or manually restricting agents who have overdue collections. Blocked agents are automatically excluded from the candidate pool for new order assignments.

## Changes Made

### 1. Database Schema
Updated the `AgentBalance` model in `schema.prisma` with:
- `isBlocked`: Boolean flag.
- `blockReason`: String describing why they were blocked.
- `blockedAt`: Timestamp of the block.
- `blockedById`: Audit reference to the user who performed/triggered the block.

### 2. Backend Services
- **AgentReconciliationService**: Added `blockAgent`, `unblockAgent`, and `getBlockedAgents` functions.
- **AgingService**: Added `autoBlockOverdueAgents` logic to automatically block agents with collections in the 4-7 day or 8+ day buckets.
- **AssignmentService**: Modified `getUsersByRole` to filter out blocked agents.

### 3. API Endpoints
Added new routes:
- `POST /api/agent-reconciliation/agents/:id/block`: Manually block an agent.
- `POST /api/agent-reconciliation/agents/:id/unblock`: Manually unblock an agent.
- `GET /api/agent-reconciliation/agents/blocked`: List all currently blocked agents.

### 4. Background Jobs & Notifications
- **AgingQueue**: Scheduled a daily 10:00 AM cron job (`auto-block-overdue`) to trigger the auto-blocking logic.
- **NotificationService**: Added `notifyAgentBlocked` and `notifyAgentUnblocked` for in-app/real-time alerts.
- **Real-time**: Implemented Socket.io emissions for immediate UI updates when blocking status changes.

## Verification Results

### Automated Tests
Successfully ran passing unit tests for:
- `agentReconciliationService.test.ts`: Verified manual block/unblock logic.
- `agingService.test.ts`: Verified auto-blocking detection for overdue buckets.
- `assignmentService.test.ts`: Verified that blocked agents are correctly excluded from assignment lists.
