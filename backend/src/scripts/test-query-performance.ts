/**
 * Query Performance Testing Script
 * Tests the impact of Phase 1 index optimizations
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'stdout', level: 'error' },
    { emit: 'stdout', level: 'warn' },
  ],
});

interface QueryTest {
  name: string;
  description: string;
  query: () => Promise<any>;
  expectedIndexes: string[];
}

// Track query execution times
const queryTimes: Array<{ name: string; duration: number }> = [];

// @ts-ignore
prisma.$on('query', (e) => {
  console.log(`Query: ${e.query}`);
  console.log(`Duration: ${e.duration}ms`);
  console.log('---');
});

const tests: QueryTest[] = [
  {
    name: 'Orders by Status and Date',
    description: 'Dashboard query - most critical',
    expectedIndexes: ['orders_status_created_at_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.order.findMany({
        where: {
          status: 'confirmed',
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Orders by Status and Date', duration });
      return result;
    },
  },
  {
    name: 'Payment Reconciliation',
    description: 'Financial dashboard query',
    expectedIndexes: ['orders_paymentStatus_status_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.order.findMany({
        where: {
          paymentStatus: 'pending',
          status: 'delivered',
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Payment Reconciliation', duration });
      return result;
    },
  },
  {
    name: 'Orders by Delivery Area',
    description: 'Route planning query',
    expectedIndexes: ['orders_deliveryArea_status_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.order.findMany({
        where: {
          deliveryArea: 'Downtown',
          status: { in: ['confirmed', 'preparing'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Orders by Delivery Area', duration });
      return result;
    },
  },
  {
    name: 'Agent Workload',
    description: 'Agent dashboard query',
    expectedIndexes: ['orders_deliveryAgentId_status_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.order.groupBy({
        by: ['deliveryAgentId', 'status'],
        where: {
          deliveryAgentId: { not: null },
          status: { in: ['out_for_delivery', 'ready_for_pickup'] },
        },
        _count: true,
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Agent Workload', duration });
      return result;
    },
  },
  {
    name: 'Delivery Schedule',
    description: 'Agent schedule query',
    expectedIndexes: ['deliveries_agentId_scheduledTime_idx'],
    query: async () => {
      const startTime = Date.now();
      // Get first delivery agent
      const agent = await prisma.user.findFirst({
        where: { role: 'delivery_agent' },
      });

      if (!agent) {
        console.log('No delivery agent found, skipping test');
        return [];
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = await prisma.delivery.findMany({
        where: {
          agentId: agent.id,
          scheduledTime: {
            gte: today,
            lt: tomorrow,
          },
        },
        include: {
          order: {
            select: { orderNumber: true },
          },
        },
        orderBy: { scheduledTime: 'asc' },
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Delivery Schedule', duration });
      return result;
    },
  },
  {
    name: 'Transaction Reconciliation',
    description: 'Financial report query',
    expectedIndexes: ['transactions_type_status_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.transaction.groupBy({
        by: ['type', 'status'],
        where: {
          type: 'collection',
          status: 'collected',
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
        _sum: { amount: true },
        _count: true,
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Transaction Reconciliation', duration });
      return result;
    },
  },
  {
    name: 'Active Products by Category',
    description: 'Product catalog query',
    expectedIndexes: ['products_category_is_active_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.product.findMany({
        where: {
          isActive: true,
          category: 'Electronics',
        },
        orderBy: { name: 'asc' },
        take: 100,
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Active Products by Category', duration });
      return result;
    },
  },
  {
    name: 'Low Stock Products',
    description: 'Inventory alert query',
    expectedIndexes: ['products_stock_quantity_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.$queryRaw`
        SELECT id, name, sku, stock_quantity, low_stock_threshold
        FROM products
        WHERE stock_quantity <= low_stock_threshold
          AND is_active = true
        ORDER BY stock_quantity ASC
        LIMIT 50
      `;
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Low Stock Products', duration });
      return result;
    },
  },
  {
    name: 'Customer Email Lookup',
    description: 'Customer search query',
    expectedIndexes: ['customers_email_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.customer.findFirst({
        where: { email: 'test@example.com' },
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Customer Email Lookup', duration });
      return result;
    },
  },
  {
    name: 'Available Delivery Agents',
    description: 'Agent assignment query',
    expectedIndexes: ['users_role_is_active_is_available_idx'],
    query: async () => {
      const startTime = Date.now();
      const result = await prisma.user.findMany({
        where: {
          role: 'delivery_agent',
          isActive: true,
          isAvailable: true,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      });
      const duration = Date.now() - startTime;
      queryTimes.push({ name: 'Available Delivery Agents', duration });
      return result;
    },
  },
];

async function runTests() {
  console.log('========================================');
  console.log('Query Performance Testing - Phase 1');
  console.log('========================================\n');

  for (const test of tests) {
    console.log(`\n--- Test: ${test.name} ---`);
    console.log(`Description: ${test.description}`);
    console.log(`Expected Indexes: ${test.expectedIndexes.join(', ')}`);
    console.log('');

    try {
      const result = await test.query();
      const resultCount = Array.isArray(result) ? result.length : result ? 1 : 0;
      console.log(`✓ Test passed - ${resultCount} results returned`);
    } catch (error) {
      console.error(`✗ Test failed:`, error);
    }
  }

  // Print summary
  console.log('\n========================================');
  console.log('Performance Summary');
  console.log('========================================\n');

  queryTimes.sort((a, b) => b.duration - a.duration);

  console.log('Query Execution Times:');
  console.log('----------------------');
  queryTimes.forEach((qt, index) => {
    const status = qt.duration < 10 ? '✓ Excellent' :
                   qt.duration < 50 ? '✓ Good' :
                   qt.duration < 100 ? '⚠ Fair' : '✗ Slow';
    console.log(`${index + 1}. ${qt.name}: ${qt.duration}ms ${status}`);
  });

  const avgTime = queryTimes.reduce((sum, qt) => sum + qt.duration, 0) / queryTimes.length;
  const maxTime = Math.max(...queryTimes.map(qt => qt.duration));
  const minTime = Math.min(...queryTimes.map(qt => qt.duration));

  console.log('\nStatistics:');
  console.log('-----------');
  console.log(`Average: ${avgTime.toFixed(2)}ms`);
  console.log(`Min: ${minTime}ms`);
  console.log(`Max: ${maxTime}ms`);

  console.log('\n========================================');
  console.log('Recommendations:');
  console.log('========================================\n');

  const slowQueries = queryTimes.filter(qt => qt.duration > 100);
  if (slowQueries.length > 0) {
    console.log('⚠ Slow queries detected (>100ms):');
    slowQueries.forEach(qt => {
      console.log(`  - ${qt.name}: ${qt.duration}ms`);
    });
    console.log('\nConsider:');
    console.log('  1. Running ANALYZE on affected tables');
    console.log('  2. Checking for missing sample data');
    console.log('  3. Reviewing query execution plans');
  } else {
    console.log('✓ All queries performing well (<100ms)');
  }

  if (avgTime > 50) {
    console.log('\n⚠ Average query time is above 50ms');
    console.log('  This may be due to empty or small tables in development');
    console.log('  Run seed script to generate sample data for realistic testing');
  }
}

async function main() {
  try {
    await runTests();
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
