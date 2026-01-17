import { z } from 'zod';

// Auth Schemas
export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  role: z.enum(['admin', 'sales_rep', 'delivery_agent', 'inventory_manager', 'accountant']),
});

// Order Schemas
export const orderItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  productName: z.string().min(1, 'Product name is required'),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  price: z.number().positive('Price must be greater than 0'),
  total: z.number().positive('Total must be greater than 0'),
});

export const shippingAddressSchema = z.object({
  street: z.string().min(5, 'Street address must be at least 5 characters'),
  area: z.string().min(2, 'Area is required'),
  state: z.string().min(2, 'State must be at least 2 characters'),
  country: z.string().min(2, 'Country is required'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
});

export const createOrderSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  shippingAddress: shippingAddressSchema,
  paymentMethod: z.enum(['cod', 'card', 'upi']),
  notes: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

export const updateOrderSchema = z.object({
  status: z.enum([
    'pending_confirmation',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'failed_delivery'
  ]).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  notes: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  estimatedDelivery: z.string().datetime().optional(),
});

// Customer Schemas
export const createCustomerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  address: shippingAddressSchema.optional(),
});

export const updateCustomerSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters').optional(),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').optional(),
  email: z.string().email('Invalid email address').optional(),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format').optional(),
  address: shippingAddressSchema.optional(),
});

// Product Schemas
export const createProductSchema = z.object({
  name: z.string().min(3, 'Product name must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  price: z.number().positive('Price must be greater than 0'),
  stock: z.number().int().nonnegative('Stock cannot be negative'),
  category: z.string().min(2, 'Category is required'),
  sku: z.string().min(3, 'SKU must be at least 3 characters'),
  lowStockThreshold: z.number().int().nonnegative('Threshold cannot be negative').default(10),
  imageUrl: z.string().url('Invalid image URL').optional(),
  isActive: z.boolean().default(true),
});

export const updateProductSchema = z.object({
  name: z.string().min(3, 'Product name must be at least 3 characters').optional(),
  description: z.string().min(10, 'Description must be at least 10 characters').optional(),
  price: z.number().positive('Price must be greater than 0').optional(),
  stock: z.number().int().nonnegative('Stock cannot be negative').optional(),
  category: z.string().min(2, 'Category is required').optional(),
  sku: z.string().min(3, 'SKU must be at least 3 characters').optional(),
  lowStockThreshold: z.number().int().nonnegative('Threshold cannot be negative').optional(),
  imageUrl: z.string().url('Invalid image URL').optional(),
  isActive: z.boolean().optional(),
});

// User Management Schemas
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  role: z.enum([
    'super_admin',
    'admin',
    'manager',
    'sales_rep',
    'inventory_manager',
    'delivery_agent',
    'accountant'
  ]),
  isActive: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  firstName: z.string().min(2, 'First name must be at least 2 characters').optional(),
  lastName: z.string().min(2, 'Last name must be at least 2 characters').optional(),
  phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format').optional(),
  role: z.enum([
    'super_admin',
    'admin',
    'manager',
    'sales_rep',
    'inventory_manager',
    'delivery_agent',
    'accountant'
  ]).optional(),
  isActive: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
});

// Workflow Schemas
export const workflowTriggerSchema = z.object({
  type: z.enum(['webhook', 'status_change', 'time_based', 'manual']),
  config: z.record(z.any()),
});

export const workflowActionSchema = z.object({
  type: z.enum(['send_sms', 'send_email', 'update_order', 'assign_agent', 'add_tag', 'wait', 'http_request']),
  config: z.record(z.any()),
});

export const workflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['trigger', 'action', 'condition']),
  data: z.object({
    label: z.string(),
    config: z.record(z.any()),
  }),
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
});

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(3, 'Workflow name must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  trigger: workflowTriggerSchema,
  actions: z.array(workflowActionSchema).min(1, 'At least one action is required'),
  isActive: z.boolean().default(false),
});

export const updateWorkflowSchema = z.object({
  name: z.string().min(3, 'Workflow name must be at least 3 characters').optional(),
  description: z.string().min(10, 'Description must be at least 10 characters').optional(),
  isActive: z.boolean().optional(),
  nodes: z.array(workflowNodeSchema).optional(),
  edges: z.array(workflowEdgeSchema).optional(),
});

// Financial Schemas
export const recordExpenseSchema = z.object({
  category: z.string().min(2, 'Category is required'),
  amount: z.number().positive('Amount must be greater than 0'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
  expenseDate: z.string().datetime('Invalid date format'),
});

// Filter Schemas
export const orderFilterSchema = z.object({
  status: z.array(z.enum([
    'pending_confirmation',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'failed_delivery'
  ])).optional(),
  priority: z.array(z.enum(['low', 'medium', 'high', 'urgent'])).optional(),
  paymentStatus: z.array(z.enum(['pending', 'paid', 'failed', 'refunded'])).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().optional(),
});

// Type exports for use with react-hook-form
export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
export type CreateOrderFormData = z.infer<typeof createOrderSchema>;
export type UpdateOrderFormData = z.infer<typeof updateOrderSchema>;
export type CreateCustomerFormData = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerFormData = z.infer<typeof updateCustomerSchema>;
export type CreateProductFormData = z.infer<typeof createProductSchema>;
export type UpdateProductFormData = z.infer<typeof updateProductSchema>;
export type CreateUserFormData = z.infer<typeof createUserSchema>;
export type UpdateUserFormData = z.infer<typeof updateUserSchema>;
export type CreateWorkflowFormData = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowFormData = z.infer<typeof updateWorkflowSchema>;
export type RecordExpenseFormData = z.infer<typeof recordExpenseSchema>;
export type OrderFilterFormData = z.infer<typeof orderFilterSchema>;
