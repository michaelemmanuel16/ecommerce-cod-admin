import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

const RETENTION_DAYS = parseInt(process.env.MESSAGE_LOG_RETENTION_DAYS || '90', 10);

export const messageCleanupQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('message-log-cleanup', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

messageCleanupQueue.process('cleanup-old-messages', async () => {
    logger.info(`Processing message log cleanup (retention: ${RETENTION_DAYS} days)...`);
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

        const BATCH_SIZE = 1000;
        let totalDeleted = 0;
        let deleted: number;
        do {
            const rows = await prisma.messageLog.findMany({
                where: { createdAt: { lt: cutoffDate } },
                select: { id: true },
                take: BATCH_SIZE,
            });
            if (rows.length === 0) break;
            const result = await prisma.messageLog.deleteMany({
                where: { id: { in: rows.map(r => r.id) } },
            });
            deleted = result.count;
            totalDeleted += deleted;
        } while (deleted === BATCH_SIZE);

        logger.info(`Message log cleanup completed: ${totalDeleted} records deleted (older than ${cutoffDate.toISOString()}).`);
    } catch (error: any) {
        logger.error('Message log cleanup job failed:', error.message);
        throw error;
    }
});

export const setupMessageCleanupCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    const repeatableJobs = await messageCleanupQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await messageCleanupQueue.removeRepeatableByKey(job.key);
    }

    // Run daily at 4:00 AM
    await messageCleanupQueue.add('cleanup-old-messages', {}, {
        repeat: {
            cron: '0 4 * * *'
        }
    });

    logger.info(`Message log cleanup cron scheduled (4:00 AM daily, ${RETENTION_DAYS}-day retention).`);
};

messageCleanupQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Message cleanup job ${job?.id} failed:`, err);
});

export default messageCleanupQueue;
