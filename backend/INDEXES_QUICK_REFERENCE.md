# Database Indexes Quick Reference

## Index Coverage by Table

### Orders Table (6 composite + 7 single-column = 13 total)
```
Single-Column Indexes:
  [orderNumber]         - Unique constraint (automatic)
  [customerId]          - Foreign key lookups
  [status]              - Status filtering
  [customerRepId]       - Rep assignment
  [deliveryAgentId]     - Agent assignment
  [createdAt]           - Date sorting
  [deliveryArea]        - Area filtering

Composite Indexes (NEW):
  [status, createdAt]              - Dashboard filtering + sorting
  [paymentStatus, status]          - Payment reconciliation
  [deliveryArea, status]           - Route planning
  [deliveryAgentId, status]        - Agent workload
  [customerRepId, status]          - Rep performance
  [source]                         - Source tracking
```

### Deliveries Table (5 composite + 2 single-column = 7 total)
```
Single-Column Indexes:
  [orderId]             - Unique constraint (automatic)
  [agentId]             - Agent lookups
  [scheduledTime]       - Schedule queries

Composite Indexes (NEW):
  [agentId, scheduledTime]           - Agent route planning
  [orderId, actualDeliveryTime]      - Delivery tracking
  [scheduledTime, actualDeliveryTime] - SLA monitoring
```

### Transactions Table (6 composite + 3 single-column = 9 total)
```
Single-Column Indexes:
  [orderId]             - Unique constraint (automatic)
  [type]                - Transaction type filter
  [status]              - Status filter
  [createdAt]           - Date sorting

Composite Indexes (NEW):
  [type, status]                     - Transaction reports
  [type, createdAt]                  - Time-based analysis
  [status, createdAt]                - Aging reports
```

### Users Table (2 composite = 2 total)
```
Single-Column Indexes:
  [email]               - Unique constraint (automatic)

Composite Indexes (NEW):
  [role, isActive]                   - Active users by role
  [role, isActive, isAvailable]      - Available agents/reps
```

### Customers Table (4 single-column = 4 total)
```
Single-Column Indexes:
  [phoneNumber]         - Unique constraint (automatic)
  [isActive]            (NEW) - Active customers
  [email]               (NEW) - Email lookup
  [totalSpent]          (NEW) - VIP customers

Composite Indexes (NEW):
  [city, area]                       - Geographic filtering
```

### Products Table (3 composite + 1 single-column = 4 total)
```
Single-Column Indexes:
  [sku]                 - Unique constraint (automatic)
  [isActive]            (NEW) - Active products
  [stockQuantity]       (NEW) - Low stock alerts

Composite Indexes (NEW):
  [category, isActive]               - Category browsing
```

## Common Query Patterns

### Dashboard Queries
```sql
-- Uses: orders_status_created_at_idx
SELECT * FROM orders
WHERE status = 'confirmed'
ORDER BY created_at DESC
LIMIT 50;

-- Uses: orders_paymentStatus_status_idx
SELECT * FROM orders
WHERE payment_status = 'pending' AND status = 'delivered';

-- Uses: orders_deliveryAgentId_status_idx
SELECT delivery_agent_id, status, COUNT(*)
FROM orders
WHERE status IN ('out_for_delivery', 'ready_for_pickup')
GROUP BY delivery_agent_id, status;
```

### Delivery Planning
```sql
-- Uses: deliveries_agentId_scheduledTime_idx
SELECT * FROM deliveries
WHERE agent_id = 'xxx' AND scheduled_time >= CURRENT_DATE
ORDER BY scheduled_time;

-- Uses: orders_deliveryArea_status_idx
SELECT * FROM orders
WHERE delivery_area = 'Downtown' AND status = 'confirmed';
```

### Financial Reports
```sql
-- Uses: transactions_type_status_idx
SELECT type, status, SUM(amount)
FROM transactions
WHERE type = 'collection' AND status = 'collected'
GROUP BY type, status;

-- Uses: transactions_status_created_at_idx
SELECT * FROM transactions
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '30 days';
```

### Product Catalog
```sql
-- Uses: products_category_is_active_idx
SELECT * FROM products
WHERE category = 'Electronics' AND is_active = true;

-- Uses: products_stock_quantity_idx
SELECT * FROM products
WHERE stock_quantity <= low_stock_threshold AND is_active = true;
```

### User Management
```sql
-- Uses: users_role_is_active_is_available_idx
SELECT * FROM users
WHERE role = 'delivery_agent'
  AND is_active = true
  AND is_available = true;
```

## Index Selection Rules (PostgreSQL)

1. **Leftmost Prefix**: Composite index [a, b, c] can be used for queries filtering:
   - [a]
   - [a, b]
   - [a, b, c]
   - But NOT [b], [c], or [b, c]

2. **Index Scan vs Seq Scan**: PostgreSQL chooses index when:
   - Table has many rows (> 1000)
   - Query filters < 5-10% of rows
   - Index selectivity is high

3. **Covering Index**: Index-only scan when query columns are all in the index

4. **Multi-Index Combination**: PostgreSQL can combine multiple indexes with bitmap scans

## Performance Tips

### DO
- ✅ Use composite indexes for common multi-column filters
- ✅ Put most selective column first in composite index
- ✅ Include ORDER BY column in composite index
- ✅ Keep indexes on foreign keys
- ✅ Monitor index usage with pg_stat_user_indexes

### DON'T
- ❌ Create indexes on columns with low cardinality (< 100 distinct values)
- ❌ Index columns that are rarely used in WHERE/JOIN
- ❌ Create too many indexes (write performance degrades)
- ❌ Forget to run ANALYZE after bulk data changes
- ❌ Ignore unused indexes (check and drop them)

## Verification Commands

```bash
# List all indexes
\di

# Show indexes for specific table
\d orders

# Check index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

# Find unused indexes
SELECT schemaname, tablename, indexname
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%pkey';

# Check index sizes
SELECT
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid))
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC;
```

## Maintenance Schedule

### Daily
- Monitor slow query log
- Check index hit rate

### Weekly
- Run ANALYZE on large tables
- Review pg_stat_statements for slow queries

### Monthly
- Check for unused indexes
- Review index usage statistics
- Run REINDEX if needed

### Quarterly
- Full database performance review
- Update this documentation
- Plan next optimization phase
