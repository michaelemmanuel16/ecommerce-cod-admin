import { ActorKind, OrderStatus, User } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderAssigned, emitOrderUpdated } from '../sockets';
import { createNotification } from './notificationService';

/**
 * Assignment weights for weighted user selection
 * Maps user ID to their assignment weight (percentage as decimal)
 */
export interface AssignmentWeights {
  [userId: string]: number;
}

/**
 * User with optional weight for assignment
 */
interface UserWithWeight {
  user: User;
  weight?: number;
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
  // In-memory storage for round-robin state
  // In production, this should be stored in Redis or database
  private roundRobinIndices: Map<string, number> = new Map();

  /**
   * Select a user using round-robin algorithm
   *
   * @param users - Array of users to select from
   * @param contextKey - Optional key to maintain separate round-robin states (e.g., 'delivery_agent', 'sales_rep')
   * @returns Selected user or null if no users available
   */
  selectUserRoundRobin(users: User[], contextKey: string = 'default'): User | null {
    if (!users || users.length === 0) {
      logger.warn('No users available for round-robin selection');
      return null;
    }

    // Filter only active and available users
    const availableUsers = users.filter(user => user.isActive && user.isAvailable);

    if (availableUsers.length === 0) {
      logger.warn('No active and available users for round-robin selection');
      return null;
    }

    // Get current index for this context
    const currentIndex = this.roundRobinIndices.get(contextKey) || 0;

    // Select user at current index
    const selectedUser = availableUsers[currentIndex % availableUsers.length];

    // Update index for next selection
    this.roundRobinIndices.set(contextKey, (currentIndex + 1) % availableUsers.length);

    logger.info('User selected via round-robin', {
      userId: selectedUser.id,
      userName: `${selectedUser.firstName} ${selectedUser.lastName}`,
      contextKey,
      nextIndex: this.roundRobinIndices.get(contextKey)
    });

    return selectedUser;
  }

  /**
   * Select a user using weighted random selection
   *
   * Users with higher weights have proportionally higher chance of being selected
   * Weights should be between 0 and 1, and sum up to approximately 1.0
   *
   * @param users - Array of users to select from
   * @param weights - Object mapping userId to weight (percentage as decimal, e.g., 0.5 = 50%)
   * @returns Selected user or null if no users available
   */
  selectUserWeighted(users: User[], weights: AssignmentWeights): User | null {
    if (!users || users.length === 0) {
      logger.warn('No users available for weighted selection');
      return null;
    }

    // Filter only active and available users
    const availableUsers = users.filter(user => user.isActive && user.isAvailable);

    if (availableUsers.length === 0) {
      logger.warn('No active and available users for weighted selection');
      return null;
    }

    // Build weighted array
    const weightedUsers: UserWithWeight[] = [];
    let totalWeight = 0;

    for (const user of availableUsers) {
      const userWeight = weights[user.id] || 0;

      if (userWeight > 0) {
        weightedUsers.push({ user, weight: userWeight });
        totalWeight += userWeight;
      }
    }

    // If no valid weights, fall back to equal distribution
    if (weightedUsers.length === 0 || totalWeight === 0) {
      logger.info('No valid weights found, using equal distribution');
      const randomIndex = Math.floor(Math.random() * availableUsers.length);
      return availableUsers[randomIndex];
    }

    // Normalize weights to sum to 1.0 if they don't
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      logger.info('Normalizing weights', { originalTotal: totalWeight });
      weightedUsers.forEach(item => {
        if (item.weight) {
          item.weight = item.weight / totalWeight;
        }
      });
      totalWeight = 1.0;
    }

    // Select user based on weighted random selection
    const random = Math.random();
    let cumulativeWeight = 0;

    for (const item of weightedUsers) {
      cumulativeWeight += item.weight || 0;
      if (random <= cumulativeWeight) {
        logger.info('User selected via weighted distribution', {
          userId: item.user.id,
          userName: `${item.user.firstName} ${item.user.lastName}`,
          weight: item.weight,
          random
        });
        return item.user;
      }
    }

    // Fallback to last user (should rarely happen due to floating point precision)
    const fallbackUser = weightedUsers[weightedUsers.length - 1].user;
    logger.warn('Weighted selection fallback to last user', {
      userId: fallbackUser.id
    });
    return fallbackUser;
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
    // Get all delivery agents
    const agents = await this.getUsersByRole('delivery_agent');

    if (agents.length === 0) {
      logger.warn('No delivery agents available', { area });
      return null;
    }

    // Use area-specific round-robin context
    const contextKey = `delivery_agent_${area}`;
    return this.selectUserRoundRobin(agents, contextKey);
  }

  /**
   * Select sales representative using weighted distribution
   *
   * @param weights - Assignment weights for sales reps
   * @returns Selected sales rep or null
   */
  async selectSalesRepWeighted(weights: AssignmentWeights): Promise<User | null> {
    const salesReps = await this.getUsersByRole('sales_rep');

    if (salesReps.length === 0) {
      logger.warn('No sales representatives available');
      return null;
    }

    return this.selectUserWeighted(salesReps, weights);
  }

  /**
   * Reset round-robin state for a specific context
   * Useful for testing or when you want to restart the cycle
   *
   * @param contextKey - Context key to reset
   */
  resetRoundRobin(contextKey: string = 'default'): void {
    this.roundRobinIndices.delete(contextKey);
    logger.info('Round-robin state reset', { contextKey });
  }

  /**
   * Get current round-robin index for debugging
   *
   * @param contextKey - Context key to check
   * @returns Current index or 0 if not set
   */
  getRoundRobinIndex(contextKey: string = 'default'): number {
    return this.roundRobinIndices.get(contextKey) || 0;
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

    // Inbox notification for the new holder (F-314); nobody is told about their own assignment.
    if (actor.userId !== userId) {
      try {
        await createNotification(String(userId), 'order', 'Order assigned to you', `Order #${orderId} was assigned to you by ${actorName}`, { orderId, role });
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
