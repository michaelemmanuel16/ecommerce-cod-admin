import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { DEFAULT_TIME_ZONE } from '../services/kpi/dates';
import { checkAdsTokens } from '../services/metaTokenHealthService';
import { runAccountPull } from '../services/marketing/metaPullRunner';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const metaPullQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('meta-ads-pull', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 2,
            backoff: {
                type: 'exponential',
                delay: 60000
            }
        }
    });

// Daily at 05:00 in the store zone (Africa/Accra)
export const META_PULL_REPEAT = { cron: '0 5 * * *', tz: DEFAULT_TIME_ZONE };

// M8-T06 (COD-71): once per tenant. Token health first, then the last 3 days of every enabled, connected ad account.
// One account failing does not stop the next one. Errors never carry a token (pullAccount stores plain words).
export const processMetaPull = async () => {
    logger.info('Processing Meta Ads pull job...');
    await forEachTenant('Meta Ads pull', async (tenantId) => {
        await checkAdsTokens();
        const accounts = await prisma.metaAdAccount.findMany({
            where: { enabled: true, status: 'connected' },
            select: { id: true },
            orderBy: { id: 'asc' },
        });
        for (const { id } of accounts) {
            try {
                await runAccountPull(id);
            } catch (err: any) {
                logger.error(`Meta Ads pull failed for account ${id} (tenant ${tenantId})`, { error: err?.message });
            }
        }
    });
    logger.info('Meta Ads pull job completed.');
};
metaPullQueue.process('pull-meta-insights', processMetaPull);

export const setupMetaPullCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await metaPullQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await metaPullQueue.removeRepeatableByKey(job.key);
    }

    await metaPullQueue.add('pull-meta-insights', {}, { repeat: META_PULL_REPEAT });

    logger.info('Meta Ads pull cron job scheduled (05:00 Africa/Accra).');
};

metaPullQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Meta Ads pull job ${job?.id} failed:`, err);
});

export default metaPullQueue;
