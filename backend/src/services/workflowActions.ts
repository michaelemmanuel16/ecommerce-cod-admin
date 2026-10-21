import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';
import { transitionOrder } from './orderStateMachine';
import { systemActor } from './systemUserService';

/**
 * Order writes shared by the two workflow executors (the Bull job in queues/workflowQueue.ts and
 * WorkflowService's synchronous one). Neither file writes the order itself (M2-T16).
 */

/** The status an `update_order` action sets: the editor writes `config.status`; older shapes are still read. */
export function workflowStatus(action: any): OrderStatus | undefined {
  return action.config?.status ?? action.status ?? action.config?.updates?.status;
}

/**
 * Move the order through the state machine as the system user. `depth` is the depth of the run that
 * caused this move (loop guard, M2-T17); the move carries depth + 1. No status is an error, not a no-op.
 */
export async function setOrderStatusByWorkflow(orderId: number, status: OrderStatus | undefined, depth: number = 0) {
  if (!status) throw new Error('update_order needs a status');
  return transitionOrder(orderId, status, await systemActor(), {
    note: 'Status set by workflow',
    workflowDepth: depth + 1,
  });
}

/** Add a tag to an order once, in one write. */
export async function addOrderTag(orderId: number, tag: string): Promise<void> {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, NOT: { tags: { has: tag } } },
    data: { tags: { push: tag } },
  });
  if (count === 0 && !(await prisma.order.findFirst({ where: { id: orderId }, select: { id: true } }))) {
    throw new AppError('Order not found', 404);
  }
}
