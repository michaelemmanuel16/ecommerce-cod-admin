import Bull from 'bull';
import { FinancialSyncService } from '../services/financialSyncService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { SYSTEM_USER_ID } from '../config/constants';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const financialReconciliationQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('financial-reconciliation', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

// Find delivered orders missing financial records and retry sync
financialReconciliationQueue.process('reconcile-delivered-orders', async () => {
    logger.info('Processing financial reconciliation job...');

    const unsynced = await prisma.order.findMany({
        where: {
            status: 'delivered',
            revenueRecognized: false,
            codAmount: { gt: 0 },
            deletedAt: null,
        },
        include: {
            orderItems: { include: { product: true } },
            customer: true,
            deliveryAgent: true,
            customerRep: true,
        },
        take: 50, // Process in bounded batches to limit job duration
        orderBy: { updatedAt: 'asc' }, // Oldest first
    });

    if (unsynced.length === 0) {
        logger.info('Financial reconciliation: no unsynced delivered orders found.');
        return;
    }

    logger.info(`Financial reconciliation: found ${unsynced.length} delivered orders missing financial records.`);

    let synced = 0;
    let failed = 0;

    for (const order of unsynced) {
        try {
            const result = await FinancialSyncService.syncOrderFinancialData(
                prisma as any,
                order as any,
                SYSTEM_USER_ID
            );

            if (result.transaction || result.journalEntry) {
                synced++;
                logger.info(`Reconciliation synced order ${order.id}`, {
                    transactionId: result.transaction?.id,
                    journalEntryNumber: result.journalEntry?.entryNumber,
                });
            }
        } catch (error: any) {
            failed++;
            logger.error(`Reconciliation failed for order ${order.id}:`, error.message);
        }
    }

    logger.info(`Financial reconciliation complete: ${synced} synced, ${failed} failed, ${unsynced.length - synced - failed} already up-to-date.`);

    if (failed > 0 && failed === unsynced.length) {
        throw new Error(`All ${failed} orders failed reconciliation — will retry.`);
    } else if (failed > 0) {
        logger.warn(`Partial reconciliation: ${failed}/${unsynced.length} orders failed — next run will retry.`);
    }
});

// Setup the daily cron
export const setupFinancialReconciliationCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await financialReconciliationQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await financialReconciliationQueue.removeRepeatableByKey(job.key);
    }

    // Run every 15 minutes to catch any orders that missed financial sync
    await financialReconciliationQueue.add('reconcile-delivered-orders', {}, {
        repeat: {
            cron: '*/15 * * * *'
        }
    });

    logger.info('Financial reconciliation cron job scheduled (every 15 minutes).');
};

financialReconciliationQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Financial reconciliation job ${job?.id} failed:`, err);
});

export default financialReconciliationQueue;
