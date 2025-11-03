import { Request } from 'express';
import { UserRole } from '@prisma/client';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    email: string;
    role: UserRole;
  };
}

export interface JWTPayload {
  id: number;
  email: string;
  role: UserRole;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface FilterParams {
  search?: string;
  status?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  area?: string;
  customerRepId?: number;
  deliveryAgentId?: number;
}

export interface WorkflowAction {
  type: string;
  config: Record<string, any>;
  nextAction?: string;
}

export interface WebhookPayload {
  signature: string;
  timestamp: number;
  data: Record<string, any>;
}

export interface SocketEvents {
  ORDER_CREATED: 'order:created';
  ORDER_UPDATED: 'order:updated';
  ORDER_STATUS_CHANGED: 'order:status_changed';
  ORDER_ASSIGNED: 'order:assigned';
  DELIVERY_UPDATED: 'delivery:updated';
  NOTIFICATION: 'notification';
}

export interface DashboardMetrics {
  totalOrders: number;
  pendingOrders: number;
  deliveredOrders: number;
  totalRevenue: number;
  codCollected: number;
  activeAgents: number;
  avgDeliveryTime: number;
}

export interface PerformanceMetrics {
  userId: number;
  userName: string;
  totalAssigned: number;
  completed: number;
  pending: number;
  successRate: number;
  avgResponseTime?: number;
}
