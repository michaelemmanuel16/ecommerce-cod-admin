/**
 * Sync Imported Orders to General Ledger
 *
 * This script creates GL journal entries for orders imported via CSV that were
 * marked as 'delivered' but never had GL entries created. This fixes a financial
 * leak where revenue was not recognized in the General Ledger.
 *
 * Usage:
 *   npm run sync:imported-gl -- --dry-run   # Preview changes
 *   npm run sync:imported-gl -- --execute   # Actually create entries
 */

import { PrismaClient } from '@prisma/client';
import { GLAutomationService, OrderWithItems } from '../src/services/glAutomationService';
import agentReconciliationService from '../src/services/agentReconciliationService';
import { SYSTEM_USER_ID } from '../src/config/constants';
import logger from '../src/utils/logger';

const prisma = new PrismaClient();

interface SyncSummary {
  totalOrders: number;
  successful: number;
  skipped: number;
  failed: number;
  totalRevenue: number;
  totalCOGS: number;
  totalCommissions: number;
  errors: Array<{ orderId: number; error: string }>;
}

interface OrderSyncResult {
  orderId: number;
  status: 'success' | 'skipped' | 'failed';
  revenue: number;
  cogs: number;
  commissions: number;
  glEntryId?: number;
  error?: string;
}

/**
 * Sync a single order to GL
 */
async function syncOrderToGL(
  orderId: number,
  dryRun: boolean
): Promise<OrderSyncResult> {
  try {
    // Fetch order with all required relations
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: {
            product: true
          }
        },
        customer: true,
        deliveryAgent: true,
        customerRep: true
      }
    });

    if (!order) {
      return {
        orderId,
        status: 'failed',
        revenue: 0,
        cogs: 0,
        commissions: 0,
        error: 'Order not found'
      };
    }

    // Verify order is eligible for sync
    if (order.status !== 'delivered') {
      return {
        orderId,
        status: 'skipped',
        revenue: 0,
        cogs: 0,
        commissions: 0,
        error: 'Order status is not delivered'
      };
    }

    if (order.glJournalEntryId) {
      return {
        orderId,
        status: 'skipped',
        revenue: 0,
        cogs: 0,
        commissions: 0,
        error: 'Order already has GL entry'
      };
    }

    if (order.source !== 'bulk_import') {
      return {
        orderId,
        status: 'skipped',
        revenue: 0,
        cogs: 0,
        commissions: 0,
        error: 'Order source is not bulk_import'
      };
    }

    // Calculate COGS
    const totalCOGS = GLAutomationService.calculateTotalCOGS(order.orderItems as any);

    // Validate COGS
    const cogsValidation = GLAutomationService.validateCOGS(order.orderItems as any);
    if (!cogsValidation.valid) {
      logger.warn(`Order ${orderId} has products with missing COGS: ${cogsValidation.missingProducts.join(', ')}`);
    }

    // Calculate commissions
    const deliveryCommission = order.deliveryAgent?.commissionAmount || 0;
    const salesRepCommission = order.customerRep?.commissionAmount || 0;
    const totalCommissions = deliveryCommission + salesRepCommission;

    // In dry-run mode, just return what would be created
    if (dryRun) {
      return {
        orderId,
        status: 'success',
        revenue: order.totalAmount,
        cogs: parseFloat(totalCOGS.toString()),
        commissions: totalCommissions,
        error: undefined
      };
    }

    // Execute actual GL entry creation in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create GL journal entry
      const glEntry = await GLAutomationService.createRevenueRecognitionEntry(
        tx as any,
        order as OrderWithItems,
        totalCOGS,
        SYSTEM_USER_ID
      );

      // Update order with GL entry link and revenue recognized flag
      await tx.order.update({
        where: { id: orderId },
        data: {
          revenueRecognized: true,
          glJournalEntryId: glEntry.id
        }
      });

      // Create draft agent collection if COD amount exists
      if (order.deliveryAgentId && order.codAmount) {
        await agentReconciliationService.createDraftCollection(
          tx,
          orderId,
          order.deliveryAgentId,
          order.codAmount,
          order.createdAt // Use order creation date as collection date
        );
      }

      return glEntry;
    });

    logger.info(`✅ Synced order ${orderId} - GL Entry: ${result.entryNumber}`);

    return {
      orderId,
      status: 'success',
      revenue: order.totalAmount,
      cogs: parseFloat(totalCOGS.toString()),
      commissions: totalCommissions,
      glEntryId: result.id
    };

  } catch (error: any) {
    logger.error(`❌ Failed to sync order ${orderId}:`, error);
    return {
      orderId,
      status: 'failed',
      revenue: 0,
      cogs: 0,
      commissions: 0,
      error: error.message
    };
  }
}

/**
 * Main sync function
 */
