export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'customer_rep' | 'delivery_agent';
  avatar?: string;
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
  | 'new_orders'
  | 'confirmation_pending'
  | 'confirmed'
  | 'being_prepared'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'returned';

export type OrderPriority = 'low' | 'medium' | 'high' | 'urgent';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  total: number;
}

export interface ShippingAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
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
  assignedTo?: string;
  assignedToName?: string;
  createdAt: string;
  updatedAt: string;
  estimatedDelivery?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  address?: ShippingAddress;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
  imageUrl?: string;
  sku: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  type: 'order_created' | 'order_updated' | 'order_status_changed' | 'system';
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
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  createdAt: string;
  updatedAt: string;
}

export interface FilterOptions {
  status?: OrderStatus[];
  priority?: OrderPriority[];
  paymentStatus?: PaymentStatus[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}
