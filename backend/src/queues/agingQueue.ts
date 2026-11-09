import Bull from 'bull';
import agingService from '../services/agingService';
import { checkAndNotifyLateCallbacks, notifyAdminsOverdueCollections } from '../services/notificationService';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { runInTenant, withoutTenant } from '../utils/tenantContext';
import prisma from '../utils/prisma';

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

// Open and close the "negative cash held" Findings (once per tenant, each inside its own tenant context)
export const processSyncCashFindings = async () => {
    logger.info('Processing cash held Findings job...');
    try {
        await forEachTenant('Cash held Findings sync', () => agingService.syncNegativeCashFindings());
        logger.info('Cash held Findings job completed.');
    } catch (error: any) {
        logger.error('Cash held Findings job failed:', error.message);
        throw error;
    }
};
agingQueue.process('sync-cash-findings', processSyncCashFindings);

// Process the overdue collections notification job (once per tenant: admins of that tenant only)
export const processNotifyOverdueCollections = async () => {
    logger.info('Processing overdue collections notification job...');
    try {
        await forEachTenant('Overdue collections notification', async () => {
            const overdueAgents = await agingService.getOverdueAgents();
            if (overdueAgents.length > 0) {
                await notifyAdminsOverdueCollections(overdueAgents);
                logger.info(`Notified admins about ${overdueAgents.length} agents with overdue collections.`);
            } else {
                logger.info('No overdue collections found.');
            }
        });
    } catch (error: any) {
        logger.error('Overdue notification job failed:', error.message);
        throw error;
    }
};
agingQueue.process('notify-overdue-collections', processNotifyOverdueCollections);

// Process late call-back alerts (once per active tenant, M7-T12)
export const processLateCallbackAlerts = async () => {
    logger.info('Processing late call-back alerts job...');
    const tenants = await withoutTenant('late-callbacks-loop', () =>
        prisma.tenant.findMany({
            where: { subscriptionStatus: { notIn: ['suspended', 'cancelled'] } },
            select: { id: true },
        })
    );
    const failed: string[] = [];
    for (const { id } of tenants) {
        try {
            await runInTenant(id, () => checkAndNotifyLateCallbacks(id));
        } catch (error: any) {
            failed.push(id);
            logger.error(`Late call-back alerts check failed for tenant ${id}:`, error?.message ?? error);
        }
    }
    if (failed.length > 0) {
        throw new Error(`Late call-back alerts check failed for ${failed.length}/${tenants.length} tenants: ${failed.join(', ')}`);
    }
    logger.info('Late call-back alerts job completed.');
};
agingQueue.process('check-late-callbacks', processLateCallbackAlerts);

export const setupLateCallbackCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    await agingQueue.add('check-late-callbacks', {}, {
        repeat: {
            cron: '*/5 * * * *',
        },
    });
    logger.info('Late call-back alerts cron job scheduled (every 5 minutes).');
};

// Setup the daily cron jobs
export const setupAgingCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await agingQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await agingQueue.removeRepeatableByKey(job.key);
    }

    // Add daily cash held Findings job at 6:00 AM
    await agingQueue.add('sync-cash-findings', {}, {
        repeat: {
            cron: '0 6 * * *'
        }
    });

    // Add daily overdue notification job at 10:00 AM
    await agingQueue.add('notify-overdue-collections', {}, {
        repeat: {
            cron: '0 10 * * *'
        }
    });

    // Add late call-back alerts job every 5 minutes (M7-T12)
    await setupLateCallbackCron();

    logger.info('Agent aging cron jobs scheduled (6:00 AM cash held Findings, 10:00 AM overdue notifications).');
};

agingQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Aging job ${job?.id} failed:`, err);
});

export default agingQueue;
