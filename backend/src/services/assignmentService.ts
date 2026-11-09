import { ActorKind, OrderStatus, User } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderAssigned, emitOrderUpdated } from '../sockets';
import { notifyOrderAssigned, notifyAdminsNoAssigneeAvailable } from './notificationService';
import { pickWithCursor } from './assignmentCursor';

/**
 * Assignment weights for weighted user selection
 * Maps user ID to their assignment weight (percentage as decimal)
 */
export interface AssignmentWeights {
  [userId: string]: number;
}

/** Who made the assignment: a signed-in user (manual path) or the tenant's system user (workflows). */
export interface AssignmentActor {
  kind: ActorKind;
  userId?: number;
}

/** `checkAvailable`: also refuse an agent who is not available. The manual path asks for it. */
interface AssignOptions {
  checkAvailable?: boolean;
  /** The owner confirmed a partner who is blocked for unpaid cash. */
  confirmBlocked?: boolean;
}

/** A delivery agent can change in every open state. */
const CLOSED_STATUSES: OrderStatus[] = ['delivered', 'digital_delivered', 'returned', 'cancelled'];

export type AssignRole = 'delivery_agent' | 'sales_rep';

/** What differs between the two roles; the field, meta key, audit action and error text are derived from it. */
const ASSIGN_KINDS: Record<AssignRole, { relation: string; short: string; label: string; noun: string }> = {
  delivery_agent: { relation: 'deliveryAgent', short: 'agent', label: 'Delivery agent', noun: 'delivery agent' },
  sales_rep: { relation: 'customerRep', short: 'rep', label: 'Customer rep', noun: 'customer representative' },
};

/**
 * Assignment Service
 * Handles user assignment logic for workflows (round-robin and weighted)
 */
export class AssignmentService {
  /**
   * Select a user using smooth round robin. The cursor lives in the database (F-513), so the sequence continues
   * after a restart. Every user counts the same.
   *
   * @param users - The rotation: every active user of the role, available or not
   * @param role - Role of the rotation
   * @param contextKey - Optional key to maintain separate cursors (e.g., 'delivery_agent_Accra')
   * @returns Selected user or null if nobody is available
   */
  async selectUserRoundRobin(users: User[], role: AssignRole, contextKey: string = 'default'): Promise<User | null> {
    return this.selectWithCursor(users, role, contextKey, () => 1);
  }

  /**
   * Select a user using smooth weighted round robin: shares are exact over one cycle, not only in the long run.
   * The weights come from the caller (the workflow's `assignments[].weight`). A user with no weight gets none;
   * if no available user has a weight, everyone counts the same.
   *
   * @param users - The rotation: every active user of the role, available or not
   * @param weights - Object mapping userId to weight (percentage as decimal, e.g., 0.5 = 50%)
   * @param role - Role of the rotation
   * @param contextKey - Key of the cursor
   * @returns Selected user or null if nobody is available
   */
  async selectUserWeighted(users: User[], weights: AssignmentWeights, role: AssignRole, contextKey: string = 'default'): Promise<User | null> {
    // Integer shares keep the running totals exact (0.6 + 0.4 would drift).
    return this.selectWithCursor(users, role, contextKey, (user) => Math.round((weights[user.id] || 0) * 1000));
  }

  /**
   * The rotation is the whole list; availability (active, switched on, and for a delivery agent not blocked for
   * unpaid cash) only decides who may take this order, so an away user is skipped and the cursor is kept.
   * Nobody available, or an empty rotation: no pick, and the owner gets one alert per scope per hour.
   */
  private async selectWithCursor(users: User[], role: AssignRole, contextKey: string, shareOf: (user: User) => number): Promise<User | null> {
    const blocked = role === 'delivery_agent' && users?.length
      ? new Set((await prisma.agentBalance.findMany({ where: { agentId: { in: users.map((u) => u.id) }, isBlocked: true }, select: { agentId: true } })).map((b) => b.agentId))
      : new Set<number>();
    const usable = (users ?? []).filter((user) => user.isActive && user.isAvailable && !blocked.has(user.id));
    if (usable.length === 0) {
      logger.warn('No active and available users for cursor selection', { contextKey });
      await this.alertNoneAvailable(contextKey, role);
      return null;
    }

    const shares = new Map(users.map((user) => [user.id, shareOf(user)]));
    // Nobody available has a weight: everyone counts the same.
    const equal = !usable.some((user) => shares.get(user.id)! > 0);
    if (equal) logger.info('No valid weights found, using equal distribution');
    const share = (user: User) => (equal ? 1 : shares.get(user.id)!);
    const toCandidate = (user: User) => ({ id: user.id, weight: share(user) });
    const rotation = users.filter((user) => share(user) > 0).map(toCandidate);
    const available = usable.filter((user) => share(user) > 0).map(toCandidate);

    const pickedId = await pickWithCursor(contextKey, role, rotation, available);
    const selectedUser = users.find((user) => user.id === pickedId)!;
    logger.info('User selected via assignment cursor', {
      userId: selectedUser.id,
      userName: `${selectedUser.firstName} ${selectedUser.lastName}`,
      contextKey
    });
    return selectedUser;
  }

