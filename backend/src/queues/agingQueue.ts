import Bull from 'bull';
import agingService from '../services/agingService';
import logger from '../utils/logger';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const agingQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('agent-aging-refresh', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

// Process the refresh job
agingQueue.process('refresh-buckets', async () => {
    logger.info('Processing agent aging refresh job...');
    try {
        await agingService.refreshAll();
        logger.info('Agent aging refresh job completed.');
    } catch (error: any) {
        logger.error('Agent aging refresh job failed:', error.message);
        throw error;
    }
});

// Setup the daily cron job (6:00 AM)
export const setupAgingCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await agingQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await agingQueue.removeRepeatableByKey(job.key);
    }

    // Add daily refresh job at 6:00 AM
    await agingQueue.add('refresh-buckets', {}, {
        repeat: {
            cron: '0 6 * * *'
        }
    });

    logger.info('Agent aging daily cron job scheduled for 6:00 AM.');
};

agingQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Aging job ${job?.id} failed:`, err);
});

export default agingQueue;
