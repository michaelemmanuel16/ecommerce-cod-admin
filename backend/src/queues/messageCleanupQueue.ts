import Bull from 'bull';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

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

        const result = await prisma.messageLog.deleteMany({
            where: {
                createdAt: {
                    lt: cutoffDate,
                },
            },
        });

        logger.info(`Message log cleanup completed: ${result.count} records deleted (older than ${cutoffDate.toISOString()}).`);
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
