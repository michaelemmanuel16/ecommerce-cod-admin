import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { forEachTenant } from '../utils/tenantLoop';
import { AUDIT_RETENTION_DAYS, auditService } from '../services/auditService';
import { MESSAGE_LOG_RETENTION_DAYS } from '../services/messaging/constants';
import { messageStatus } from '../services/messaging/messageStatus';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

const RETENTION_DAYS = MESSAGE_LOG_RETENTION_DAYS;

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

export const processCleanupOldMessages = async () => {
    logger.info(`Processing message log cleanup (retention: ${RETENTION_DAYS} days)...`);
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

        const BATCH_SIZE = 1000;
        let totalDeleted = 0;
        // Once per tenant, each inside its own tenant context
        await forEachTenant('Message log cleanup', async () => {
            let deleted: number;
            do {
                // Rows of a campaign stay: the campaign's sent/delivered/failed counters are counted from them
                const rows = await prisma.messageLog.findMany({
                    where: { createdAt: { lt: cutoffDate }, campaignId: null },
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
        });

        logger.info(`Message log cleanup completed: ${totalDeleted} records deleted (older than ${cutoffDate.toISOString()}).`);
    } catch (error: any) {
        logger.error('Message log cleanup job failed:', error.message);
        throw error;
    }
};
messageCleanupQueue.process('cleanup-old-messages', processCleanupOldMessages);

// M2-T05: audit log retention (AUDIT_RETENTION_DAYS, 400), once per tenant. A second named job on this queue.
export const processAuditRetention = async () => {
    logger.info(`Processing audit log retention (${AUDIT_RETENTION_DAYS} days)...`);
    let totalDeleted = 0;
    try {
        await forEachTenant('Audit log retention', async () => {
            totalDeleted += await auditService.purgeOlderThan(AUDIT_RETENTION_DAYS);
        });
        logger.info(`Audit log retention completed: ${totalDeleted} rows deleted.`);
    } catch (error: any) {
        logger.error('Audit log retention job failed:', error.message);
        throw error;
    }
};
messageCleanupQueue.process('purge-old-audit-logs', processAuditRetention);

// M9-T05: status events that nobody claimed within the hour (no MessageLog row matched). Not tenant scoped.
export const processDropExpiredPendingEvents = async () => {
    try {
        const dropped = await messageStatus.dropExpired();
        if (dropped > 0) logger.info(`Pending status events: ${dropped} expired and dropped.`);
    } catch (error: any) {
        logger.error('Pending status event cleanup failed:', error.message);
        throw error;
    }
};
messageCleanupQueue.process('drop-expired-pending-events', processDropExpiredPendingEvents);

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

    // Audit log retention daily at 4:30 AM
    await messageCleanupQueue.add('purge-old-audit-logs', {}, {
        repeat: {
            cron: '30 4 * * *'
        }
    });

    // Held status events: every 10 minutes
    await messageCleanupQueue.add('drop-expired-pending-events', {}, {
        repeat: {
            cron: '*/10 * * * *'
        }
    });

    logger.info(`Message log cleanup cron scheduled (4:00 AM daily, ${RETENTION_DAYS}-day retention).`);
};

messageCleanupQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Message cleanup job ${job?.id} failed:`, err);
});

export default messageCleanupQueue;
