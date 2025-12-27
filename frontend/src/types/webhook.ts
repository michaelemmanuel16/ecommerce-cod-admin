/**
 * Webhook-related type definitions
 */

export interface Webhook {
  id: number;
  uniqueUrl: string; // Unique webhook receiving URL (e.g., "abc-123-def-456")
  name: string;
  url: string;
  secret: string;
  apiKey?: string;
  productId?: number; // Foreign key to Product (nullable for backward compat)
  productName?: string; // Product name (populated from relation)
  isActive: boolean;
  fieldMapping: Record<string, string>;
  headers?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  logs?: WebhookLog[];
}

export interface WebhookLog {
  id: number;
  webhookConfigId?: number;
  endpoint: string;
  method: string;
  headers: Record<string, any>;
  body: Record<string, any>;
  response?: Record<string, any>;
  statusCode?: number;
  success: boolean;
  errorMessage?: string;
  processedAt: string;
}

export interface WebhookStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  recentActivity: Array<{
    processedAt: string;
    success: boolean;
  }>;
}

export interface WebhookFormData {
  name: string;
  url: string;
  secret: string;
  apiKey?: string;
  productId: number; // Required: which product this webhook is for
  isActive: boolean;
  fieldMapping: Record<string, string>;
  headers?: Record<string, string>;
}

export interface FieldMapping {
  external: string;
  internal: string;
}

export interface HeaderPair {
  key: string;
  value: string;
}

export interface WebhookTestResult {
  message: string;
  mappedData: Record<string, any>;
  sampleData: Record<string, any>;
}

export interface WebhookProcessResult {
  message: string;
  results: {
    success: number;
    failed: number;
    errors: Array<{
      order: any;
      error: string;
    }>;
  };
}

// Internal field options for field mapping
export interface InternalFieldOption {
  value: string;
  label: string;
  required?: boolean;
  category?: 'customer' | 'delivery' | 'product' | 'order';
}

export const INTERNAL_FIELDS: InternalFieldOption[] = [
  // Customer fields
  { value: 'customerPhone', label: 'Customer Phone *', required: true, category: 'customer' },
  { value: 'customerFirstName', label: 'Customer First Name', category: 'customer' },
  { value: 'customerLastName', label: 'Customer Last Name', category: 'customer' },
  { value: 'customerEmail', label: 'Customer Email', category: 'customer' },

  // Delivery fields
  { value: 'deliveryAddress', label: 'Delivery Address', category: 'delivery' },
  { value: 'deliveryState', label: 'Delivery State', category: 'delivery' },
  { value: 'deliveryArea', label: 'Delivery Area', category: 'delivery' },

  // Product fields (NEW - for product imports)
  { value: 'productName', label: 'Product Name/SKU', category: 'product' },
  { value: 'quantity', label: 'Quantity', category: 'product' },
  { value: 'price', label: 'Unit Price', category: 'product' },
  { value: 'package', label: 'Package Description', category: 'product' },

  // Order fields
  { value: 'subtotal', label: 'Subtotal', category: 'order' },
  { value: 'shippingCost', label: 'Shipping Cost', category: 'order' },
  { value: 'deliveryFee', label: 'Delivery Fee (alias for shipping)', category: 'order' },
  { value: 'totalAmount', label: 'Total Amount', category: 'order' },
  { value: 'notes', label: 'Notes', category: 'order' }
];
