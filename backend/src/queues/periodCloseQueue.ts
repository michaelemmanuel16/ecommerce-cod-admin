import Bull from 'bull';
import logger from '../utils/logger';
import { runPeriodCloseJob } from '../services/periodCloseService';
import { DEFAULT_TIME_ZONE } from '../services/kpi/dates';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const periodCloseQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('period-close', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 60000
            }
        }
    });

// Month close (M6-T10, F-916): the month that ended, once per tenant, as that tenant's system user
periodCloseQueue.process('close-month', async () => {
    logger.info('Processing month close...');
    await runPeriodCloseJob();
});

export const setupPeriodCloseCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await periodCloseQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await periodCloseQueue.removeRepeatableByKey(job.key);
    }

    // Day 1 of the month at 03:00 store time (F-916)
    await periodCloseQueue.add('close-month', {}, {
        repeat: { cron: '0 3 1 * *', tz: DEFAULT_TIME_ZONE },
    });

    logger.info('Month close cron job scheduled (day 1, 03:00 Africa/Accra).');
};

periodCloseQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Month close job ${job?.id} failed:`, err);
});

export default periodCloseQueue;
