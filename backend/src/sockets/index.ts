import { Server as SocketServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import logger from '../utils/logger';
import prisma from '../utils/prisma';
import { getTenantId, runInTenant } from '../utils/tenantContext';
import { isPlatformAdmin } from '../utils/platformAdmin';
import { checkResourceOwnership } from '../utils/authUtils';
import { JWTPayload } from '../types';
import { roomNames } from './rooms';
import * as Money from '../utils/money';

/**
 * Helper to safely emit to one or more rooms. Handles cases where io.to() returns undefined (e.g., in tests).
 * Several rooms are chained (io.to(a).to(b)), so one emit reaches the union of their sockets.
 * Money in the payload goes out as "x.xx" strings, like the REST API (Money.jsonReplacer);
 * the payload is serialised once per call, not once per room.
 */
function safeEmit(io: SocketServer | undefined, rooms: string | string[], event: string, data: any): void {
  const list = Array.isArray(rooms) ? rooms : [rooms];
  if (!io || list.length === 0) return;
  let target: any = io;
  for (const room of list) {
    if (!target || typeof target.to !== 'function') return;
    target = target.to(room);
  }
  if (target && typeof target.emit === 'function') {
    target.emit(event, data === undefined ? data : JSON.parse(JSON.stringify(data, Money.jsonReplacer)));
  }
}

/**
 * Tenant of an emit: the row's own tenantId first, then the request/job context.
 * With neither, the event is dropped: a tenant event must never go to a shared room.
 */
function emitTenant(data?: { tenantId?: string | null } | null): string | null {
  const tenantId = data?.tenantId ?? getTenantId();
  if (!tenantId) logger.warn('Socket emit dropped: no tenant for the event');
  return tenantId;
}

/** Emit to every socket of one tenant (the tenant-wide room). */
export function emitToTenant(io: SocketServer, event: string, data: any, tenantId?: string | null) {
  const t = tenantId ?? emitTenant();
  if (t) safeEmit(io, roomNames.tenant(t), event, data);
}

/** Emit to one user of one tenant. */
export function emitToUser(io: SocketServer, userId: number | string, event: string, data: any, tenantId?: string | null) {
  const t = tenantId ?? emitTenant();
  if (t) safeEmit(io, roomNames.user(t, userId), event, data);
}

/** Roles that see order and call events. super_admin is the tenant owner and sees what admin sees. */
const ORDER_ROLES = ['super_admin', 'admin', 'manager', 'sales_rep'];
/** Roles with financial permission. */
const FINANCE_ROLES = ['super_admin', 'admin', 'manager', 'accountant'];
/** Roles that oversee the team. */
const MANAGEMENT_ROLES = ['super_admin', 'admin', 'manager'];

/** Emit to the role rooms of one tenant in a single emit. */
export function emitToRoles(io: SocketServer, tenantId: string, roles: string[], event: string, data: any) {
  safeEmit(io, roles.map((role) => roomNames.role(tenantId, role)), event, data);
}

/** Can this user see the order? Same tenant scope and ownership rule as GET /orders/:id. */
async function canJoinOrder(user: JWTPayload, orderId: number): Promise<boolean> {
  if (!user.tenantId || !Number.isInteger(orderId)) return false;
  return runInTenant(user.tenantId, async () => {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      select: { customerRepId: true, deliveryAgentId: true, customerId: true },
    });
    if (!order) return false;
    return checkResourceOwnership(user, {
      assignedRepId: order.customerRepId,
      deliveryAgentId: order.deliveryAgentId,
      customerId: order.customerId,
    }, 'order');
  });
}