  /** The owner is told once per scope per hour; an alert that fails must not stop the caller, the order just waits. */
  private async alertNoneAvailable(scope: string, role: AssignRole): Promise<void> {
    try {
      await notifyAdminsNoAssigneeAvailable(scope, role, ASSIGN_KINDS[role].noun);
    } catch (error) {
      logger.warn('No-assignee alert failed', { scope, error: (error as Error).message });
    }
  }

  /**
   * The rotation for a role: every active user, available or not. Availability is decided at pick time, so an
   * away user is skipped without resetting the cursor. `getUsersByRole` keeps its own filter for its other callers.
   */
  private getRotation(role: AssignRole): Promise<User[]> {
    return prisma.user.findMany({ where: { role, isActive: true }, orderBy: { firstName: 'asc' } });
  }

  /**
   * Get users by role with optional filters
   *
   * @param role - User role to filter by
   * @param additionalFilters - Additional Prisma where conditions
   * @returns Array of users matching the criteria
   */
  async getUsersByRole(role: string, additionalFilters?: any): Promise<User[]> {
    const users = await prisma.user.findMany({
      where: {
        role: role as any,
        isActive: true,
        isAvailable: true,
        // If it's a delivery agent, check if they are blocked in AgentBalance
        ...(role === 'delivery_agent' ? {
          OR: [
            { balance: { is: null } }, // no balance row yet: not blocked
            { balance: { is: { isBlocked: false } } },
          ],
        } : {}),
        ...additionalFilters
      },
      orderBy: { firstName: 'asc' }
    });

    return users;
  }

  /**
   * Select delivery agent for a specific area using round-robin
   *
   * @param area - Delivery area
   * @returns Selected delivery agent or null
   */
  async selectDeliveryAgentForArea(area: string): Promise<User | null> {
    // Use area-specific round-robin context
    return this.selectUserRoundRobin(await this.getRotation('delivery_agent'), 'delivery_agent', `delivery_agent_${area}`);
  }

  /**
   * Select sales representative using weighted distribution
   *
   * @param weights - Assignment weights for sales reps
   * @returns Selected sales rep or null
   */
  async selectSalesRepWeighted(weights: AssignmentWeights): Promise<User | null> {
    return this.selectUserWeighted(await this.getRotation('sales_rep'), weights, 'sales_rep', 'sales_rep');
  }

