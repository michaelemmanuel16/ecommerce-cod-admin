# Commission Calculation Update

## Change Summary
Updated the commission system from **percentage-based** to **fixed amount per order**.

## Previous Calculation (Percentage)
```
Total Earnings = Σ(Order Amount × Commission Rate / 100)
Monthly Earnings = Σ(This Month's Orders × Commission Rate / 100)
```

## New Calculation (Fixed Amount)
```
Total Earnings = Number of Delivered Orders × Commission Amount
Monthly Earnings = Number of Orders Delivered This Month × Commission Amount
```

## Example
- Commission Amount: GH₵50.00
- Delivered Orders: 10 orders
- **Total Earnings: GH₵500.00** (10 × 50)

If 3 of those orders were delivered this month:
- **Monthly Earnings: GH₵150.00** (3 × 50)

## Files Modified

### Backend
1. **`backend/src/services/repPerformanceService.ts`**
   - Changed earnings calculation from percentage to fixed amount
   - Line 90-92: `totalEarnings = deliveredCount × commissionAmount`
   - Line 102: `monthlyEarnings = monthlyDeliveredCount × commissionAmount`

2. **`backend/src/controllers/userController.ts`**
   - Updated validation to remove 100% max limit
   - Line 317-323: Validates commission as positive number (no upper limit)

### Frontend
3. **`frontend/src/components/reps/EditRepModal.tsx`**
   - Changed label from "Commission Rate (%)" to "Commission Amount"
   - Removed max value validation (was 100)
   - Updated help text: "Representative will earn this amount for each successful delivery"
   - Placeholder changed from "5.00" to "50.00"

## Database Schema
- Field name: `commissionRate` (kept for backward compatibility)
- Database column: `commission_rate`
- Type: `Float?` (nullable, defaults to 0)
- **Interpretation**: Now represents fixed amount per order, not percentage

## API Behavior
- `PUT /api/users/reps/:id` - Accepts any positive number for commission
- `GET /api/users/reps/performance` - Returns earnings calculated as fixed amount per order

## UI Changes
The Edit Representative modal now shows:
- **Label**: "Commission Amount" (instead of "Commission Rate (%)")
- **Input**: Number field with no maximum limit
- **Helper text**: "Representative will earn this amount for each successful delivery"
- **Placeholder**: "50.00" (instead of "5.00")

## Testing
1. Set a rep's commission to 50.00
2. If they have 10 delivered orders:
   - Total Earnings should show: GH₵500.00
3. If 3 orders were delivered this month:
   - Monthly Earnings should show: GH₵150.00

## No Database Migration Needed
The existing `commission_rate` column works for both interpretations (percentage or fixed amount). No database changes required.
