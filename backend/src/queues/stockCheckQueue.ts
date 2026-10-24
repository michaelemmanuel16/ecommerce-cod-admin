import Bull from 'bull';
import logger from '../utils/logger';
import { runStockCheck } from '../services/stockCheckService';
import { DEFAULT_TIME_ZONE } from '../services/kpi/dates';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const stockCheckQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('stock-check', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

// Product total versus the sum of the stock levels (M4-T17): once per tenant, each inside its own tenant context
const processStockCheck = async () => {
    logger.info('Processing stock check...');
    await runStockCheck();
};
stockCheckQueue.process('check-stock', processStockCheck);

export const setupStockCheckCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await stockCheckQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await stockCheckQueue.removeRepeatableByKey(job.key);
    }

    // 02:30 store time, after the ledger check
    await stockCheckQueue.add('check-stock', {}, {
        repeat: { cron: '30 2 * * *', tz: DEFAULT_TIME_ZONE },
    });

    logger.info('Stock check cron job scheduled (02:30 Africa/Accra).');
};

stockCheckQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Stock check job ${job?.id} failed:`, err);
});

export default stockCheckQueue;
