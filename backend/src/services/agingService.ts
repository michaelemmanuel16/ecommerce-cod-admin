import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import appEvents, { AppEvent } from '../utils/appEvents';

export class AgingService {
  constructor() {
    this.setupEventListeners();
  }

  private setupEventListeners() {
    appEvents.on(AppEvent.AGENT_COLLECTION_RECONCILED, () => {
      this.refreshAll().catch(err =>
        logger.error('Proactive aging refresh failed after reconciliation:', err)
      );
    });

    appEvents.on(AppEvent.BULK_ORDERS_IMPORTED, () => {
      this.refreshAll().catch(err =>
        logger.error('Proactive aging refresh failed after bulk import:', err)
      );
    });

    appEvents.on(AppEvent.ORDERS_DELETED, () => {
      this.refreshAll().catch(err =>
        logger.error('Proactive aging refresh failed after order deletion:', err)
      );
    });
  }

  /**
   * Refreshes aging buckets for all agents with approved but non-deposited collections
   */
  async refreshAll(): Promise<void> {
    logger.info('Starting agent aging refresh...');
    const now = new Date();

    try {
      // 1. Get all pending collections (draft, verified, approved) 
      // and ensure the associated order is not soft-deleted
      const collections = await (prisma as any).agentCollection.findMany({
        where: {
          status: { in: ['draft', 'verified', 'approved'] },
          order: {
            deletedAt: null
          }
        },
        include: {
          agent: {
            select: { id: true }
          }
        }
      });

      logger.info(`Found ${collections.length} approved collections to analyze.`);

      if (collections.length === 0) {
        // Clear existing buckets if no approved collections exist
        await (prisma as any).agentAgingBucket.deleteMany({});
        return;
      }

      // 2. Group by agent and calculate buckets
      const agentAgingMap = new Map<number, any>();

      for (const col of collections) {
        const agentId = col.agentId;
        if (!agentAgingMap.has(agentId)) {
          agentAgingMap.set(agentId, {
            agentId,
            bucket_0_1: new Prisma.Decimal(0),
            bucket_2_3: new Prisma.Decimal(0),
            bucket_4_7: new Prisma.Decimal(0),
            bucket_8_plus: new Prisma.Decimal(0),
            totalBalance: new Prisma.Decimal(0),
            oldestCollectionDate: col.collectionDate,
          });
        }

        const data = agentAgingMap.get(agentId);
        const amount = new Prisma.Decimal(col.amount.toString());
        data.totalBalance = data.totalBalance.add(amount);

        if (col.collectionDate < data.oldestCollectionDate) {
          data.oldestCollectionDate = col.collectionDate;
        }

        const daysSince = Math.floor((now.getTime() - new Date(col.collectionDate).getTime()) / 86400000);

        if (daysSince <= 1) {
          data.bucket_0_1 = data.bucket_0_1.add(amount);
        } else if (daysSince <= 3) {
          data.bucket_2_3 = data.bucket_2_3.add(amount);
        } else if (daysSince <= 7) {
          data.bucket_4_7 = data.bucket_4_7.add(amount);
        } else {
          data.bucket_8_plus = data.bucket_8_plus.add(amount);
        }
      }

      // 3. Upsert results into agent_aging_buckets
      await prisma.$transaction(async (tx) => {
        const extTx = tx as any;

        // Remove buckets for agents who no longer have approved collections
        const currentAgentIds = Array.from(agentAgingMap.keys());
        await extTx.agentAgingBucket.deleteMany({
          where: {
            agentId: {
              notIn: currentAgentIds
            }
          }
        });

        for (const [agentId, data] of agentAgingMap) {
          await extTx.agentAgingBucket.upsert({
            where: { agentId },
            update: {
              bucket_0_1: data.bucket_0_1,
              bucket_2_3: data.bucket_2_3,
              bucket_4_7: data.bucket_4_7,
              bucket_8_plus: data.bucket_8_plus,
              totalBalance: data.totalBalance,
              oldestCollectionDate: data.oldestCollectionDate,
            },
            create: {
              agentId,
              bucket_0_1: data.bucket_0_1,
              bucket_2_3: data.bucket_2_3,
              bucket_4_7: data.bucket_4_7,
              bucket_8_plus: data.bucket_8_plus,
              totalBalance: data.totalBalance,
              oldestCollectionDate: data.oldestCollectionDate,
            },
          });
        }
      });

      logger.info('Agent aging refresh completed successfully.');
    } catch (error) {
      logger.error('Error refreshing agent aging:', error);
      throw error;
    }
  }

