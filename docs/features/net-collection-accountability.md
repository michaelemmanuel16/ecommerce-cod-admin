# Net Collection Accountability (Implemented)

**Status**: ✅ Implemented and Deployed  
**Date**: January 31, 2026  
**Migration**: `20260131164238_add_commissions_payable_account`

## Overview

**Net Collection Accountability** changes how agents are held accountable for COD collections. Agents are now responsible for the **NET amount** (Gross Collection - Agent Commission) rather than the gross amount.

### Key Changes

1. **Accountability Model**: Agents accountable for NET amount (Gross - Agent Commission)
2. **Workflow Simplification**: Single-step reconciliation (draft → reconciled)
3. **New GL Account**: 2020 - Commissions Payable (Liability)
4. **Commission Handling**: Sales Rep commissions become a business liability

## Reconciliation Workflow

**Previous**: `draft → verified → approved → deposited → reconciled`  
**Current**: `draft → reconciled`

- Merged verify/approve into single action
- Permissions: Admin and Manager roles
- One-click reconciliation for efficiency

## GL Account Changes

### New Account: 2020 - Commissions Payable
- **Type**: Liability
- **Purpose**: Track Sales Rep commissions (not deducted by agents)
- **Posted On**: Order delivery (credited), Commission payment (debited)

### Updated Accounts

**1015 - Cash in Transit**
- Now records NET amount (Gross - Agent Commission)
- Agent commissions excluded (retained by delivery agent)

**1010 - Cash in Hand**
- Debited with NET amount on reconciliation
- Reflects actual cash deposited by agents

## API Changes

### Endpoint Updates

**Single Reconciliation Endpoint**:
```
POST /api/agent-reconciliation/collections/:id/verify
```
- Completes full reconciliation (draft → reconciled)
- Updates agent balance settlement
- Creates GL entry (DR Cash in Hand, CR Cash in Transit)

**Deprecated** (maintained for backward compatibility):
```
POST /api/agent-reconciliation/collections/:id/approve
```

## Agent Balance Settlement

On reconciliation:
- `currentBalance -= netAmount` (agent no longer holds this)
- `totalDeposited += netAmount` (cumulative deposits)

## Data Migration

**Script**: `scripts/sync-accountability-net.js`
- Updated historical `AgentCollection` records to NET amounts
- Recalculated `AgentBalance` records
- Synchronized GL accounts (1010, 1015, 2020)

**Verification**: `scripts/check-consistency.ts`

## Deployment

1. ✅ Migration adds GL account 2020 automatically
2. ✅ All 311 backend tests passing
3. ✅ Frontend updated for single-step workflow
4. ✅ Historical data migrated

## Related Documentation

- **Detailed Documentation**: See `/brain/NET_ACCOUNTABILITY_DOCS.md`
- **Implementation Plan**: `/brain/implementation_plan.md`
- **Walkthrough**: `/brain/walkthrough.md`
- **GL Architecture**: `docs/GL_ARCHITECTURE.md`

## Commits

- `b1d5e4c` - Core implementation
- `e64b4c3` - GL account migration
- `67010ea` - Migration table name fix
