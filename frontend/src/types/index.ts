export interface UserPreferences {
  ordersDefaultView?: 'kanban' | 'list';
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string;
}

export type Resource = 'users' | 'orders' | 'customers' | 'products' | 'financial' | 'analytics' | 'workflows' | 'settings';
export type Action = 'create' | 'view' | 'update' | 'delete' | 'bulk_import' | 'assign' | 'update_stock' | 'execute';

export type Permissions = Record<string, string[]> | string[];

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'super_admin' | 'admin' | 'manager' | 'sales_rep' | 'inventory_manager' | 'delivery_agent' | 'accountant' | 'customer_rep';
  avatar?: string;
  preferences?: UserPreferences;
  commissionAmount?: number;
  deliveryRate?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  role: string;
}

export type OrderStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'failed_delivery';

export type OrderPriority = 'low' | 'medium' | 'high' | 'urgent';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface OrderItem {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  total: number;
  itemType?: 'package' | 'upsell';
  metadata?: {
    packageName?: string;
    upsellName?: string;
    upsellDescription?: string;
    originalPrice?: number;
    discountType?: string;
    discountValue?: number;
  };
}

export interface ShippingAddress {
  street: string;
  state: string;
  area: string;
  country?: string;
  phone: string;
}

export interface Order {
  id: number;
  orderNumber?: string; // Optional - may come from backend
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  priority: OrderPriority;
  paymentStatus: PaymentStatus;
  paymentMethod: 'cod' | 'card' | 'upi';
  shippingAddress: ShippingAddress;
  notes?: string;
  assignedTo?: number;
  assignedToName?: string;
  customerRep?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  };
  deliveryAgent?: {
    id: number;
    firstName: string;
    lastName: string;
    phoneNumber: string;
    role: string;
  };
  createdAt: string;
  updatedAt: string;
  estimatedDelivery?: string;
}

export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  alternatePhone?: string;
  address?: ShippingAddress;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  cogs: number;
  stock: number;
  stockQuantity?: number; // Backend uses stockQuantity
  category: string;
  imageUrl?: string;
  sku: string;
  isActive: boolean;
  lowStockThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: number;
  type: 'order:created' | 'order:updated' | 'order:status_changed' | 'system';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  data?: any;
}

export interface KPIStats {
  totalOrders: number;
  totalRevenue: number;
  activeOrders: number;
  deliveredToday: number;
  ordersTrend: number;
  revenueTrend: number;
  activeOrdersTrend: number;
  deliveredTrend: number;
}

export interface ChartDataPoint {
  date: string;
  value: number;
  label?: string;
}

export interface OrdersByStatus {
  status: OrderStatus;
  count: number;
  revenue: number;
}

export interface WorkflowNode {
  id: string;
  type: 'trigger' | 'action' | 'condition';
  data: {
    label: string;
    config: Record<string, any>;
  };
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface FilterOptions {
  status?: OrderStatus[];
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
  customerId?: number;
  customerRepId?: number;
  deliveryAgentId?: number;
  area?: string;
  format?: 'csv' | 'xlsx';
}

export enum CallOutcome {
  CONFIRMED = 'confirmed',
  RESCHEDULED = 'rescheduled',
  NO_ANSWER = 'no_answer',
  CANCELLED = 'cancelled',
  OTHER = 'other'
}

export interface Call {
  id: number;
  orderId?: number;
  customerId: number;
  salesRepId: number;
  outcome: CallOutcome;
  duration?: number;
  notes?: string;
  createdAt: string;
  customer: {
    id: number;
    firstName: string;
    lastName: string;
    phoneNumber: string;
  };
  salesRep: {
    id: number;
    firstName: string;
    lastName: string;
  };
  order?: {
    id: number;
    status: string;
  };
}

export interface CallStats {
  repId: number;
  repName: string;
  totalCalls: number;
  todayCalls: number;
  weekCalls: number;
  monthCalls: number;
  avgCallsPerDay: number;
  avgDuration: number;
  outcomeBreakdown: {
    confirmed: number;
    rescheduled: number;
    no_answer: number;
    cancelled: number;
    other: number;
  };
  timeline: Array<{
    date: string;
    calls: number;
  }>;
}

// Re-export checkout form types
export * from './checkout-form';

// Re-export webhook types
export * from './webhook';
