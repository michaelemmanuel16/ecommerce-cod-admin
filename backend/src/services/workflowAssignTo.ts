import { User } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { evaluateConditions } from '../utils/conditionEvaluator';
import assignmentService, { AssignmentWeights, AssignRole } from './assignmentService';
import { systemActor } from './systemUserService';
import { withSoftDeleted } from '../utils/prismaExtensions';

/**
 * The "Assign to" action (M9-T23, F-511): one or more call reps, delivery agents or partners, split evenly or by weight.
 * `config = { role: 'sales_rep' | 'delivery_agent' | 'partner', userIds: number[], split: 'even' | 'weighted', weights? }`.
 * A partner is a delivery agent user. Even is a round robin and weighted a smooth weighted round robin, both on the M6
 * assignment cursor (assignmentService, `AssignmentCursor` table), one cursor per workflow action. The order is written by
 * assignmentService.assignByRole as the system user, so history, notification and socket events fire as for any assignment.
 * "Assign by region" is the workflow condition "Region is X", not a mode of this action (decision O4).
 */

export const ASSIGN_TO_ROLES = ['sales_rep', 'delivery_agent', 'partner'] as const;
export type AssignToRole = typeof ASSIGN_TO_ROLES[number];
export const ASSIGN_TO_SPLITS = ['even', 'weighted'] as const;

export interface AssignToConfig {
  role: AssignToRole;
  userIds: number[];
  split: 'even' | 'weighted';
  /** Share per user id for `weighted`: any positive numbers, only the ratio counts. */
  weights?: Record<string, number>;
}

/** Per Assign-to role: the assignment role behind it and the Order column that holds the assignee. */
const ROLE_MAP: Record<AssignToRole, { assignRole: AssignRole; field: 'customerRepId' | 'deliveryAgentId' }> = {
  sales_rep: { assignRole: 'sales_rep', field: 'customerRepId' },
  delivery_agent: { assignRole: 'delivery_agent', field: 'deliveryAgentId' },
  partner: { assignRole: 'delivery_agent', field: 'deliveryAgentId' },
};
/** The assignment role behind an Assign-to role. */
export const assignRoleOf = (role: AssignToRole): AssignRole => ROLE_MAP[role].assignRole;
/** The Order column that holds the assignee of a role. */
export const assigneeFieldOf = (role: AssignToRole) => ROLE_MAP[role].field;

/** Refuses a bad "Assign to" config at save (400). */
export function validateAssignToConfig(config: any): void {
  if (!config || !ASSIGN_TO_ROLES.includes(config.role)) {
    throw new AppError(`assign_to needs a role: ${ASSIGN_TO_ROLES.join(', ')}`, 400);
  }
  if (!Array.isArray(config.userIds) || config.userIds.length === 0 || !config.userIds.every((id: unknown) => Number.isInteger(id) && (id as number) > 0)) {
    throw new AppError('assign_to needs at least one user', 400);
  }
  if (!ASSIGN_TO_SPLITS.includes(config.split)) {
    throw new AppError(`assign_to split must be one of: ${ASSIGN_TO_SPLITS.join(', ')}`, 400);
  }
  if (config.split === 'weighted') {
    const weights = config.weights;
    const ok = weights && typeof weights === 'object'
      && config.userIds.every((id: number) => typeof weights[id] === 'number' && weights[id] > 0);
    if (!ok) throw new AppError('A weighted split needs a weight above 0 for every user', 400);
  }
}

/** The cursor scope of one action of one workflow. */
export const assignToScope = (workflowId: number, actionIndex: number) => `workflow:${workflowId}:action:${actionIndex}`;

export interface AssignToContext {
  workflowId?: number;
  actionIndex?: number;
}

/**
 * Run the action for the order in `input`. The order is left alone (and the step succeeds with the reason) when:
 * the workflow's conditions do not match it, it already has a user for the role, or nobody in the list can take it.
 * A deactivated, away or blocked user is skipped; the cursor is kept.
 */
export async function runAssignTo(action: any, input: any, conditions?: any, ctx: AssignToContext = {}) {
  const config: AssignToConfig = action.config ?? {};
  validateAssignToConfig(config);
  const orderId = action.config?.orderId ?? input?.orderId ?? input?.id;
  if (!orderId) return { assigned: false, reason: 'no_order', message: 'No order in context, nothing to assign' };

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { orderItems: { include: { product: true } } } });
  if (!order) return { assigned: false, reason: 'order_not_found', message: `Order ${orderId} not found` };

  const matches = !conditions || evaluateConditions(conditions, {
    ...order,
    productName: order.orderItems.map((item: any) => item.product?.name).filter(Boolean).join(', '),
  });
  if (!matches) return { assigned: false, orderId, reason: 'conditions_not_met', message: 'The order does not match the workflow conditions' };

  const field = assigneeFieldOf(config.role);
  if ((order as any)[field] != null) {
    return { assigned: false, orderId, reason: 'already_assigned', message: 'Order already has an assigned user; left unchanged' };
  }

  const role = assignRoleOf(config.role);
  // The list in the order the workflow gives it, so the first pick is the first user. A deactivated user stays in the
  // rotation (the client hides inactive users unless asked) and is skipped at pick time: the cursor keeps its place.
  const found = await withSoftDeleted(() => prisma.user.findMany({ where: { id: { in: config.userIds } } }));
  const byId = new Map(found.map((u) => [u.id, u]));
  const users = config.userIds.map((id) => byId.get(id)).filter((u): u is User => !!u && u.role === role);
  if (users.length === 0) {
    return { assigned: false, orderId, reason: 'no_valid_users', message: 'None of the users in the list exist with this role' };
  }

  const scope = assignToScope(ctx.workflowId ?? 0, ctx.actionIndex ?? 0);
  const picked = config.split === 'weighted'
    ? await assignmentService.selectUserWeighted(users, (config.weights ?? {}) as AssignmentWeights, role, scope)
    : await assignmentService.selectUserRoundRobin(users, role, scope);
  if (!picked) {
    const reason = 'Nobody in the list is active and available, so the order stays unassigned';
    logger.warn('assign_to: no one available', { orderId, scope });
    return { assigned: false, orderId, reason: 'no_available_user', message: reason };
  }

  await assignmentService.assignByRole(orderId, picked.id, role, await systemActor());
  logger.info('Order assigned by workflow', { orderId, userId: picked.id, role, split: config.split, scope });
  return { assigned: true, orderId, assignedUserId: picked.id, assignedUserName: `${picked.firstName} ${picked.lastName}`, role: config.role, split: config.split };
}
