import apiClient from './api';

export interface DeliveryListItem {
  id: number;
  orderId: number;
  agentId: number | null;
  scheduledTime: string | null;
  actualDeliveryTime: string | null;
  deliveryAttempts: number;
  proofType: string | null;
  proofData: string | null;
  proofImageUrl: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  order: {
    id: number;
    status: string;
    totalAmount: number;
    paymentStatus: string;
    deliveryAddress: string;
    deliveryState: string;
    deliveryArea: string;
    notes: string | null;
    customer: {
      firstName: string;
      lastName: string;
      phoneNumber: string;
    } | null;
    // Only included in detail endpoint
    orderItems?: Array<{
      id: number;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      product: {
        id: number;
        name: string;
      };
    }>;
  };
  agent: {
    id: number;
    firstName: string;
    lastName: string;
    phoneNumber: string | null;
  } | null;
}

export interface CompleteDeliveryPayload {
  codAmount: number;
  proofType: string;
  proofData: string;
  recipientName: string;
}

export interface DeliveryPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface DeliveryFilters {
  agentId?: string | number;
  status?: string;
  page?: number;
  limit?: number;
}

export function formatDeliveryAddress(order: DeliveryListItem['order'] | null | undefined): string {
  if (!order) return 'No address';
  return [order.deliveryAddress, order.deliveryArea, order.deliveryState].filter(Boolean).join(', ');
}

export const deliveriesService = {
  async getDeliveries(filters?: DeliveryFilters): Promise<{ deliveries: DeliveryListItem[]; pagination: DeliveryPagination }> {
    const params = new URLSearchParams();
    if (filters?.agentId) params.set('agentId', String(filters.agentId));
    if (filters?.status) params.set('status', filters.status);
    if (filters?.page) params.set('page', String(filters.page));
    if (filters?.limit) params.set('limit', String(filters.limit));
    const response = await apiClient.get(`/api/deliveries?${params.toString()}`);
    return response.data;
  },

  async getDeliveryById(id: string | number): Promise<DeliveryListItem> {
    const response = await apiClient.get(`/api/deliveries/${id}`);
    return response.data.delivery || response.data;
  },

  async getAgentRoute(agentId: string | number, date?: string): Promise<{ route: DeliveryListItem[] }> {
    const params = date ? `?date=${date}` : '';
    const response = await apiClient.get(`/api/deliveries/routes/${agentId}${params}`);
    return response.data;
  },

  async uploadProof(id: string | number, payload: { proofType: string; proofData: string; recipientName: string; recipientPhone?: string }): Promise<DeliveryListItem> {
    const response = await apiClient.patch(`/api/deliveries/${id}/proof`, payload);
    return response.data.delivery || response.data;
  },

  async completeDelivery(id: string | number, payload: CompleteDeliveryPayload): Promise<{ message: string; glEntry?: unknown }> {
    const response = await apiClient.patch(`/api/deliveries/${id}/complete`, payload);
    return response.data;
  },

  async uploadImage(file: File): Promise<{ imageUrl: string }> {
    const formData = new FormData();
    formData.append('image', file);
    const response = await apiClient.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },
};
