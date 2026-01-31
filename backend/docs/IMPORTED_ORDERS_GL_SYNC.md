# Imported Orders GL Sync - Financial Leak Fix

**Date**: January 25, 2026
**Issue**: MAN-17 Financial Statements - CSV Imported Orders Not Tracked
**Status**: ✅ RESOLVED

---

## Problem Summary

94 orders imported via CSV (later increased to 275 orders) were completely invisible to the financial management module, creating a major financial leak and inaccurate reporting.

### Root Cause

GL journal entries are ONLY created when `completeDelivery()` is called. Bulk CSV import creates orders but never triggers GL automation, so revenue/COGS/commissions were never recorded in the General Ledger.

### Financial Impact

- **42 delivered orders** with GH₵12,125 in revenue were not recognized in GL
- **Missing COGS**: GH₵1,250
- **Missing Commission Tracking**: GH₵2,730
- **Balance Sheet**: Didn't balance due to missing entries
- **Audit Trail**: No journal entries = no accountability

---

## Solution Implemented

### Phase 1: Investigation (diagnose-imported-orders.ts)

Created diagnostic script to assess the damage:

```bash
npm run diagnose:imported
```

**Findings:**
- 275 total imported orders
- 42 delivered orders without GL entries
- 100% have Product COGS
- 100% have Delivery Agent assigned
- 100% have Customer Rep assigned
- Total revenue missing: GH₵12,125

### Phase 2: Fix Script (sync-imported-orders-gl.ts)

Created retroactive GL sync script with:
- Dry-run mode for preview
- Transaction-based execution for atomicity
- Comprehensive error handling
- Detailed logging and reporting

```bash
# Preview changes
npm run sync:imported-gl -- --dry-run

# Execute sync
npm run sync:imported-gl -- --execute
```

### Phase 3: Execution Results

**Date Executed**: January 25, 2026
**Orders Synced**: 42
**Success Rate**: 100%

**GL Entries Created:**
- Revenue (4010): GH₵12,125.00
- COGS (5010): GH₵1,250.00
- Delivery Agent Commission (5040): ~GH₵1,365.00
- Sales Rep Commission (5050): ~GH₵1,365.00
- Cash in Transit (1015): GH₵9,395.00
- Inventory (1200): -GH₵1,250.00 (reduction)

**Agent Collections:**
- 42 draft collections created for COD tracking

**Financial Metrics:**
- Gross Profit: GH₵10,875 (89.7% margin)
- Net Profit: GH₵8,145 (67.2% margin after commissions)

---

## Verification

### Before Sync

```
Delivered Orders Without GL: 42
Missing Revenue: GH₵12,125.00
Current Revenue in GL: GH₵0.00
GL Balance: GH₵5,000 debits = GH₵5,000 credits
```

### After Sync

```
Delivered Orders Without GL: 0 ✅
Missing Revenue: GH₵0.00 ✅
Current Revenue in GL: GH₵12,125.00 ✅
GL Balance: GH₵18,375 debits = GH₵18,375 credits ✅
```

---

## Files Created/Modified

### New Files

1. **backend/scripts/diagnose-imported-orders.ts**
   - Investigates imported orders
   - Reports GL coverage gaps
   - Analyzes data completeness

2. **backend/scripts/sync-imported-orders-gl.ts**
   - Retroactive GL entry creation
   - Dry-run and execute modes
   - Comprehensive error handling

3. **backend/docs/IMPORTED_ORDERS_GL_SYNC.md** (this file)
   - Documentation of the fix
   - Before/after metrics
   - Verification steps

### Modified Files

1. **backend/package.json**
   - Added `diagnose:imported` script
   - Added `sync:imported-gl` script

2. **backend/scripts/seed-gl-accounts.ts** (executed)
   - Seeded missing GL accounts:
     - 1010 - Cash in Hand
     - 5020 - Failed Delivery Expense
     - 5030 - Return Processing Expense
     - 5040 - Delivery Agent Commission
     - 5050 - Sales Rep Commission
     - 2010 - Refund Liability

---

## Future Prevention

### Recommendation: Fix Bulk Import

Modify `backend/src/services/orderService.ts` - `bulkImportOrders()` method to create GL entries for orders imported with terminal statuses:

```typescript
// After creating order
if (orderData.status === 'delivered') {
  // Calculate COGS
  const totalCOGS = GLAutomationService.calculateTotalCOGS(createdOrder.orderItems);

  // Create GL journal entry
  const glEntry = await GLAutomationService.createRevenueRecognitionEntry(
    tx,
    createdOrder as OrderWithItems,
    totalCOGS,
    SYSTEM_USER_ID
  );

  // Link GL entry to order
  await tx.order.update({
    where: { id: createdOrder.id },
    data: {
      glJournalEntryId: glEntry.id,
      revenueRecognized: true
    }
  });
}
```

**Impact**: Future CSV imports with delivered status will automatically create GL entries.

---

## Monitoring

### How to Check for Future Leaks

Run the diagnostic periodically:

```bash
npm run diagnose:imported
```

**What to look for:**
- "Delivered Orders Without GL" should be 0
- "Missing Revenue" should be GH₵0.00
- GL should be balanced

### Alert Triggers

Consider adding monitoring for:
- Orders > 24 hours old with status 'delivered' but no GL entry
- Revenue Recognition Rate (should be 100% for delivered orders)
- GL Balance verification (debits = credits)

---

## Lessons Learned

1. **GL Automation is Critical**: Manual processes (CSV import) must trigger GL automation
2. **Monitoring is Essential**: Regular checks for GL coverage gaps
3. **Data Integrity**: All order items must exist for COGS calculation
4. **Audit Trail**: Every delivered order MUST have a journal entry

---

## Related Issues

- MAN-17: Financial Statements Implementation
- Financial Module: General Ledger Integration
- CSV Import: Order Item Creation

---

## Appendix: SQL Verification Queries

### Check for Orders Without GL Entries

```sql
SELECT COUNT(*)
FROM orders
WHERE status = 'delivered'
  AND glJournalEntryId IS NULL;
-- Expected: 0
```

### Verify GL Balance

```sql
SELECT
  SUM(debit_amount)::float as total_debits,
  SUM(credit_amount)::float as total_credits
FROM account_transactions;
-- Expected: total_debits = total_credits
```

### Check Revenue Account

```sql
SELECT
  SUM(at.credit_amount - at.debit_amount)::float as total_revenue,
  COUNT(*)::int as transaction_count
FROM account_transactions at
JOIN accounts a ON a.id = at.account_id
WHERE a.code = '4010';
```

### Verify All Delivered Orders Have GL Entries

```sql
SELECT
  o.id,
  o.totalAmount,
  o.glJournalEntryId,
  je.entryNumber
FROM orders o
LEFT JOIN journal_entries je ON je.id = o.glJournalEntryId
WHERE o.status = 'delivered'
  AND o.source = 'bulk_import';
-- All should have glJournalEntryId and entryNumber
```
