import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Public client WITHOUT auth interceptors
export const publicClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface PublicCheckoutForm {
  id: number;
  productId: number;
  product?: {
    id: number;
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
    isActive: boolean;
  };
  name: string;
  slug: string;
  description?: string;
  fields: any[];
  packages: Array<{
    id: number;
    name: string;
    price: number;
    quantity: number;
    discountType?: 'none' | 'percentage' | 'fixed';
    discountValue?: number;
    originalPrice?: number;
    isPopular: boolean;
    isDefault?: boolean;
    showHighlight?: boolean;
    highlightText?: string;
    showDiscount?: boolean;
  }>;
  upsells: Array<{
    id: number;
    name: string;
    description?: string;
    imageUrl?: string;
    price: number;
    items?: { quantity: number };
    isPopular: boolean;
  }>;
  country: string;
  currency: string;
  regions: any;
  styling?: {
    buttonColor: string;
    accentColor: string;
  };
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicOrderData {
  customerInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phoneNumber: string;
    alternatePhone?: string;
  };
  shippingAddress: {
    address: string;
    state: string;
    zipCode: string;
    country?: string;
  };
  items: Array<{
    productId: number;
    quantity: number;
    unitPrice: number;
  }>;
  notes?: string;
  customFields?: Record<string, any>;
}

export interface PublicOrderResponse {
  success: boolean;
  orderId: number;
  message: string;
  order: {
    id: number;
    totalAmount: number;
    status: string;
  };
  trackingUrl?: string;
}

export interface OrderTrackingInfo {
  orderNumber: string;
  status: string;
  statusHistory: Array<{
    status: string;
    timestamp: string;
    notes?: string;
  }>;
  estimatedDelivery?: string;
  customer: {
    firstName: string;
    lastName: string;
  };
  totalAmount: number;
  items: Array<{
    productName: string;
    quantity: number;
    price: number;
  }>;
  shippingAddress: {
    address: string;
    state: string;
    zipCode: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const publicOrdersService = {
  async getPublicForm(slug: string): Promise<PublicCheckoutForm> {
    const response = await publicClient.get(`/api/public/forms/${slug}`);
    return response.data.form || response.data;
  },

  async submitOrder(slug: string, orderData: PublicOrderData): Promise<PublicOrderResponse> {
    const response = await publicClient.post(`/api/public/forms/${slug}/orders`, orderData);
    return response.data;
  },

  async trackOrder(orderNumber: string, phoneNumber: string): Promise<OrderTrackingInfo> {
    const response = await publicClient.get('/api/public/orders/track', {
      params: { orderNumber, phoneNumber },
    });
    return response.data.order || response.data;
  },
};
