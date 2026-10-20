import Bull from 'bull';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { checkLedgerForTenant } from '../services/ledgerCheckService';
import { DEFAULT_TIME_ZONE } from '../services/kpi/dates';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const ledgerCheckQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('ledger-check', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

// Order-versus-ledger check (M1-T28): once per tenant, each inside its own tenant context
const processLedgerCheck = async () => {
    logger.info('Processing order-versus-ledger check...');
    await forEachTenant('Ledger check', async (tenantId) => {
        await checkLedgerForTenant(tenantId);
    });
};
ledgerCheckQueue.process('check-ledger', processLedgerCheck);

export const setupLedgerCheckCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await ledgerCheckQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await ledgerCheckQueue.removeRepeatableByKey(job.key);
    }

    // 02:00 store time
    await ledgerCheckQueue.add('check-ledger', {}, {
        repeat: { cron: '0 2 * * *', tz: DEFAULT_TIME_ZONE },
    });

    logger.info('Ledger check cron job scheduled (02:00 Africa/Accra).');
};

ledgerCheckQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Ledger check job ${job?.id} failed:`, err);
});

export default ledgerCheckQueue;