  /**
   * Validate assignment weights
   *
   * @param weights - Assignment weights to validate
   * @returns Validation result with errors if any
   */
  validateWeights(weights: AssignmentWeights): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!weights || typeof weights !== 'object') {
      errors.push('Weights must be an object');
      return { valid: false, errors };
    }

    let totalWeight = 0;
    const userIds = Object.keys(weights);

    if (userIds.length === 0) {
      errors.push('At least one user weight must be specified');
      return { valid: false, errors };
    }

    for (const userId of userIds) {
      const weight = weights[userId];

      if (typeof weight !== 'number') {
        errors.push(`Weight for user ${userId} must be a number`);
        continue;
      }

      if (weight < 0 || weight > 1) {
        errors.push(`Weight for user ${userId} must be between 0 and 1`);
      }

      totalWeight += weight;
    }

    // Allow some tolerance for floating point arithmetic
    if (Math.abs(totalWeight - 1.0) > 0.01 && userIds.length > 1) {
      errors.push(`Total weight is ${totalWeight.toFixed(2)}, should sum to approximately 1.0`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * The user an order is about to be assigned to, or an error: they must exist and hold the role. A deactivated user is not found: the client hides inactive users.
   * `checkAvailable` also refuses an agent who is not available. An agent whose cash is blocked is refused unless
   * `confirmBlocked` (F-314: the owner may pick a blocked partner after a confirm).
   */
  async loadAssignee(userId: number, role: AssignRole, { checkAvailable = false, confirmBlocked = false }: AssignOptions = {}) {
    const kind = ASSIGN_KINDS[role];
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError(`${kind.label} not found`, 404);
    }
    if (user.role !== role) {
      throw new AppError(`Invalid ${kind.noun}`, 400);
    }
    if (checkAvailable && !user.isAvailable) {
      throw new AppError('Delivery agent is not available', 400, 'PARTNER_UNAVAILABLE');
    }
    if (role === 'delivery_agent' && !confirmBlocked) {
      const balance = await prisma.agentBalance.findUnique({ where: { agentId: userId }, select: { isBlocked: true } });
      if (balance?.isBlocked) {
        throw new AppError(`${user.firstName} ${user.lastName} is blocked for unpaid cash`, 409, 'PARTNER_BLOCKED');
      }
    }
    return user;
  }

  /**
   * "Unassign both" (F-314): clears the call rep and the delivery agent. One history row and one audit row, no
   * notification. A closed order keeps its people, as for an agent change.
   */
  async unassignBoth(orderId: number, actor: AssignmentActor) {
    const order = await prisma.order.findUnique({ where: { id: orderId, deletedAt: null } });
    if (!order) {
      throw new AppError('Order not found', 404);
    }
    if (CLOSED_STATUSES.includes(order.status)) {
      throw new AppError('This order is closed. Its delivery agent cannot change.', 409, 'ORDER_CLOSED');
    }

    const actorUser = actor.kind === 'user' && actor.userId
      ? await prisma.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, lastName: true } })
      : null;
    const actorName = actorUser ? `${actorUser.firstName} ${actorUser.lastName}` : 'the system';
    const tenantId = resolveTenantId(order.tenantId);
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        customerRepId: null,
        deliveryAgentId: null,
        orderHistory: {
          create: {
            tenantId,
            status: order.status,
            notes: `Call rep and delivery agent removed by ${actorName}`,
            changedBy: actor.userId,
            actorKind: actor.kind,
            metadata: { removedRepId: order.customerRepId, removedAgentId: order.deliveryAgentId }
          }
        }
      },
      include: {
        customerRep: { select: { id: true, firstName: true, lastName: true } },
        deliveryAgent: { select: { id: true, firstName: true, lastName: true } },
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'unassign_both',
        resource: 'order',
        resourceId: orderId.toString(),
        metadata: { removedRepId: order.customerRepId, removedAgentId: order.deliveryAgentId },
        ...(actor.kind === 'user' && { actorKind: 'person' as const, channel: 'app' as const }),
        ...(actor.kind === 'system' && { actorKind: 'system' as const, channel: 'system' as const })
      }
    });

    emitOrderUpdated(getSocketInstance() as any, updated);
    return updated;
  }

  /**
   * Assign a delivery agent or a sales rep to an order: updates the order, writes the OrderHistory row and the
   * audit log, notifies the assignee (inbox and socket) and the order room. The one path for the manual endpoints,
   * the bulk assign and the workflow actions (`assign_agent`, `assign_user`). The delivery agent of a closed order
   * (delivered, digital delivered, returned, cancelled) does not change.
   */
  async assignByRole(orderId: number, userId: number, role: AssignRole, actor: AssignmentActor, options: AssignOptions = {}) {
    const kind = ASSIGN_KINDS[role];
    const [order, user] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId, deletedAt: null } }),
      this.loadAssignee(userId, role, options),
    ]);

    if (!order) {
      throw new AppError('Order not found', 404);
    }
    if (role === 'delivery_agent' && CLOSED_STATUSES.includes(order.status)) {
      throw new AppError('This order is closed. Its delivery agent cannot change.', 409, 'ORDER_CLOSED');
    }

    // The history note names the person who assigned and, on a change, who held the order before.
    const previousId = role === 'delivery_agent' ? order.deliveryAgentId : order.customerRepId;
    const [previous, actorUser] = await Promise.all([
      previousId && previousId !== userId ? prisma.user.findUnique({ where: { id: previousId }, select: { firstName: true, lastName: true } }) : null,
      actor.kind === 'user' && actor.userId ? prisma.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, lastName: true } }) : null,
    ]);
    const actorName = actorUser ? `${actorUser.firstName} ${actorUser.lastName}` : 'the system';
    const note = `${kind.label} assigned: ${user.firstName} ${user.lastName} by ${actorName}`
      + (previous ? ` (was ${previous.firstName} ${previous.lastName})` : '');

    const metaKey = `assigned${kind.short[0].toUpperCase()}${kind.short.slice(1)}Id`;
    const tenantId = resolveTenantId(order.tenantId);
    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        [`${kind.relation}Id`]: userId,
        orderHistory: {
          create: {
            tenantId,
            status: order.status,
            notes: note,
            changedBy: actor.userId,
            actorKind: actor.kind,
            metadata: { [metaKey]: userId }
          }
        }
      },
      include: {
        [kind.relation]: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    logger.info(`${kind.label} assigned to order: ${order.id} `, {
      orderId,
      userId,
      changedBy: actor.userId
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: `assign_${kind.short}`,
        resource: 'order',
        resourceId: orderId.toString(),
        metadata: { [metaKey]: userId },
        ...(actor.kind === 'user' && { actorKind: 'person' as const, channel: 'app' as const }),
        ...(actor.kind === 'system' && { actorKind: 'system' as const, channel: 'system' as const })
      }
    });

    // Inbox notification for the new holder (F-314, M7-T12); nobody is told about their own assignment.
    if (actor.userId !== userId) {
      try {
        await notifyOrderAssigned(userId, orderId, String(orderId), kind.label);
      } catch (error) {
        logger.warn('Assignment notification failed', { orderId, userId, error: (error as Error).message });
      }
    }

    // Emit socket events for real-time updates
    const ioInstance = getSocketInstance() as any;
    emitOrderAssigned(ioInstance, updated, userId.toString(), role);
    emitOrderUpdated(ioInstance, updated);

    return updated;
  }
}

export default new AssignmentService();
