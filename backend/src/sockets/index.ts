import { Server as SocketServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyAccessToken } from '../utils/jwt';
import logger from '../utils/logger';

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
  io.to('role:admin').emit('order:created', order);
  io.to('role:manager').emit('order:created', order);
  io.to('role:sales_rep').emit('order:created', order);
}

export function emitOrderUpdated(io: SocketServer, order: any) {
  io.to(`order:${order.id}`).emit('order:updated', order);

  if (order.customerRepId) {
    io.to(`user:${order.customerRepId}`).emit('order:updated', order);
  }

  if (order.deliveryAgentId) {
    io.to(`user:${order.deliveryAgentId}`).emit('order:updated', order);
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

  io.to(`order:${order.id}`).emit('order:status_changed', event);
  io.to('role:admin').emit('order:status_changed', event);
  io.to('role:manager').emit('order:status_changed', event);

  if (order.customerRepId) {
    io.to(`user:${order.customerRepId}`).emit('order:status_changed', event);
  }

  if (order.deliveryAgentId) {
    io.to(`user:${order.deliveryAgentId}`).emit('order:status_changed', event);
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

  io.to(`user:${userId}`).emit('order:assigned', event);
  io.to(`order:${order.id}`).emit('order:assigned', event);
}

export function emitDeliveryUpdated(io: SocketServer, delivery: any) {
  io.to(`user:${delivery.agentId}`).emit('delivery:updated', delivery);
  io.to(`order:${delivery.orderId}`).emit('delivery:updated', delivery);
}

export function emitNotification(io: SocketServer, userId: string, notification: any) {
  io.to(`user:${userId}`).emit('notification', notification);
}

export function emitPermissionsUpdated(io: SocketServer, updatedRoles: string[]) {
  const event = {
    updatedRoles,
    timestamp: new Date()
  };

  // Emit to all affected roles
  updatedRoles.forEach(role => {
    io.to(`role:${role}`).emit('permissions:updated', event);
  });

  // Also emit to all connected clients (in case they need to refresh)
  io.emit('permissions:updated', event);
}

export function emitCallLogged(io: SocketServer, call: any) {
  // Emit to managers and admins
  io.to('role:admin').emit('call:logged', call);
  io.to('role:manager').emit('call:logged', call);

  // Emit to the sales rep who logged it
  io.to(`user:${call.salesRepId}`).emit('call:logged', call);
}

// Financial event emitters
export function emitExpenseCreated(io: SocketServer, expense: any) {
  // Emit to roles with financial permission
  io.to('role:admin').emit('expense:created', expense);
  io.to('role:manager').emit('expense:created', expense);
  io.to('role:accountant').emit('expense:created', expense);
}

export function emitExpenseUpdated(io: SocketServer, expense: any) {
  // Emit to roles with financial permission
  io.to('role:admin').emit('expense:updated', expense);
  io.to('role:manager').emit('expense:updated', expense);
  io.to('role:accountant').emit('expense:updated', expense);
}

export function emitExpenseDeleted(io: SocketServer, expenseId: string) {
  const event = {
    id: expenseId,
    timestamp: new Date()
  };

  // Emit to roles with financial permission
  io.to('role:admin').emit('expense:deleted', event);
  io.to('role:manager').emit('expense:deleted', event);
  io.to('role:accountant').emit('expense:deleted', event);
}

export function emitTransactionDeposited(io: SocketServer, transactionIds: string[], depositReference?: string) {
  const event = {
    transactionIds,
    depositReference,
    timestamp: new Date()
  };

  // Emit to roles with financial permission
  io.to('role:admin').emit('transaction:deposited', event);
  io.to('role:manager').emit('transaction:deposited', event);
  io.to('role:accountant').emit('transaction:deposited', event);
}

export function emitTransactionReconciled(io: SocketServer, transaction: any) {
  // Emit to roles with financial permission
  io.to('role:admin').emit('transaction:reconciled', transaction);
  io.to('role:manager').emit('transaction:reconciled', transaction);
  io.to('role:accountant').emit('transaction:reconciled', transaction);
}
