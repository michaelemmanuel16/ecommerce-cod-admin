import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function diagnose() {
  console.log('=== ORDER IMPORT DIAGNOSIS ===\n');

  try {
    // 1. Total orders
    const totalOrders = await prisma.order.count({
      where: { createdAt: { gte: new Date('2026-01-01') } }
    });
    console.log(`✅ Total orders since Jan 1: ${totalOrders}`);

    // 2. Orders by status
    console.log('\n📊 Orders by status:');
    const statusBreakdown = await prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: new Date('2026-01-01') } },
      _count: true,
      _sum: { totalAmount: true }
    });
    statusBreakdown.forEach(s => {
      console.log(`  ${s.status}: ${s._count} orders, GHS ${(s._sum.totalAmount || 0).toFixed(2)}`);
    });

    // 3. Total revenue from all orders
    const allOrdersRevenue = await prisma.order.aggregate({
      where: { createdAt: { gte: new Date('2026-01-01') } },
      _sum: { totalAmount: true },
      _count: true
    });
    console.log(`\n💰 All orders revenue:`);
    console.log(`  Count: ${allOrdersRevenue._count}`);
    console.log(`  Total: GHS ${(allOrdersRevenue._sum.totalAmount || 0).toFixed(2)}`);

    // 4. Delivered orders only
    const deliveredRevenue = await prisma.order.aggregate({
      where: {
        status: 'delivered',
        createdAt: {
          gte: new Date('2026-01-01'),
          lte: new Date('2026-01-25T23:59:59')
        }
      },
      _sum: { totalAmount: true },
      _count: true
    });
    console.log(`\n✅ Delivered orders in date range (Jan 1-25):`);
    console.log(`  Count: ${deliveredRevenue._count}`);
    console.log(`  Revenue: GHS ${(deliveredRevenue._sum.totalAmount || 0).toFixed(2)}`);

    // 5. Orders by date
    console.log(`\n📅 Orders by date (last 10 days):`);
    const ordersByDate = await prisma.$queryRaw<Array<{ date: Date; count: bigint; total: number }>>`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as count,
        SUM(total_amount) as total
      FROM orders
      WHERE created_at >= '2026-01-01'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 10
    `;
    ordersByDate.forEach((row: any) => {
      console.log(`  ${row.date}: ${row.count} orders, GHS ${(row.total || 0).toFixed(2)}`);
    });

    // 6. Journal entries
    const jeCount = await prisma.journalEntry.count({
      where: { createdAt: { gte: new Date('2026-01-01') } }
    });
    console.log(`\n📔 Journal entries since Jan 1: ${jeCount}`);

    // 7. Check for orders without GL entries
    const deliveredOrders = await prisma.order.findMany({
      where: {
        status: 'delivered',
        createdAt: { gte: new Date('2026-01-01') }
      },
      select: { id: true, totalAmount: true, status: true, createdAt: true }
    });

    console.log(`\n🔍 Checking ${deliveredOrders.length} delivered orders for GL entries...`);

    const missingGL: any[] = [];
    for (const order of deliveredOrders) {
      const je = await prisma.journalEntry.findFirst({
        where: {
          sourceType: 'order_delivery',
          sourceId: order.id
        }
      });
      if (!je) {
        missingGL.push(order);
      }
    }

    console.log(`\n⚠️  Delivered orders without GL entries: ${missingGL.length}`);
    if (missingGL.length > 0) {
      console.log('📋 Sample orders missing GL (first 5):');
      missingGL.slice(0, 5).forEach(o => {
        console.log(`  Order ${o.id}: GHS ${o.totalAmount.toFixed(2)} - ${o.status} - ${o.createdAt}`);
      });
    }

    // 8. Check orders with zero amounts
    const zeroAmountOrders = await prisma.order.count({
      where: {
        createdAt: { gte: new Date('2026-01-01') },
        totalAmount: 0
      }
    });
    console.log(`\n⚠️  Orders with zero total_amount: ${zeroAmountOrders}`);

    // 9. Check for orders without items
    const allOrders = await prisma.order.findMany({
      where: {
        createdAt: { gte: new Date('2026-01-01') }
      },
      select: { id: true, totalAmount: true },
      take: 100
    });

    const ordersWithoutItems = [];
    for (const order of allOrders) {
      const itemCount = await prisma.orderItem.count({
        where: { orderId: order.id }
      });
      if (itemCount === 0) {
        ordersWithoutItems.push(order);
      }
    }
    console.log(`\n⚠️  Orders without items: ${ordersWithoutItems.length}`);
    if (ordersWithoutItems.length > 0 && ordersWithoutItems.length < 10) {
      console.log('📋 Orders without items:');
      ordersWithoutItems.forEach(o => {
        console.log(`  Order ${o.id}: GHS ${o.totalAmount?.toFixed(2) || '0.00'}`);
      });
    }

    // 10. Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total orders imported: ${totalOrders}`);
    console.log(`Delivered orders: ${deliveredRevenue._count}`);
    console.log(`Orders missing GL entries: ${missingGL.length}`);
    console.log(`Orders with zero amount: ${zeroAmountOrders}`);
    console.log(`Orders without items: ${ordersWithoutItems.length}`);

    console.log('\n🔍 LIKELY ISSUE:');
    if (missingGL.length === deliveredOrders.length) {
      console.log('❌ CRITICAL: NO GL automation ran for any delivered orders!');
      console.log('   → Fix: Run GL backfill script for all delivered orders');
    } else if (missingGL.length > 0) {
      console.log(`⚠️  WARNING: ${missingGL.length} delivered orders missing GL entries`);
      console.log('   → Fix: Run GL backfill for these specific orders');
    }

    if (deliveredRevenue._count === 0 && totalOrders > 0) {
      console.log('❌ CRITICAL: No orders in "delivered" status!');
      console.log('   → Fix: Update order statuses from CSV import');
    }

    if (zeroAmountOrders > 0) {
      console.log(`⚠️  WARNING: ${zeroAmountOrders} orders have zero/null amounts`);
      console.log('   → Fix: Recalculate order totals from items');
    }

    console.log('\n=== DIAGNOSIS COMPLETE ===');

  } catch (error) {
    console.error('❌ Error during diagnosis:', error);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();
