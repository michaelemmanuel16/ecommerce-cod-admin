import Bull from 'bull';
import { OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { evaluateConditions } from '../utils/conditionEvaluator';
import { getTenantId, runJobInTenant } from '../utils/tenantContext';
import { workflowQueue, CATCH_UP_JOB } from '../queues/workflowQueue';
import workflowService from './workflowService';
import { assigneeFieldOf, AssignToRole } from './workflowAssignTo';

/**
 * Catch-up (M9-T23, F-512): run a workflow on the orders that are already there, for example right after an "Assign to"
 * workflow is created. The preview counts the orders that match the trigger status and the conditions and have no user yet
 * for the role the workflow assigns. The run needs `confirm: true`, is refused when the workflow is off, and goes through the
 * queue in jobs of 50 orders. `idempotencyKey = catchup:<workflowId>:<orderId>:<workflow updatedAt>`: a double click starts nothing.
 */

export const CATCH_UP_BATCH = 50;
export const CATCH_UP_PREVIEW_IDS = 20;
/** Orders read for one preview or run; a store with more matches is run again after the first batch is assigned. */
export const CATCH_UP_SCAN_LIMIT = 5000;

const roleOfAction = (action: any): AssignToRole | null => {
  if (action?.type === 'assign_to') return action.config?.role ?? null;
  if (action?.type === 'assign_user') return action.config?.userType === 'sales_rep' ? 'sales_rep' : 'delivery_agent';
  return null;
};

/** The status a new run of this trigger starts from: the target status, or a new order's status. Null for other triggers. */
function triggerStatus(workflow: { triggerType: string; triggerData: any }): OrderStatus | null {
  if (workflow.triggerType === 'order_created') return 'pending_confirmation';
  if (workflow.triggerType === 'status_change') return workflow.triggerData?.status ?? workflow.triggerData?.targetStatus ?? null;
  return null;
}

async function loadWorkflow(workflowId: number) {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new AppError('Workflow not found', 404);
  return workflow;
}

/** Ids of the current orders the workflow would act on, oldest first. */
async function findCatchUpOrderIds(workflow: Awaited<ReturnType<typeof loadWorkflow>>): Promise<{ ids: number[]; capped: boolean }> {
  const roles = [...new Set(((workflow.actions as any[]) ?? []).map(roleOfAction).filter((r): r is AssignToRole => !!r))];
  if (roles.length === 0) throw new AppError('Catch-up needs an "Assign to" action in the workflow', 400);
  const status = triggerStatus(workflow);
  if (!status) throw new AppError('Catch-up works for new-order and status-change workflows', 400);

  const orders = await prisma.order.findMany({
    where: { status, deletedAt: null, OR: roles.map((role) => ({ [assigneeFieldOf(role)]: null })) },
    include: { orderItems: { include: { product: true } } },
    orderBy: { id: 'asc' },
    take: CATCH_UP_SCAN_LIMIT,
  });
  const conditions = workflow.conditions as any;
  const ids = orders
    .filter((order) => !conditions || evaluateConditions(conditions, {
      ...order,
      productName: order.orderItems.map((item) => item.product?.name).filter(Boolean).join(', '),
    }))
    .map((order) => order.id);
  return { ids, capped: orders.length === CATCH_UP_SCAN_LIMIT };
}

/** `GET /api/workflows/:id/catch-up/preview`: how many orders would be assigned now, and the first 20 ids. */
export async function previewCatchUp(workflowId: number) {
  const { ids, capped } = await findCatchUpOrderIds(await loadWorkflow(workflowId));
  return { count: ids.length, orderIds: ids.slice(0, CATCH_UP_PREVIEW_IDS), capped };
}

/** `POST /api/workflows/:id/catch-up`: queue the run, 50 orders a job. Off workflow 409; no `confirm: true` 400. */
export async function runCatchUp(workflowId: number, confirm: unknown) {
  const workflow = await loadWorkflow(workflowId);
  if (!workflow.isActive) throw new AppError('Switch the workflow on before running a catch-up', 409);
  if (confirm !== true) throw new AppError('Confirm the catch-up with confirm: true', 400);

  const { ids } = await findCatchUpOrderIds(workflow);
  const stamp = workflow.updatedAt.toISOString();
  const tenantId = getTenantId();
  const jobs: Array<{ name: string; data: object; opts: Bull.JobOptions }> = [];
  for (let i = 0; i < ids.length; i += CATCH_UP_BATCH) {
    const orderIds = ids.slice(i, i + CATCH_UP_BATCH);
    jobs.push({
      name: CATCH_UP_JOB,
      data: { workflowId, tenantId, orderIds, stamp },
      opts: { jobId: `wf-catchup:${workflowId}:${stamp}:${orderIds[0]}`, removeOnComplete: true },
    });
  }
  try {
    await Promise.all(jobs.map((job) => workflowQueue.add(job.name, job.data, job.opts)));
  } catch (error: any) {
    logger.error('Workflow catch-up could not be queued', { workflowId, error: error.message });
    throw new AppError('The queue is unavailable. Try again in a minute.', 503);
  }
  const batches = jobs.length;
  logger.info('Workflow catch-up queued', { workflowId, orders: ids.length, batches });
  return { queued: ids.length, batches };
}

/** The processor of one batch: one execution per order, skipped when its key already exists. */
export async function processCatchUpBatch(job: Bull.Job): Promise<void> {
  const { workflowId, tenantId, orderIds, stamp } = job.data as { workflowId: number; tenantId: string; orderIds: number[]; stamp: string };
  await runJobInTenant(`Workflow catch-up ${job.id} (workflow ${workflowId})`, tenantId, async () => {
    const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow || !workflow.isActive) {
      logger.info('Workflow catch-up batch skipped: workflow gone or off', { workflowId });
      return;
    }
    for (const orderId of orderIds) {
      try {
        const context = await workflowService.loadOrderContext(orderId);
        if (!context) continue;
        await workflowService.enqueueRun(workflow, context, undefined, {
          triggerSource: 'catch_up', orderId, idempotencyKey: `catchup:${workflowId}:${orderId}:${stamp}`,
        });
      } catch (error: any) {
        logger.error('Workflow catch-up run failed to start', { workflowId, orderId, error: error.message });
      }
    }
  });
}
