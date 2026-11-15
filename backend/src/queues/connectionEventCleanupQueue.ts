import Bull from 'bull';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { CONNECTION_EVENT_RETENTION_DAYS, purgeOldConnectionEvents } from '../services/connections/connectionEventService';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

// M9-T26: its own small queue, so the message cleanup queue (which clears its repeat jobs on start) stays untouched
export const connectionEventCleanupQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('connection-event-cleanup', {
        redis: redisConfig,
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    });

export const processPurgeConnectionEvents = async () => {
    let total = 0;
    try {
        // Once per tenant, each inside its own tenant context
        await forEachTenant('Connection event cleanup', async () => {
            total += await purgeOldConnectionEvents();
        });
        logger.info(`Connection event cleanup completed: ${total} rows deleted (older than ${CONNECTION_EVENT_RETENTION_DAYS} days).`);
    } catch (error: any) {
        logger.error('Connection event cleanup job failed:', error.message);
        throw error;
    }
};
connectionEventCleanupQueue.process('purge-old-connection-events', processPurgeConnectionEvents);

export const setupConnectionEventCleanupCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    const repeatableJobs = await connectionEventCleanupQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await connectionEventCleanupQueue.removeRepeatableByKey(job.key);
    }
    // Daily at 4:45 AM
    await connectionEventCleanupQueue.add('purge-old-connection-events', {}, { repeat: { cron: '45 4 * * *' } });
    logger.info('Connection event cleanup cron scheduled (4:45 AM daily).');
};

connectionEventCleanupQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Connection event cleanup job ${job?.id} failed:`, err);
});

export default connectionEventCleanupQueue;
