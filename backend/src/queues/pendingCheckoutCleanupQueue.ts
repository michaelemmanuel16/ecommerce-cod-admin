import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

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

pendingCheckoutCleanupQueue.process('cleanup-stale-pending', async () => {
    logger.info(`Processing pending-checkout cleanup (retention: ${RETENTION_HOURS}h)...`);
    try {
        const cutoffDate = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
        const result = await prisma.pendingCheckout.deleteMany({
            where: { createdAt: { lt: cutoffDate } },
        });
        logger.info(`Pending-checkout cleanup completed: ${result.count} abandoned checkouts deleted (older than ${cutoffDate.toISOString()}).`);
    } catch (error: any) {
        logger.error('Pending-checkout cleanup job failed:', error.message);
        throw error;
    }
});

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

    logger.info(`Pending-checkout cleanup cron scheduled (hourly, ${RETENTION_HOURS}h retention).`);
};

pendingCheckoutCleanupQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Pending-checkout cleanup job ${job?.id} failed:`, err);
});

export default pendingCheckoutCleanupQueue;
