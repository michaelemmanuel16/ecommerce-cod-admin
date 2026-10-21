import { ActorKind, User } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderAssigned, emitOrderUpdated } from '../sockets';

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
}

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
          balance: {
            OR: [
              { isBlocked: false },
              { isBlocked: null } // Handle if balance doesn't exist yet
            ]
          }
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
   * Assign a delivery agent or a sales rep to an order: updates the order, writes the OrderHistory row and the
   * audit log, and notifies over the socket. The one path for the manual endpoints and the workflow actions
   * (`assign_agent`, `assign_user`). The user must exist and have the role.
   */
  async assignByRole(orderId: number, userId: number, role: AssignRole, actor: AssignmentActor, { checkAvailable = false }: AssignOptions = {}) {
    const kind = ASSIGN_KINDS[role];
    const [order, user] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId, deletedAt: null } }),
      prisma.user.findUnique({ where: { id: userId } })
    ]);

    if (!order) {
      throw new AppError('Order not found', 404);
    }
    if (!user) {
      throw new AppError(`${kind.label} not found`, 404);
    }
    if (user.role !== role) {
      throw new AppError(`Invalid ${kind.noun}`, 400);
    }
    if (checkAvailable && !user.isAvailable) {
      throw new AppError('Delivery agent is not available', 400);
    }

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
            notes: `${kind.label} assigned: ${user.firstName} ${user.lastName} `,
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

    // Emit socket events for real-time updates
    const ioInstance = getSocketInstance() as any;
    emitOrderAssigned(ioInstance, updated, userId.toString(), role);
    emitOrderUpdated(ioInstance, updated);

    return updated;
  }
}

export default new AssignmentService();
