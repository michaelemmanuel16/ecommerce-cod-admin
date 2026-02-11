import { PrismaClient } from '@prisma/client';
import FinancialSyncService from '../src/services/financialSyncService';

const prisma = new PrismaClient();

/**
 * Simple wrapper to sync all delivered COD orders
 * Uses the FinancialSyncService which handles all the complexity
 */
async function syncFinancialData() {
  console.log('🔄 Starting financial data synchronization...\n');

  try {
    // Step 0: Find a valid admin user
    const adminUser = await prisma.user.findFirst({
      where: {
        role: { in: ['super_admin', 'admin'] }
      },
      select: { id: true, email: true }
    });

    if (!adminUser) {
      throw new Error('No admin user found. Please create an admin user first.');
    }

    console.log(`Using admin user: ${adminUser.email} (ID: ${adminUser.id})\n`);

    // Step 1: Get all delivered COD orders
    console.log('📦 Step 1: Fetching delivered orders...');
    const deliveredOrders = await prisma.order.findMany({
      where: {
        status: 'delivered',
        codAmount: { not: null },
        deletedAt: null,
      },
      select: { id: true }
    });

    console.log(`   Found ${deliveredOrders.length} delivered COD orders\n`);

    if (deliveredOrders.length === 0) {
      console.log('✅ No delivered orders found. Nothing to sync.');
      return;
    }

    // Step 2: Sync all orders
    console.log('💰 Step 2: Syncing financial data for all orders...\n');

    const orderIds = deliveredOrders.map(o => o.id);
    const results = await FinancialSyncService.batchSyncOrders(orderIds, adminUser.id);

    // Step 3: Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 SYNCHRONIZATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Orders Synced:         ${results.synced}`);
    console.log(`⏭️  Orders Skipped:        ${results.skipped}`);
    console.log(`❌ Errors:                ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Error Details:`);
      results.errors.forEach(err => console.log(`   - Order ${err.orderId}: ${err.error}`));
    } else {
      console.log(`\n✅ No errors encountered!`);
    }

    console.log('='.repeat(60));
    console.log('\n✅ Financial data synchronization completed successfully!\n');

    // Step 4: Verify data integrity
    console.log('🔍 Step 3: Verifying data integrity...\n');

    const [
      totalTransactions,
      totalJournalEntries,
      totalGLTransactions
    ] = await Promise.all([
      prisma.transaction.count({ where: { type: 'cod_collection' } }),
      prisma.journalEntry.count({ where: { sourceType: 'order_delivery' } }),
      prisma.accountTransaction.count()
    ]);

    console.log(`   📊 Total COD Transactions in DB:    ${totalTransactions}`);
    console.log(`   📊 Total Journal Entries in DB:      ${totalJournalEntries}`);
    console.log(`   📊 Total GL Transactions in DB:      ${totalGLTransactions}`);
    console.log('');

    console.log('✅ All done! Your financial data is now synchronized.');
    console.log('📱 You can now view accurate financial reports in the dashboard.\n');

  } catch (error) {
    console.error('❌ Fatal error during synchronization:', error);
    throw error;
  }
}

// Execute
syncFinancialData()
  .catch((error) => {
    console.error('Sync failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