async function syncImportedOrdersToGL(dryRun: boolean) {
  console.log('\n🔄 SYNCING IMPORTED ORDERS TO GENERAL LEDGER\n');
  console.log('='.repeat(80));
  console.log(`\nMode: ${dryRun ? '🔍 DRY RUN (Preview Only)' : '⚡ EXECUTE (Creating Entries)'}\n`);

  // Find all delivered imported orders without GL entries
  const ordersToSync = await prisma.order.findMany({
    where: {
      source: 'bulk_import',
      status: 'delivered',
      glJournalEntryId: null
    },
    select: {
      id: true,
      totalAmount: true,
      createdAt: true
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  console.log(`Found ${ordersToSync.length} orders to sync\n`);

  if (ordersToSync.length === 0) {
    console.log('✅ No orders to sync. All delivered imported orders already have GL entries.\n');
    return;
  }

  // Show summary of what will be synced
  const totalRevenue = ordersToSync.reduce((sum, o) => sum + o.totalAmount, 0);
  console.log(`Total Revenue to Recognize: GH₵${totalRevenue.toFixed(2)}`);
  console.log(`Date Range: ${ordersToSync[0].createdAt.toISOString().split('T')[0]} to ${ordersToSync[ordersToSync.length - 1].createdAt.toISOString().split('T')[0]}`);
  console.log('\n' + '-'.repeat(80) + '\n');

  // Ask for confirmation if executing
  if (!dryRun) {
    console.log('⚠️  WARNING: This will create GL journal entries and modify financial data!');
    console.log('⚠️  Make sure you have reviewed the dry-run output before proceeding.\n');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');

    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('Starting sync...\n');
  }

  // Initialize summary
  const summary: SyncSummary = {
    totalOrders: ordersToSync.length,
    successful: 0,
    skipped: 0,
    failed: 0,
    totalRevenue: 0,
    totalCOGS: 0,
    totalCommissions: 0,
    errors: []
  };

  // Process each order
  for (let i = 0; i < ordersToSync.length; i++) {
    const order = ordersToSync[i];
    const progress = `[${i + 1}/${ordersToSync.length}]`;

    process.stdout.write(`${progress} Processing order ${order.id}...`);

    const result = await syncOrderToGL(order.id, dryRun);

    if (result.status === 'success') {
      summary.successful++;
      summary.totalRevenue += result.revenue;
      summary.totalCOGS += result.cogs;
      summary.totalCommissions += result.commissions;
      console.log(` ✅ Success - Revenue: GH₵${result.revenue.toFixed(2)}, COGS: GH₵${result.cogs.toFixed(2)}`);
    } else if (result.status === 'skipped') {
      summary.skipped++;
      console.log(` ⏭️  Skipped - ${result.error}`);
    } else {
      summary.failed++;
      summary.errors.push({ orderId: order.id, error: result.error || 'Unknown error' });
      console.log(` ❌ Failed - ${result.error}`);
    }
  }

  // Print final summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 SYNC SUMMARY:\n');
  console.log(`Total Orders Processed: ${summary.totalOrders}`);
  console.log(`✅ Successful: ${summary.successful}`);
  console.log(`⏭️  Skipped: ${summary.skipped}`);
  console.log(`❌ Failed: ${summary.failed}`);
  console.log('');
  console.log(`💰 Total Revenue Recognized: GH₵${summary.totalRevenue.toFixed(2)}`);
  console.log(`📦 Total COGS Recorded: GH₵${summary.totalCOGS.toFixed(2)}`);
  console.log(`💼 Total Commissions Recorded: GH₵${summary.totalCommissions.toFixed(2)}`);
  console.log(`📈 Gross Profit: GH₵${(summary.totalRevenue - summary.totalCOGS).toFixed(2)}`);
  console.log(`📉 Net Profit (after commissions): GH₵${(summary.totalRevenue - summary.totalCOGS - summary.totalCommissions).toFixed(2)}`);

  if (summary.errors.length > 0) {
    console.log('\n\n⚠️  ERRORS:\n');
    summary.errors.forEach(({ orderId, error }) => {
      console.log(`  Order ${orderId}: ${error}`);
    });
  }

  if (dryRun) {
    console.log('\n\n💡 This was a DRY RUN. No changes were made to the database.');
    console.log('💡 Run with --execute to actually create the GL entries.\n');
  } else {
    console.log('\n\n✅ SYNC COMPLETE! GL entries have been created.');
    console.log('✅ Please verify the financial reports in the admin dashboard.\n');
  }

  console.log('='.repeat(80) + '\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const execute = args.includes('--execute');

if (!dryRun && !execute) {
  console.error('\n❌ Error: You must specify either --dry-run or --execute\n');
  console.log('Usage:');
  console.log('  npm run sync:imported-gl -- --dry-run   # Preview changes');
  console.log('  npm run sync:imported-gl -- --execute   # Actually create entries\n');
  process.exit(1);
}

// Run the sync
syncImportedOrdersToGL(dryRun)
  .catch((error) => {
    console.error('\n❌ Fatal error during sync:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
