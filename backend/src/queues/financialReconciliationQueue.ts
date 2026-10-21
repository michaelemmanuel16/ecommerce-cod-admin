import Bull from 'bull';
import { FinancialSyncService } from '../services/financialSyncService';
import { ORDER_GL_INCLUDE } from '../services/glAutomationService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { getSystemUserId } from '../services/systemUserService';
import { runInTenantOf } from '../utils/tenantContext';
import { forEachTenant } from '../utils/tenantLoop';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
};

export const financialReconciliationQueue = process.env.NODE_ENV === 'test'
    ? ({
        process: () => { },
        on: () => { },
        add: () => { },
        close: () => Promise.resolve(),
    } as any)
    : new Bull('financial-reconciliation', {
        redis: redisConfig,
        defaultJobOptions: {
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            }
        }
    });

// One idempotent sync for both the post-delivery job and the 15-minute reconcile: both end in
// FinancialSyncService.syncOrderFinancialData, whose GL posting skips an order that already has an
// active revenue entry, so the two can never double post.
// Order.tenantId is nullable, so continue inside the order's own tenant (a NULL-tenant legacy row
// runs unscoped, with a log line) — otherwise every financial row is tagged tenant_id = NULL.
// The caller passes the actor, looked up before a NULL-tenant row drops to unscoped.
const syncOrderFinancials = async (order: any, actorId: number) => {
    return runInTenantOf(
        order.tenantId,
        'financial-reconciliation',
        () => FinancialSyncService.syncOrderFinancialData(prisma as any, order, actorId)
    );
};

// Post-delivery sync: queued after the move commits (M1-T10). Bull retries (3 attempts, backoff).
export const processOrderFinancialSync = async (job: { data: { orderId: number; tenantId?: string | null; userId?: number } }) => {
    const { orderId, tenantId, userId } = job.data;
    await runInTenantOf(tenantId, 'order-financial-sync', async () => {
        const order = await prisma.order.findFirst({
            where: { id: orderId, deletedAt: null },
            include: ORDER_GL_INCLUDE,
        });
        if (!order) return;
        await syncOrderFinancials(order, userId ?? await getSystemUserId(order.tenantId));
    });
};

/** Queue the post-delivery financial sync. A queue failure is logged; the reconcile job is the safety net. */
export const enqueueOrderFinancialSync = async (orderId: number, tenantId: string | null | undefined, userId?: number) => {
    try {
        await financialReconciliationQueue.add('sync-order-financials', { orderId, tenantId, userId });
    } catch (error: any) {
        logger.error(`Could not queue financial sync for order ${orderId}; reconcile will catch it:`, error.message);
    }
};

// Find delivered orders missing financial records and retry sync
export const processReconcileDeliveredOrders = async () => {
    logger.info('Processing financial reconciliation job...');
    // Once per tenant, each inside its own tenant context
    await forEachTenant('Financial reconciliation', reconcileTenantOrders);
};

async function reconcileTenantOrders() {

    const unsynced = await prisma.order.findMany({
        where: {
            status: 'delivered',
            revenueRecognized: false,
            codAmount: { gt: 0 },
            deletedAt: null,
        },
        include: ORDER_GL_INCLUDE,
        take: 50, // Process in bounded batches to limit job duration
        orderBy: { updatedAt: 'asc' }, // Oldest first
    });

    if (unsynced.length === 0) {
        logger.info('Financial reconciliation: no unsynced delivered orders found.');
        return;
    }

    logger.info(`Financial reconciliation: found ${unsynced.length} delivered orders missing financial records.`);

    // One lookup per tenant, not per order
    const actorId = await getSystemUserId();

    let synced = 0;
    let failed = 0;

    for (const order of unsynced) {
        try {
            const result = await syncOrderFinancials(order, actorId);

            if (result.transaction || result.journalEntry) {
                synced++;
                logger.info(`Reconciliation synced order ${order.id}`, {
                    transactionId: result.transaction?.id,
                    journalEntryNumber: result.journalEntry?.entryNumber,
                });
            }
        } catch (error: any) {
            failed++;
            logger.error(`Reconciliation failed for order ${order.id}:`, error.message);
        }
    }

    logger.info(`Financial reconciliation complete: ${synced} synced, ${failed} failed, ${unsynced.length - synced - failed} already up-to-date.`);

    if (failed > 0 && failed === unsynced.length) {
        throw new Error(`All ${failed} orders failed reconciliation — will retry.`);
    } else if (failed > 0) {
        logger.warn(`Partial reconciliation: ${failed}/${unsynced.length} orders failed — next run will retry.`);
    }
}
financialReconciliationQueue.process('reconcile-delivered-orders', processReconcileDeliveredOrders);
financialReconciliationQueue.process('sync-order-financials', processOrderFinancialSync);

// Setup the daily cron
export const setupFinancialReconciliationCron = async () => {
    if (process.env.NODE_ENV === 'test') return;

    // Remove existing repeatable jobs to avoid duplicates on restart
    const repeatableJobs = await financialReconciliationQueue.getRepeatableJobs();
    for (const job of repeatableJobs) {
        await financialReconciliationQueue.removeRepeatableByKey(job.key);
    }

    // Run every 15 minutes to catch any orders that missed financial sync
    await financialReconciliationQueue.add('reconcile-delivered-orders', {}, {
        repeat: {
            cron: '*/15 * * * *'
        },
        timeout: 120_000, // 2 minutes — prevents silent kills when processing 50 orders on slow DB
    });

    logger.info('Financial reconciliation cron job scheduled (every 15 minutes).');
};

financialReconciliationQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error(`Financial reconciliation job ${job?.id} failed:`, err);
});

export default financialReconciliationQueue;
