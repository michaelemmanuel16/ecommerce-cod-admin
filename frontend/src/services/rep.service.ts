import apiClient from './api';
import type { DeclineReason, FailureReason, OrderStatus } from '../types';

export interface CallCardOrder {
  id: number;
  status: OrderStatus;
  totalAmount: string | number;
  subtotal: string | number;
  deliveryFee: string | number | null;
  customerRepId: number | null;
  deliveryAgentId: number | null;
  deliveryAgent: { id: number; name: string; phoneNumber?: string } | null;
  customerRep: { id: number; name: string } | null;
  createdAt: string;
  updatedAt: string;
  firstContactAt: string | null;
  saidNo: boolean;
  customerResponse: string | null;
  requiresManualCall: boolean;
  notes: string | null;
  declineReason: DeclineReason | null;
  failureReason: FailureReason | null;
  statusVersion: number;
}

export interface CallCardCustomerPreviousOrder {
  id: number;
  createdAt: string;
  totalAmount: string | number;
  status: string;
}

export interface CallCardCustomer {
  id: number;
  firstName: string;
  lastName: string;
  name: string;
  phoneNumber: string;
  alternatePhone: string | null;
  email: string | null;
  address: string | null;
  area: string;
  state: string;
  riskLevel: string;
  refusedOrders: number;
  deliveredOrders: number;
  codBlocked: boolean;
  wrongNumber: boolean;
  previousOrders: CallCardCustomerPreviousOrder[];
}

export interface CallCardItem {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: string | number;
  totalPrice: string | number;
}

export interface CallCardPackageTier {
  id: number;
  name: string;
  price: string | number;
  description?: string | null;
  unitsCount?: number;
  isPopular?: boolean;
  isDefault?: boolean;
  extraValueFromBase?: string | number;
}

export interface CallCardAddon {
  id: number;
  name: string;
  price: string | number;
  productId?: number | null;
  isActive?: boolean;
}

export interface CallCardPackages {
  orderId: number;
  currentPackage: {
    id: number | null;
    name: string | null;
    price: string | number;
  };
  availablePackages: CallCardPackageTier[];
  availableAddons: CallCardAddon[];
}

export interface CallCardCallHistory {
  id: number;
  outcome: string;
  duration: number | null;
  notes: string | null;
  startedAt: string | null;
  callbackAt: string | null;
  declineReason: string | null;
  createdAt: string;
  salesRep: { id: number; name: string } | null;
}

export interface CallCardPay {
  baseCommission: string;
  upsellPercent: number;
}

export interface CallCardData {
  order: CallCardOrder;
  customer: CallCardCustomer;
  items: CallCardItem[];
  packages: CallCardPackages;
  lastCalls: CallCardCallHistory[];
  nextOrderId: number | null;
  pay: CallCardPay;
}

export const repService = {
  async getCallCard(orderId: number): Promise<CallCardData> {
    const response = await apiClient.get(`/api/rep/orders/${orderId}/card`);
    return response.data;
  },
};