  /**
   * Get the aging report from cached buckets with summary statistics
   */
  async getAgingReport() {
    const buckets = await (prisma as any).agentAgingBucket.findMany({
      include: {
        agent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          }
        }
      },
      orderBy: {
        bucket_8_plus: 'desc',
      }
    });

    const summary = await this.getAgingSummary(buckets);

    return {
      summary,
      buckets
    };
  }

  /**
   * Generates a CSV string for the agent aging report
   */
  async generateAgingCSV(): Promise<string> {
    const { buckets } = await this.getAgingReport();

    // CSV Header
    let csv = 'Agent,Total Balance,0-1 Day,2-3 Days,4-7 Days,8+ Days,Oldest Collection\n';

    for (const entry of buckets) {
      const agentName = `${entry.agent.firstName} ${entry.agent.lastName}`;
      const oldestDate = entry.oldestCollectionDate ? new Date(entry.oldestCollectionDate).toLocaleDateString() : 'N/A';

      csv += `"${agentName}",${entry.totalBalance},${entry.bucket_0_1},${entry.bucket_2_3},${entry.bucket_4_7},${entry.bucket_8_plus},"${oldestDate}"\n`;
    }

    return csv;
  }

  /**
   * Calculate summary KPIs from bucket data
   */
  private async getAgingSummary(buckets: any[]) {
    const totalAgentsWithBalance = buckets.length;
    let totalOutstandingAmount = new Prisma.Decimal(0);
    let overdueAgentsCount = 0;
    let criticalOverdueAmount = new Prisma.Decimal(0);
    let warningOverdueAmount = new Prisma.Decimal(0);
    let bucket_0_1_total = new Prisma.Decimal(0);
    let bucket_2_3_total = new Prisma.Decimal(0);

    for (const bucket of buckets) {
      const balance = new Prisma.Decimal(bucket.totalBalance.toString());
      totalOutstandingAmount = totalOutstandingAmount.add(balance);

      const b01 = new Prisma.Decimal(bucket.bucket_0_1.toString());
      const b23 = new Prisma.Decimal(bucket.bucket_2_3.toString());
      const critical = new Prisma.Decimal(bucket.bucket_8_plus.toString());
      const warning = new Prisma.Decimal(bucket.bucket_4_7.toString());

      bucket_0_1_total = bucket_0_1_total.add(b01);
      bucket_2_3_total = bucket_2_3_total.add(b23);

      if (critical.gt(0) || warning.gt(0)) {
        overdueAgentsCount++;
      }

      criticalOverdueAmount = criticalOverdueAmount.add(critical);
      warningOverdueAmount = warningOverdueAmount.add(warning);
    }

    // Get blocked agents count
    const blockedCount = await (prisma as any).agentBalance.count({
      where: {
        isBlocked: true,
        currentBalance: { gt: 0 }
      }
    });

    return {
      totalAgentsWithBalance,
      totalOutstandingAmount: totalOutstandingAmount.toNumber(),
      overdueAgentsCount,
      criticalOverdueAmount: criticalOverdueAmount.toNumber(),
      warningOverdueAmount: warningOverdueAmount.toNumber(),
      blockedAgentsWithBalance: blockedCount,
      bucketTotals: {
        bucket_0_1: bucket_0_1_total.toNumber(),
        bucket_2_3: bucket_2_3_total.toNumber(),
        bucket_4_7: warningOverdueAmount.toNumber(),
        bucket_8_plus: criticalOverdueAmount.toNumber(),
      }
    };
  }
  /**
   * Automatically blocks agents who have collections in the 4-7 day or 8+ day buckets
   */
  async autoBlockOverdueAgents(managerUserId: number): Promise<number> {
    logger.info('Checking for overdue agents to auto-block...');

    // Find all buckets with values in overdue columns
    const overdueBuckets = await (prisma as any).agentAgingBucket.findMany({
      where: {
        OR: [
          { bucket_4_7: { gt: 0 } },
          { bucket_8_plus: { gt: 0 } }
        ]
      },
      include: {
        agent: {
          select: { id: true, firstName: true, lastName: true }
        }
      }
    });

    logger.info(`Found ${overdueBuckets.length} agents with overdue collections.`);

    let blockedCount = 0;
    const agentReconciliationService = (await import('./agentReconciliationService')).default;

    for (const bucket of overdueBuckets) {
      try {
        // Double check they aren't already blocked to avoid redundant updates/notifications
        const balance = await agentReconciliationService.getAgentBalance(bucket.agentId);
        if (balance && !balance.isBlocked) {
          await agentReconciliationService.blockAgent(
            bucket.agentId,
            managerUserId,
            'Automatic block: Overdue collection balance (4+ days)'
          );
          blockedCount++;
        }
      } catch (error) {
        logger.error(`Failed to auto-block agent ${bucket.agentId}:`, error);
      }
    }

    logger.info(`Auto-block cycle completed. Blocked ${blockedCount} agents.`);
    return blockedCount;
  }
}

export default new AgingService();