export function initializeSocket(httpServer: HTTPServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    }
  });

  // Authentication middleware. The tenant comes from the signed JWT.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = verifyAccessToken(token);
      socket.data.user = decoded;
      if (!decoded.tenantId) {
        // No tenant in the JWT: only a platform admin may connect (same rule as the HTTP middleware)
        if (!(await isPlatformAdmin(decoded.id))) {
          return next(new Error('Authentication error'));
        }
        socket.data.isPlatformAdmin = true;
      }
      next();
    } catch (error: any) {
      // The client refreshes its access token on TOKEN_EXPIRED and reconnects
      if (error?.name === 'TokenExpiredError') {
        return next(new Error('TOKEN_EXPIRED'));
      }
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as JWTPayload;
    const tenantId = user.tenantId;
    logger.info('User connected', { userId: user.id, role: user.role, tenantId });

    // Heartbeat
    socket.on('ping', () => socket.emit('pong'));

    if (!tenantId) {
      // Platform admins have no tenant: they join only the platform rooms
      socket.join(roomNames.platform);
      socket.join(roomNames.platformUser(user.id));
      return;
    }

    // Join tenant-scoped rooms
    socket.join(roomNames.tenant(tenantId));
    socket.join(roomNames.role(tenantId, user.role));
    socket.join(roomNames.user(tenantId, user.id));

    // Join order-specific rooms when requested: the order must be in this tenant
    // and visible to this user
    socket.on('join:order', async (orderId: string) => {
      try {
        if (!(await canJoinOrder(user, Number(orderId)))) {
          logger.warn('Denied join of order room', { userId: user.id, orderId });
          return;
        }
        socket.join(roomNames.order(tenantId, Number(orderId)));
        logger.info('User joined order room', { userId: user.id, orderId });
      } catch (error: any) {
        logger.error('join:order failed', { userId: user.id, orderId, error: error?.message });
      }
    });

    socket.on('leave:order', (orderId: string) => {
      socket.leave(roomNames.order(tenantId, Number(orderId)));
      logger.info('User left order room', { userId: user.id, orderId });
    });

    socket.on('disconnect', () => {
      logger.info('User disconnected', { userId: user.id });
    });
  });

  return io;
}

// Helper functions to emit events
export function emitOrderCreated(io: SocketServer, order: any) {
  const t = emitTenant(order);
  if (!t) return;
  emitToRoles(io, t, ORDER_ROLES, 'order:created', order);
}

export function emitOrderUpdated(io: SocketServer, order: any) {
  const t = emitTenant(order);
  if (!t) return;
  safeEmit(io, roomNames.order(t, order.id), 'order:updated', order);

  if (order.customerRepId) {
    emitToUser(io, order.customerRepId, 'order:updated', order, t);
  }

  if (order.deliveryAgentId) {
    emitToUser(io, order.deliveryAgentId, 'order:updated', order, t);
  }
}

export function emitOrderStatusChanged(io: SocketServer, order: any, oldStatus: string, newStatus: string) {
  const t = emitTenant(order);
  if (!t) return;
  const event = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    oldStatus,
    newStatus,
    timestamp: new Date()
  };

  safeEmit(io, roomNames.order(t, order.id), 'order:status_changed', event);
  emitToRoles(io, t, MANAGEMENT_ROLES, 'order:status_changed', event);

  if (order.customerRepId) {
    emitToUser(io, order.customerRepId, 'order:status_changed', event, t);
  }

  if (order.deliveryAgentId) {
    emitToUser(io, order.deliveryAgentId, 'order:status_changed', event, t);
  }
}

export function emitOrderAssigned(io: SocketServer, order: any, userId: string, role: string) {
  const t = emitTenant(order);
  if (!t) return;
  const event = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    assignedTo: userId,
    role,
    timestamp: new Date()
  };

  emitToUser(io, userId, 'order:assigned', event, t);
  safeEmit(io, roomNames.order(t, order.id), 'order:assigned', event);
}

export function emitDeliveryUpdated(io: SocketServer, delivery: any) {
  const t = emitTenant(delivery);
  if (!t) return;
  emitToUser(io, delivery.agentId, 'delivery:updated', delivery, t);
  safeEmit(io, roomNames.order(t, delivery.orderId), 'delivery:updated', delivery);
}

export function emitOrdersDeleted(io: SocketServer, orderIds: number[]) {
  const t = emitTenant();
  if (!t) return;
  const event = {
    orderIds,
    timestamp: new Date()
  };

  emitToRoles(io, t, ORDER_ROLES, 'orders:deleted', event);
}

