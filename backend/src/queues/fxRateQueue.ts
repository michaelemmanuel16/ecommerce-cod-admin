import Bull from 'bull';
import { refreshAutoRates } from '../services/fxService';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { DEFAULT_TIME_ZONE } from '../services/kpi/dates';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const fxRateQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('fx-rate-refresh', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 60000
            }
        }
    });

// Daily automatic FX rates (M1-T30): once per tenant, one FxRate row per pair (store currency -> extra currency).
// The provider is asked once per base currency per run.
export const processFxRefresh = async () => {
    logger.info('Processing FX rate refresh job...');
    const cache = new Map<string, Record<string, number>>();
    await forEachTenant('FX rate refresh', async (tenantId) => {
        const result = await refreshAutoRates(tenantId, { cache });
        if (result.pairs > 0) logger.info(`FX rates for tenant ${tenantId}: ${result.written}/${result.pairs} pairs written.`);
    });
    logger.info('FX rate refresh job completed.');
};
fxRateQueue.process('refresh-fx-rates', processFxRefresh);

export const setupFxRateCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await fxRateQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await fxRateQueue.removeRepeatableByKey(job.key);
    }

    // Daily at 06:00 in the store zone (Africa/Accra)
    await fxRateQueue.add('refresh-fx-rates', {}, {
        repeat: {
            cron: '0 6 * * *',
            tz: DEFAULT_TIME_ZONE,
        }
    });

    logger.info('FX rate cron job scheduled (06:00 Africa/Accra).');
};

fxRateQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`FX rate job ${job?.id} failed:`, err);
});

export default fxRateQueue;
