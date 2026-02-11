import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface StatusCount {
  status: string;
  count: number;
  totalAmount: number;
}

async function investigateImportedOrders() {
  console.log('\n🔍 INVESTIGATING IMPORTED ORDERS - FINANCIAL LEAK DIAGNOSIS\n');
  console.log('='.repeat(80));

  // Query 1: Total imported orders by status
  console.log('\n📊 IMPORTED ORDERS BY STATUS:');
  console.log('-'.repeat(80));

  const ordersByStatus = await prisma.$queryRaw<StatusCount[]>`
    SELECT
      status,
      COUNT(*)::int as count,
      SUM(total_amount)::float as "totalAmount"
    FROM orders
    WHERE source = 'bulk_import'
    GROUP BY status
    ORDER BY count DESC
  `;

  let totalOrders = 0;
  let totalRevenue = 0;

  ordersByStatus.forEach(row => {
    totalOrders += row.count;
    totalRevenue += row.totalAmount || 0;
    console.log(`  ${row.status.padEnd(20)} | Count: ${String(row.count).padStart(3)} | Revenue: GH₵${(row.totalAmount || 0).toFixed(2)}`);
  });

  console.log('-'.repeat(80));
  console.log(`  ${'TOTAL'.padEnd(20)} | Count: ${String(totalOrders).padStart(3)} | Revenue: GH₵${totalRevenue.toFixed(2)}`);

  // Query 2: Delivered orders without GL entries (THE LEAK)
  console.log('\n\n🚨 CRITICAL: DELIVERED ORDERS WITHOUT GL ENTRIES (FINANCIAL LEAK):');
  console.log('-'.repeat(80));

  const deliveredWithoutGL = await prisma.order.count({
    where: {
      source: 'bulk_import',
      status: 'delivered',
      glJournalEntryId: null
    }
  });

  const missingRevenue = await prisma.order.aggregate({
    where: {
      source: 'bulk_import',
      status: 'delivered',
      glJournalEntryId: null
    },
    _sum: { totalAmount: true },
    _min: { createdAt: true },
    _max: { createdAt: true }
  });

  console.log(`  Orders Missing GL Entries: ${deliveredWithoutGL}`);
  console.log(`  Missing Revenue Amount: GH₵${(missingRevenue._sum.totalAmount || 0).toFixed(2)}`);
  console.log(`  Earliest Order: ${missingRevenue._min.createdAt?.toISOString().split('T')[0] || 'N/A'}`);
  console.log(`  Latest Order: ${missingRevenue._max.createdAt?.toISOString().split('T')[0] || 'N/A'}`);

  // Query 3: Check if ANY imported orders have GL entries
  console.log('\n\n✅ IMPORTED ORDERS WITH GL ENTRIES (ALREADY FIXED):');
  console.log('-'.repeat(80));

  const withGL = await prisma.order.count({
    where: {
      source: 'bulk_import',
      glJournalEntryId: { not: null }
    }
  });

  console.log(`  Orders with GL Entries: ${withGL}`);

  // Query 4: All terminal statuses without GL entries
  console.log('\n\n⚠️  ALL TERMINAL STATUS ORDERS WITHOUT GL ENTRIES:');
  console.log('-'.repeat(80));

  const terminalStatuses = ['delivered', 'cancelled', 'returned'];

  for (const status of terminalStatuses) {
    const count = await prisma.order.count({
      where: {
        source: 'bulk_import',
        status: status as any,
        glJournalEntryId: null
      }
    });

    const revenue = await prisma.order.aggregate({
      where: {
        source: 'bulk_import',
        status: status as any,
        glJournalEntryId: null
      },
      _sum: { totalAmount: true }
    });

    if (count > 0) {
      console.log(`  ${status.padEnd(15)} | Count: ${String(count).padStart(3)} | Amount: GH₵${(revenue._sum.totalAmount || 0).toFixed(2)}`);
    }
  }

  // Query 5: Detailed investigation of delivered orders without GL
  console.log('\n\n🔬 DETAILED INVESTIGATION: SAMPLE ORDERS (First 20)');
  console.log('-'.repeat(80));

  const detailedOrders = await prisma.order.findMany({
    where: {
      source: 'bulk_import',
      status: 'delivered',
      glJournalEntryId: null
    },
    include: {
      orderItems: {
        include: {
          product: true
        }
      },
      delivery: true,
      deliveryAgent: true,
      customerRep: true
    },
    take: 20,
    orderBy: { createdAt: 'asc' }
  });

  console.log(`\nFound ${detailedOrders.length} orders to analyze:\n`);

  let missingCOGS = 0;
  let missingAgent = 0;
  let missingRep = 0;
  let hasDeliveryRecord = 0;

  detailedOrders.forEach((order, index) => {
    const hasCOGS = order.orderItems.every(item => item.product?.cogs != null && Number(item.product.cogs) > 0);
    const hasAgent = order.deliveryAgent != null;
    const hasRep = order.customerRep != null;
    const hasDelivery = order.delivery != null;

    if (!hasCOGS) missingCOGS++;
    if (!hasAgent) missingAgent++;
    if (!hasRep) missingRep++;
    if (hasDelivery) hasDeliveryRecord++;

    console.log(`${String(index + 1).padStart(3)}. Order ID: ${order.id}`);
    console.log(`     Amount: GH₵${order.totalAmount.toFixed(2)} | Created: ${order.createdAt.toISOString().split('T')[0]}`);
    console.log(`     Has COGS: ${hasCOGS ? '✅' : '❌'} | Has Agent: ${hasAgent ? '✅' : '❌'} | Has Rep: ${hasRep ? '✅' : '❌'} | Has Delivery: ${hasDelivery ? '✅' : '❌'}`);
  });

  // Summary statistics
  console.log('\n\n📈 DATA COMPLETENESS ANALYSIS (First 20 orders):');
  console.log('-'.repeat(80));
  console.log(`  Orders with Product COGS: ${20 - missingCOGS}/20 (${((20 - missingCOGS) / 20 * 100).toFixed(1)}%)`);
  console.log(`  Orders with Delivery Agent: ${20 - missingAgent}/20 (${((20 - missingAgent) / 20 * 100).toFixed(1)}%)`);
  console.log(`  Orders with Customer Rep: ${20 - missingRep}/20 (${((20 - missingRep) / 20 * 100).toFixed(1)}%)`);
  console.log(`  Orders with Delivery Record: ${hasDeliveryRecord}/20 (${(hasDeliveryRecord / 20 * 100).toFixed(1)}%)`);

  // Query 6: Check GL balance integrity
  console.log('\n\n💰 GENERAL LEDGER BALANCE CHECK:');
  console.log('-'.repeat(80));

  const glBalance = await prisma.$queryRaw<Array<{ total_debits: number, total_credits: number }>>`
    SELECT
      SUM(debit_amount)::float as total_debits,
      SUM(credit_amount)::float as total_credits
    FROM account_transactions
  `;

  if (glBalance.length > 0) {
    const { total_debits, total_credits } = glBalance[0];
    const balanced = Math.abs(total_debits - total_credits) < 0.01;
    console.log(`  Total Debits: GH₵${(total_debits || 0).toFixed(2)}`);
    console.log(`  Total Credits: GH₵${(total_credits || 0).toFixed(2)}`);
    console.log(`  Difference: GH₵${Math.abs((total_debits || 0) - (total_credits || 0)).toFixed(2)}`);
    console.log(`  Status: ${balanced ? '✅ BALANCED' : '❌ UNBALANCED'}`);
  }

  // Query 7: Revenue account summary
  console.log('\n\n💵 REVENUE ACCOUNT (4010) CURRENT BALANCE:');
  console.log('-'.repeat(80));

  const revenueBalance = await prisma.$queryRaw<Array<{ total_revenue: number, transaction_count: number }>>`
    SELECT
      SUM(at.credit_amount - at.debit_amount)::float as total_revenue,
      COUNT(*)::int as transaction_count
    FROM account_transactions at
    JOIN accounts a ON a.id = at.account_id
    WHERE a.code = '4010'
  `;

  if (revenueBalance.length > 0 && revenueBalance[0].total_revenue != null) {
    console.log(`  Current Revenue (GL): GH₵${revenueBalance[0].total_revenue.toFixed(2)}`);
    console.log(`  Transaction Count: ${revenueBalance[0].transaction_count}`);
    console.log(`  Missing Revenue: GH₵${(missingRevenue._sum.totalAmount || 0).toFixed(2)}`);
    console.log(`  Expected After Sync: GH₵${(revenueBalance[0].total_revenue + (missingRevenue._sum.totalAmount || 0)).toFixed(2)}`);
  } else {
    console.log(`  Current Revenue (GL): GH₵0.00`);
    console.log(`  Expected After Sync: GH₵${(missingRevenue._sum.totalAmount || 0).toFixed(2)}`);
  }

  // Final Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('📋 INVESTIGATION SUMMARY:');
  console.log('='.repeat(80));
  console.log(`\n✅ Total Imported Orders: ${totalOrders}`);
  console.log(`🚨 Delivered Orders Without GL: ${deliveredWithoutGL}`);
  console.log(`💰 Missing Revenue from GL: GH₵${(missingRevenue._sum.totalAmount || 0).toFixed(2)}`);
  console.log(`\n⚠️  Data Completeness Issues:`);
  console.log(`   - ${missingCOGS}/20 orders missing Product COGS (${(missingCOGS / 20 * 100).toFixed(1)}%)`);
  console.log(`   - ${missingAgent}/20 orders missing Delivery Agent (${(missingAgent / 20 * 100).toFixed(1)}%)`);
  console.log(`   - ${missingRep}/20 orders missing Customer Rep (${(missingRep / 20 * 100).toFixed(1)}%)`);

  console.log('\n\n✨ NEXT STEPS:');
  console.log('-'.repeat(80));
  console.log('1. Review the data completeness issues above');
  console.log('2. Decide on GL entry creation strategy:');
  console.log('   - Revenue only (skip COGS/commission if missing)');
  console.log('   - Full entries (require all data)');
  console.log('3. Run sync script with dry-run mode');
  console.log('4. Execute actual sync after approval');
  console.log('5. Verify financial reports reflect changes\n');
}

// Main execution
investigateImportedOrders()
  .catch((error) => {
    console.error('❌ Investigation failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
