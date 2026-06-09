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
    productType?: 'physical' | 'digital';
  };
  formType?: 'physical' | 'digital';
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
    originalPrice?: number;
    discountType?: 'none' | 'percentage' | 'fixed';
    discountValue?: number;
  }>;
  country: string;
  currency: string;
  regions: any;
  design?: {
    colors?: {
      primary?: string;
      cta?: string;
      surface?: string;
      text?: string;
    };
    button?: {
      shape?: 'square' | 'rounded' | 'pill';
      size?: 'sm' | 'md' | 'lg';
      label?: string;
    };
    input?: {
      style?: 'flat' | 'outlined' | 'filled';
      labelColor?: string;
      priceColor?: string;
    };
    page?: {
      background?: string;
      productBanner?: string;
      hideProductDisplay?: boolean;
      showOrderSummary?: boolean;
      offerPosition?: 'top' | 'bottom';
    };
  };
  pixelConfig?: {
    facebookPixelId?: string;
    googleAnalyticsId?: string;
    tiktokPixelId?: string;
    googleTagManagerId?: string;
  };
  redirectUrl?: string; // Custom thank-you page; overrides the built-in success screen
  // Payment-method matrix (MAN-58). Drives which CTA buttons the form renders.
  codEnabled?: boolean;
  paystackDepositEnabled?: boolean;
  paystackFullEnabled?: boolean;
  depositPercent?: number | null;
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
  authorization_url?: string;
  paymentReference?: string;
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

  async verifyPayment(reference: string, orderId?: string): Promise<{ success: boolean; paymentStatus: string; order?: any }> {
    const url = orderId
      ? `/api/paystack/verify/${reference}?orderId=${encodeURIComponent(orderId)}`
      : `/api/paystack/verify/${reference}`;
    const response = await publicClient.get(url);
    return response.data;
  },

  async trackOrder(orderId: string, phoneNumber: string): Promise<OrderTrackingInfo> {
    const response = await publicClient.post('/api/public/orders/track', {
      orderId,
      phoneNumber,
    });
    return response.data.order || response.data;
  },
};
