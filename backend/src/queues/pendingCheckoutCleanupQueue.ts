import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { settlePayment } from '../services/paystackSettlementService';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

// How long an unpaid Paystack checkout lingers before it's swept. Generous
// enough to outlast a slow redirect / late webhook; short enough that the table
// doesn't accumulate abandoned-checkout snapshots.
const RETENTION_HOURS = parseInt(process.env.PENDING_CHECKOUT_RETENTION_HOURS || '24', 10);

export const pendingCheckoutCleanupQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('pending-checkout-cleanup', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

export const processCleanupStalePending = async () => {
    logger.info(`Processing pending-checkout cleanup (retention: ${RETENTION_HOURS}h)...`);
    try {
        const cutoffDate = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
        let deletedCount = 0;
        // Once per tenant, each inside its own tenant context
        await forEachTenant('Pending-checkout cleanup', async () => {
            // needs_review rows hold a payment with no order: they stay until a person resolves them (F-404).
            const result = await prisma.pendingCheckout.deleteMany({
                where: { createdAt: { lt: cutoffDate }, status: { not: 'needs_review' } },
            });
            deletedCount += result.count;
        });
        logger.info(`Pending-checkout cleanup completed: ${deletedCount} abandoned checkouts deleted (older than ${cutoffDate.toISOString()}).`);
    } catch (error: any) {
        logger.error('Pending-checkout cleanup job failed:', error.message);
        throw error;
    }
};
pendingCheckoutCleanupQueue.process('cleanup-stale-pending', processCleanupStalePending);

// Sweep (F-404): a lost webhook or a buyer who never came back leaves a paid checkout without an order.
// Rows older than this and not yet resolved are asked about at the provider.
const SWEEP_MIN_AGE_MINUTES = 10;

/**
 * Per tenant: every `initiated` or `pending` checkout older than 10 minutes goes through settlePayment, which asks the
 * provider (verify), settles a success, and marks the row failed / expired / pending with lastCheckedAt.
 * One bad row never stops the others. Exported so tests call it directly.
 */
export const processSweepPendingCheckouts = async () => {
    const cutoff = new Date(Date.now() - SWEEP_MIN_AGE_MINUTES * 60 * 1000);
    let checked = 0;
    await forEachTenant('Pending-checkout sweep', async () => {
        const rows = await prisma.pendingCheckout.findMany({
            where: { createdAt: { lt: cutoff }, status: { in: ['initiated', 'pending'] } },
            select: { reference: true },
            orderBy: { createdAt: 'asc' },
            take: 200,
        });
        for (const { reference } of rows) {
            try {
                await settlePayment(reference);
                checked++;
            } catch (error: any) {
                logger.error('Pending-checkout sweep failed for a reference', { reference, error: error.message });
            }
        }
    });
    logger.info(`Pending-checkout sweep checked ${checked} checkouts.`);
};
pendingCheckoutCleanupQueue.process('sweep-pending-checkouts', processSweepPendingCheckouts);

export const setupPendingCheckoutCleanupCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    const repeatableJobs = await pendingCheckoutCleanupQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await pendingCheckoutCleanupQueue.removeRepeatableByKey(job.key);
    }

    // Run hourly — abandoned checkouts are invisible, but keep the table lean.
    await pendingCheckoutCleanupQueue.add('cleanup-stale-pending', {}, {
        repeat: {
            cron: '0 * * * *'
        }
    });

    // Every 10 minutes — settle or close checkouts whose webhook was lost.
    await pendingCheckoutCleanupQueue.add('sweep-pending-checkouts', {}, {
        repeat: {
            cron: '*/10 * * * *'
        }
    });

    logger.info(`Pending-checkout cleanup cron scheduled (hourly, ${RETENTION_HOURS}h retention; sweep every 10 min).`);
};

pendingCheckoutCleanupQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Pending-checkout cleanup job ${job?.id} failed:`, err);
});

export default pendingCheckoutCleanupQueue;