export function emitNotification(io: SocketServer, userId: string, notification: any) {
  const t = emitTenant(notification);
  if (!t) return;
  emitToUser(io, userId, 'notification', notification, t);
}

export function emitPermissionsUpdated(io: SocketServer, updatedRoles: string[]) {
  const t = emitTenant();
  if (!t) return;
  const event = {
    updatedRoles,
    timestamp: new Date()
  };

  // Emit to all affected roles
  emitToRoles(io, t, updatedRoles, 'permissions:updated', event);
}

export function emitCallLogged(io: SocketServer, call: any) {
  const t = emitTenant(call);
  if (!t) return;
  // Emit to managers and admins
  emitToRoles(io, t, MANAGEMENT_ROLES, 'call:logged', call);

  // Emit to the sales rep who logged it
  emitToUser(io, call.salesRepId, 'call:logged', call, t);
}

// Financial event emitters
export function emitExpenseCreated(io: SocketServer, expense: any) {
  const t = emitTenant(expense);
  if (!t) return;
  emitToRoles(io, t, FINANCE_ROLES, 'expense:created', expense);
}

export function emitExpenseUpdated(io: SocketServer, expense: any) {
  const t = emitTenant(expense);
  if (!t) return;
  emitToRoles(io, t, FINANCE_ROLES, 'expense:updated', expense);
}

export function emitExpenseDeleted(io: SocketServer, expenseId: string) {
  const t = emitTenant();
  if (!t) return;
  const event = {
    id: expenseId,
    timestamp: new Date()
  };

  emitToRoles(io, t, FINANCE_ROLES, 'expense:deleted', event);
}

export function emitTransactionDeposited(io: SocketServer, transactionIds: string[], depositReference?: string) {
  const t = emitTenant();
  if (!t) return;
  const event = {
    transactionIds,
    depositReference,
    timestamp: new Date()
  };

  emitToRoles(io, t, FINANCE_ROLES, 'transaction:deposited', event);
}

export function emitTransactionReconciled(io: SocketServer, transaction: any) {
  const t = emitTenant(transaction);
  if (!t) return;
  emitToRoles(io, t, FINANCE_ROLES, 'transaction:reconciled', transaction);
}

export function emitGLEntryCreated(io: SocketServer, entry: any, metadata?: any) {
  const t = emitTenant(entry);
  if (!t) return;
  const event = {
    entry: {
      id: entry.id,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      description: entry.description,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
    },
    metadata,
    timestamp: new Date()
  };

  emitToRoles(io, t, FINANCE_ROLES, 'gl:entry-created', event);
}

export function emitCollectionVerified(io: SocketServer, collection: any) {
  const t = emitTenant(collection);
  if (!t) return;
  const event = {
    id: collection.id,
    orderId: collection.orderId,
    amount: collection.amount,
    status: collection.status,
    timestamp: new Date()
  };

  emitToRoles(io, t, FINANCE_ROLES, 'collection:verified', event);
  emitToUser(io, collection.agentId, 'collection:verified', event, t);
}

export function emitAgentBalanceUpdated(io: SocketServer, userId: number, balance: any) {
  const t = emitTenant(balance);
  if (!t) return;
  const event = {
    userId,
    totalCollected: balance.totalCollected,
    totalDeposited: balance.totalDeposited,
    currentBalance: balance.currentBalance,
    timestamp: new Date()
  };

  emitToUser(io, userId, 'agent:balance-updated', event, t);
  emitToRoles(io, t, FINANCE_ROLES, 'agent:balance-updated', event);
}

export function emitDepositVerified(io: SocketServer, deposit: any) {
  const t = emitTenant(deposit);
  if (!t) return;
  const event = {
    id: deposit.id,
    agentId: deposit.agentId,
    amount: deposit.amount,
    status: 'verified',
    timestamp: new Date()
  };

  emitToUser(io, deposit.agentId, 'deposit:verified', event, t);
  emitToRoles(io, t, FINANCE_ROLES, 'deposit:verified', event);
}
