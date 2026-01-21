import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

export class AgingService {
  /**
   * Refreshes aging buckets for all agents with approved but non-deposited collections
   */
  async refreshAll(): Promise<void> {
    logger.info('Starting agent aging refresh...');
    const now = new Date();

    try {
      // 1. Get all approved collections that are NOT yet deposited or reconciled
      const collections = await (prisma as any).agentCollection.findMany({
        where: {
          status: 'approved',
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
   * Get the aging report from cached buckets
   */
  async getAgingReport() {
    return await (prisma as any).agentAgingBucket.findMany({
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
  }
}

export default new AgingService();
