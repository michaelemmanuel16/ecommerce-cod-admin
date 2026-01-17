import { Server as SocketServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import logger from '../utils/logger';

/**
 * Helper to safely emit to a room. Handles cases where io.to() returns undefined (e.g., in tests).
 */
function safeEmit(io: SocketServer | undefined, room: string, event: string, data: any): void {
  if (!io || typeof io.to !== 'function') return;
  const roomObj = io.to(room);
  if (roomObj && typeof roomObj.emit === 'function') {
    roomObj.emit(event, data);
  }
}

export function initializeSocket(httpServer: HTTPServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = verifyAccessToken(token);
      socket.data.user = decoded;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    logger.info('User connected', { userId: user.id, role: user.role });

    // Join role-based rooms
    socket.join(`role:${user.role}`);
    socket.join(`user:${user.id}`);

    // Join order-specific rooms when requested
    socket.on('join:order', (orderId: string) => {
      socket.join(`order:${orderId}`);
      logger.info('User joined order room', { userId: user.id, orderId });
    });

    socket.on('leave:order', (orderId: string) => {
      socket.leave(`order:${orderId}`);
      logger.info('User left order room', { userId: user.id, orderId });
    });

    // Heartbeat
    socket.on('ping', () => {
      socket.emit('pong');
    });

    socket.on('disconnect', () => {
      logger.info('User disconnected', { userId: user.id });
    });
  });

  return io;
}

// Helper functions to emit events
export function emitOrderCreated(io: SocketServer, order: any) {
  safeEmit(io, 'role:admin', 'order:created', order);
  safeEmit(io, 'role:manager', 'order:created', order);
  safeEmit(io, 'role:sales_rep', 'order:created', order);
}

export function emitOrderUpdated(io: SocketServer, order: any) {
  safeEmit(io, `order:${order.id}`, 'order:updated', order);

  if (order.customerRepId) {
    safeEmit(io, `user:${order.customerRepId}`, 'order:updated', order);
  }

  if (order.deliveryAgentId) {
    safeEmit(io, `user:${order.deliveryAgentId}`, 'order:updated', order);
  }
}

export function emitOrderStatusChanged(io: SocketServer, order: any, oldStatus: string, newStatus: string) {
  const event = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    oldStatus,
    newStatus,
    timestamp: new Date()
  };

  safeEmit(io, `order:${order.id}`, 'order:status_changed', event);
  safeEmit(io, 'role:admin', 'order:status_changed', event);
  safeEmit(io, 'role:manager', 'order:status_changed', event);

  if (order.customerRepId) {
    safeEmit(io, `user:${order.customerRepId}`, 'order:status_changed', event);
  }

  if (order.deliveryAgentId) {
    safeEmit(io, `user:${order.deliveryAgentId}`, 'order:status_changed', event);
  }
}

export function emitOrderAssigned(io: SocketServer, order: any, userId: string, role: string) {
  const event = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    assignedTo: userId,
    role,
    timestamp: new Date()
  };

  safeEmit(io, `user:${userId}`, 'order:assigned', event);
  safeEmit(io, `order:${order.id}`, 'order:assigned', event);
}

export function emitDeliveryUpdated(io: SocketServer, delivery: any) {
  safeEmit(io, `user:${delivery.agentId}`, 'delivery:updated', delivery);
  safeEmit(io, `order:${delivery.orderId}`, 'delivery:updated', delivery);
}

export function emitOrdersDeleted(io: SocketServer, orderIds: number[]) {
  const event = {
    orderIds,
    timestamp: new Date()
  };

  safeEmit(io, 'role:admin', 'orders:deleted', event);
  safeEmit(io, 'role:manager', 'orders:deleted', event);
  safeEmit(io, 'role:sales_rep', 'orders:deleted', event);
}

export function emitNotification(io: SocketServer, userId: string, notification: any) {
  safeEmit(io, `user:${userId}`, 'notification', notification);
}

export function emitPermissionsUpdated(io: SocketServer, updatedRoles: string[]) {
  const event = {
    updatedRoles,
    timestamp: new Date()
  };

  // Emit to all affected roles
  updatedRoles.forEach(role => {
    safeEmit(io, `role:${role}`, 'permissions:updated', event);
  });

  // Also emit to all connected clients (in case they need to refresh)
  if (io && typeof io.emit === 'function') {
    io.emit('permissions:updated', event);
  }
}

export function emitCallLogged(io: SocketServer, call: any) {
  // Emit to managers and admins
  safeEmit(io, 'role:admin', 'call:logged', call);
  safeEmit(io, 'role:manager', 'call:logged', call);

  // Emit to the sales rep who logged it
  safeEmit(io, `user:${call.salesRepId}`, 'call:logged', call);
}

// Financial event emitters
export function emitExpenseCreated(io: SocketServer, expense: any) {
  // Emit to roles with financial permission
  safeEmit(io, 'role:admin', 'expense:created', expense);
  safeEmit(io, 'role:manager', 'expense:created', expense);
  safeEmit(io, 'role:accountant', 'expense:created', expense);
}

export function emitExpenseUpdated(io: SocketServer, expense: any) {
  // Emit to roles with financial permission
  safeEmit(io, 'role:admin', 'expense:updated', expense);
  safeEmit(io, 'role:manager', 'expense:updated', expense);
  safeEmit(io, 'role:accountant', 'expense:updated', expense);
}

export function emitExpenseDeleted(io: SocketServer, expenseId: string) {
  const event = {
    id: expenseId,
    timestamp: new Date()
  };

  // Emit to roles with financial permission
  safeEmit(io, 'role:admin', 'expense:deleted', event);
  safeEmit(io, 'role:manager', 'expense:deleted', event);
  safeEmit(io, 'role:accountant', 'expense:deleted', event);
}

export function emitTransactionDeposited(io: SocketServer, transactionIds: string[], depositReference?: string) {
  const event = {
    transactionIds,
    depositReference,
    timestamp: new Date()
  };

  // Emit to roles with financial permission
  safeEmit(io, 'role:admin', 'transaction:deposited', event);
  safeEmit(io, 'role:manager', 'transaction:deposited', event);
  safeEmit(io, 'role:accountant', 'transaction:deposited', event);
}

export function emitTransactionReconciled(io: SocketServer, transaction: any) {
  // Emit to roles with financial permission
  safeEmit(io, 'role:admin', 'transaction:reconciled', transaction);
  safeEmit(io, 'role:manager', 'transaction:reconciled', transaction);
  safeEmit(io, 'role:accountant', 'transaction:reconciled', transaction);
}
