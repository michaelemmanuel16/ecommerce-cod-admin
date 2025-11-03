-- ========================================
-- Database Index Verification Script
-- Phase 1: Performance Indexes
-- ========================================

-- 1. List all indexes on critical tables
-- ========================================

\echo '\n=== ORDERS TABLE INDEXES ==='
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'orders'
ORDER BY indexname;

\echo '\n=== DELIVERIES TABLE INDEXES ==='
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'deliveries'
ORDER BY indexname;

\echo '\n=== TRANSACTIONS TABLE INDEXES ==='
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'transactions'
ORDER BY indexname;

\echo '\n=== USERS TABLE INDEXES ==='
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'users'
ORDER BY indexname;

\echo '\n=== CUSTOMERS TABLE INDEXES ==='
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'customers'
ORDER BY indexname;

\echo '\n=== PRODUCTS TABLE INDEXES ==='
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'products'
ORDER BY indexname;

-- 2. Check index sizes
-- ========================================

\echo '\n=== INDEX SIZES (Top 20) ==='
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as size,
    idx_scan as scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- 3. Test queries with EXPLAIN ANALYZE
-- ========================================

\echo '\n=== TEST 1: Orders by status and date (CRITICAL) ==='
EXPLAIN ANALYZE
SELECT id, order_number, status, created_at, total_amount
FROM orders
WHERE status = 'confirmed'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50;

\echo '\n=== TEST 2: Orders by payment status ==='
EXPLAIN ANALYZE
SELECT id, order_number, payment_status, status, total_amount
FROM orders
WHERE payment_status = 'pending'
  AND status = 'delivered'
ORDER BY created_at DESC
LIMIT 50;

\echo '\n=== TEST 3: Orders by delivery area ==='
EXPLAIN ANALYZE
SELECT id, order_number, delivery_area, status
FROM orders
WHERE delivery_area = 'Downtown'
  AND status IN ('confirmed', 'preparing')
ORDER BY created_at ASC
LIMIT 50;

\echo '\n=== TEST 4: Agent workload ==='
EXPLAIN ANALYZE
SELECT delivery_agent_id, status, COUNT(*) as count
FROM orders
WHERE delivery_agent_id IS NOT NULL
  AND status IN ('out_for_delivery', 'ready_for_pickup')
GROUP BY delivery_agent_id, status
ORDER BY count DESC;

\echo '\n=== TEST 5: Delivery agent schedule ==='
EXPLAIN ANALYZE
SELECT d.id, d.order_id, d.scheduled_time, o.order_number
FROM deliveries d
JOIN orders o ON o.id = d.order_id
WHERE d.agent_id = (SELECT id FROM users WHERE role = 'delivery_agent' LIMIT 1)
  AND d.scheduled_time >= CURRENT_DATE
  AND d.scheduled_time < CURRENT_DATE + INTERVAL '1 day'
ORDER BY d.scheduled_time ASC;

\echo '\n=== TEST 6: Transaction reconciliation ==='
EXPLAIN ANALYZE
SELECT type, status, COUNT(*), SUM(amount) as total
FROM transactions
WHERE type = 'collection'
  AND status = 'collected'
  AND created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY type, status;

\echo '\n=== TEST 7: Active products by category ==='
EXPLAIN ANALYZE
SELECT id, name, category, price, stock_quantity
FROM products
WHERE is_active = true
  AND category = 'Electronics'
ORDER BY name ASC
LIMIT 100;

\echo '\n=== TEST 8: Low stock products ==='
EXPLAIN ANALYZE
SELECT id, name, sku, stock_quantity, low_stock_threshold
FROM products
WHERE stock_quantity <= low_stock_threshold
  AND is_active = true
ORDER BY stock_quantity ASC;

\echo '\n=== TEST 9: Customer lookup by email ==='
EXPLAIN ANALYZE
SELECT id, first_name, last_name, email, phone_number
FROM customers
WHERE email = 'test@example.com';

\echo '\n=== TEST 10: Available delivery agents ==='
EXPLAIN ANALYZE
SELECT id, first_name, last_name, role
FROM users
WHERE role = 'delivery_agent'
  AND is_active = true
  AND is_available = true;

-- 4. Index usage statistics
-- ========================================

\echo '\n=== INDEX USAGE STATISTICS ==='
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan as times_used,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    CASE
        WHEN idx_scan = 0 THEN 'UNUSED'
        WHEN idx_scan < 10 THEN 'RARELY USED'
        WHEN idx_scan < 100 THEN 'OCCASIONALLY USED'
        ELSE 'FREQUENTLY USED'
    END as usage_level
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'deliveries', 'transactions', 'users', 'customers', 'products')
ORDER BY tablename, idx_scan DESC;

-- 5. Missing indexes detection
-- ========================================

\echo '\n=== SEQUENTIAL SCANS (Potential missing indexes) ==='
SELECT
    schemaname,
    tablename,
    seq_scan as sequential_scans,
    seq_tup_read as rows_read,
    idx_scan as index_scans,
    ROUND(100.0 * seq_scan / NULLIF(seq_scan + idx_scan, 0), 2) as seq_scan_pct
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND seq_scan > 0
ORDER BY seq_scan DESC
LIMIT 10;

-- 6. Table bloat check
-- ========================================

\echo '\n=== TABLE SIZES ==='
SELECT
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
LIMIT 10;

-- 7. Summary report
-- ========================================

\echo '\n=== SUMMARY REPORT ==='
SELECT
    'Total Indexes' as metric,
    COUNT(*)::text as value
FROM pg_indexes
WHERE schemaname = 'public'
UNION ALL
SELECT
    'Total Index Size' as metric,
    pg_size_pretty(SUM(pg_relation_size(indexrelid))) as value
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
UNION ALL
SELECT
    'Unused Indexes' as metric,
    COUNT(*)::text as value
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND indexrelname NOT LIKE '%pkey'
  AND indexrelname NOT LIKE '%unique';

\echo '\n=== Index verification complete! ==='
\echo 'Look for "Index Scan" or "Index Only Scan" in EXPLAIN ANALYZE results.'
\echo 'If you see "Seq Scan", the index may not be used (check query conditions).'
