import { PrismaClient } from '@prisma/client';
import { GL_ACCOUNTS } from '../src/config/glAccounts';

const prisma = new PrismaClient();

// Account codes and SKUs are unique per tenant: say which tenant to work on.
const TENANT_ID = process.env.TENANT_ID;
if (!TENANT_ID) {
  console.error('Set TENANT_ID to the tenant id, for example: TENANT_ID=<uuid> ...');
  process.exit(1);
}

/**
 * Synchronize financial data for imported/existing orders
 * Creates missing Transaction records and General Ledger entries
 */
async function syncFinancialData() {
  console.log('🔄 Starting financial data synchronization...\n');

  try {
    // Step 1: Get all delivered orders with COD
    console.log('📦 Step 1: Fetching delivered orders...');
    const deliveredOrders = await prisma.order.findMany({
      where: {
        status: 'delivered',
        codAmount: { not: null },
        deletedAt: null,
      },
      include: {
        orderItems: {
          include: { product: true }
        },
        deliveryAgent: true,
        customerRep: true,
        customer: true
      }
    });

    console.log(`   Found ${deliveredOrders.length} delivered COD orders\n`);

    if (deliveredOrders.length === 0) {
      console.log('✅ No delivered orders found. Nothing to sync.');
      return;
    }

    // Step 2: Fetch GL accounts
    console.log('📊 Step 2: Fetching General Ledger accounts...');
    const [revenueAccount, cogsAccount, cashAccount, inventoryAccount] = await Promise.all([
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.PRODUCT_REVENUE } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.COGS } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.CASH_IN_HAND } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.INVENTORY } } })
    ]);

    if (!revenueAccount || !cogsAccount || !cashAccount) {
      throw new Error('Missing required GL accounts. Please run database migrations first.');
    }

    console.log(`   ✅ Revenue Account (${revenueAccount.code}): ${revenueAccount.name}`);
    console.log(`   ✅ COGS Account (${cogsAccount.code}): ${cogsAccount.name}`);
    console.log(`   ✅ Cash Account (${cashAccount.code}): ${cashAccount.name}\n`);

    // Step 3: Process each order
    console.log('💰 Step 3: Processing orders and creating financial entries...\n');

    let stats = {
      transactionsCreated: 0,
      transactionsSkipped: 0,
      journalEntriesCreated: 0,
      glTransactionsCreated: 0,
      totalRevenue: 0,
      totalCOGS: 0,
      errors: [] as string[]
    };

    for (const order of deliveredOrders) {
      try {
        console.log(`   Processing Order ID ${order.id}...`);

        // Check if Transaction already exists
        const existingTransaction = await prisma.transaction.findFirst({
          where: {
            orderId: order.id,
            type: 'cod_collection'
          }
        });

        if (existingTransaction) {
          console.log(`     ⏭️  Transaction already exists (ID: ${existingTransaction.id})`);
          stats.transactionsSkipped++;
        } else {
          // Create Transaction record
          const transaction = await prisma.transaction.create({
            data: {
              orderId: order.id,
              type: 'cod_collection',
              status: 'collected',
              amount: order.totalAmount,
              paymentMethod: 'cod',
              reference: `COD-SYNC-${order.id}`,
              metadata: {
                syncedAt: new Date().toISOString(),
                originalOrderDate: order.createdAt.toISOString(),
                syncReason: 'Backfill missing financial data'
              }
            }
          });
          console.log(`     ✅ Created Transaction (ID: ${transaction.id})`);
          stats.transactionsCreated++;
        }

        // Check if GL entries already exist
        const existingGLEntries = await prisma.accountTransaction.findFirst({
          where: {
            description: { contains: `Order ${order.id}` }
          }
        });

        if (existingGLEntries) {
          console.log(`     ⏭️  GL entries already exist`);
        } else {
          // Calculate COGS
          let totalCOGS = 0;
          for (const item of order.orderItems) {
            const cogs = Number(item.product.cogs || 0);
            totalCOGS += cogs * item.quantity;
          }

          stats.totalRevenue += order.totalAmount;
          stats.totalCOGS += totalCOGS;

          // Create journal entry
          const journalEntry = await prisma.journalEntry.create({
            data: {
              entryDate: order.deliveryDate || order.createdAt,
              description: `Order ${order.id} - COD Revenue Recognition`,
              sourceType: 'order_delivery',
              sourceId: order.id,
              createdBy: 1, // System user
            }
          });

          console.log(`     ✅ Created Journal Entry (ID: ${journalEntry.id})`);
          stats.journalEntriesCreated++;

          // Create GL transactions (double-entry bookkeeping)
          const glTransactions = [
            // Debit: Cash in Hand (increase asset)
            {
              accountId: cashAccount.id,
              journalEntryId: journalEntry.id,
              debitAmount: order.totalAmount,
              creditAmount: 0,
              description: `Order ${order.id} - Cash Collection from ${order.customer.firstName} ${order.customer.lastName}`,
              transactionDate: order.deliveryDate || order.createdAt,
            },
            // Credit: Revenue (increase income)
            {
              accountId: revenueAccount.id,
              journalEntryId: journalEntry.id,
              debitAmount: 0,
              creditAmount: order.subtotal, // Use subtotal for revenue (before shipping)
              description: `Order ${order.id} - Revenue Recognition`,
              transactionDate: order.deliveryDate || order.createdAt,
            },
            // Debit: COGS (increase expense)
            {
              accountId: cogsAccount.id,
              journalEntryId: journalEntry.id,
              debitAmount: totalCOGS,
              creditAmount: 0,
              description: `Order ${order.id} - Cost of Goods Sold`,
              transactionDate: order.deliveryDate || order.createdAt,
            }
          ];

          // Only add inventory credit if inventory account exists
          if (inventoryAccount && totalCOGS > 0) {
            glTransactions.push({
              accountId: inventoryAccount.id,
              journalEntryId: journalEntry.id,
              debitAmount: 0,
              creditAmount: totalCOGS,
              description: `Order ${order.id} - Inventory Reduction`,
              transactionDate: order.deliveryDate || order.createdAt,
            });
          }

          await prisma.accountTransaction.createMany({
            data: glTransactions
          });

          console.log(`     ✅ Created ${glTransactions.length} GL transactions`);
          stats.glTransactionsCreated += glTransactions.length;

          // Update account balances
          await prisma.$transaction([
            prisma.account.update({
              where: { id: cashAccount.id },
              data: { currentBalance: { increment: order.totalAmount } }
            }),
            prisma.account.update({
              where: { id: revenueAccount.id },
              data: { currentBalance: { increment: order.subtotal } }
            }),
            prisma.account.update({
              where: { id: cogsAccount.id },
              data: { currentBalance: { increment: totalCOGS } }
            }),
            ...(inventoryAccount && totalCOGS > 0 ? [
              prisma.account.update({
                where: { id: inventoryAccount.id },
                data: { currentBalance: { decrement: totalCOGS } }
              })
            ] : [])
          ]);

          console.log(`     ✅ Updated account balances`);
        }

        console.log('');

      } catch (error: any) {
        console.error(`     ❌ Error processing Order ${order.id}:`, error.message);
        stats.errors.push(`Order ${order.id}: ${error.message}`);
      }
    }

    // Step 4: Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📈 SYNCHRONIZATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Transactions Created:      ${stats.transactionsCreated}`);
    console.log(`⏭️  Transactions Skipped:      ${stats.transactionsSkipped} (already exist)`);
    console.log(`✅ Journal Entries Created:   ${stats.journalEntriesCreated}`);
    console.log(`✅ GL Transactions Created:   ${stats.glTransactionsCreated}`);
    console.log(`💰 Total Revenue Recognized:  GHS ${stats.totalRevenue.toFixed(2)}`);
    console.log(`📦 Total COGS Recorded:       GHS ${stats.totalCOGS.toFixed(2)}`);
    console.log(`💵 Gross Profit:              GHS ${(stats.totalRevenue - stats.totalCOGS).toFixed(2)}`);

    if (stats.errors.length > 0) {
      console.log(`\n❌ Errors: ${stats.errors.length}`);
      stats.errors.forEach(err => console.log(`   - ${err}`));
    } else {
      console.log(`\n✅ No errors encountered!`);
    }

    console.log('='.repeat(60));
    console.log('\n✅ Financial data synchronization completed successfully!\n');

    // Step 5: Verify data integrity
    console.log('🔍 Step 4: Verifying data integrity...\n');

    const [
      totalTransactions,
      totalJournalEntries,
      totalGLTransactions,
      revenueBalance,
      cashBalance,
      cogsBalance
    ] = await Promise.all([
      prisma.transaction.count({ where: { type: 'cod_collection' } }),
      prisma.journalEntry.count(),
      prisma.accountTransaction.count(),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.PRODUCT_REVENUE } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.CASH_IN_HAND } } }),
      prisma.account.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID!, code: GL_ACCOUNTS.COGS } } })
    ]);

    console.log(`   📊 Total COD Transactions in DB:    ${totalTransactions}`);
    console.log(`   📊 Total Journal Entries in DB:      ${totalJournalEntries}`);
    console.log(`   📊 Total GL Transactions in DB:      ${totalGLTransactions}`);
    console.log(`   📊 Revenue Account Balance:          GHS ${Number(revenueBalance?.currentBalance || 0).toFixed(2)}`);
    console.log(`   📊 Cash Account Balance:             GHS ${Number(cashBalance?.currentBalance || 0).toFixed(2)}`);
    console.log(`   📊 COGS Account Balance:             GHS ${Number(cogsBalance?.currentBalance || 0).toFixed(2)}`);
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
