import apiClient from './api';

export interface AgentStockItem {
  agentId: number;
  agentName: string;
  email: string;
  phoneNumber: string | null;
  quantity: number;
  totalAllocated: number;
  totalInTransit: number;
  totalFulfilled: number;
  totalReturned: number;
  totalTransferIn: number;
  totalTransferOut: number;
  value: number;
}

export interface ProductAgentStockResponse {
  product: { id: number; name: string; sku: string; price: number };
  agents: AgentStockItem[];
  totalWithAgents: number;
  totalValue: number;
}

export interface AgentInventoryItem {
  productId: number;
  productName: string;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  totalAllocated: number;
  totalInTransit: number;
  totalFulfilled: number;
  totalReturned: number;
  totalTransferIn: number;
  totalTransferOut: number;
  unitPrice: number;
  value: number;
}

export interface AgentInventoryResponse {
  agent: { id: number; name: string };
  items: AgentInventoryItem[];
  totalValue: number;
}

export interface InventoryTransfer {
  id: number;
  productId: number;
  quantity: number;
  transferType: string;
  fromAgentId: number | null;
  toAgentId: number | null;
  orderId: number | null;
  notes: string | null;
  createdById: number;
  createdAt: string;
  product: { id: number; name: string; sku: string };
  fromAgent: { id: number; firstName: string; lastName: string } | null;
  toAgent: { id: number; firstName: string; lastName: string } | null;
  order: { id: number; status: string } | null;
  createdBy: { id: number; firstName: string; lastName: string };
}

export interface TransferHistoryResponse {
  transfers: InventoryTransfer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InventorySummaryResponse {
  agents: Array<{
    agentId: number;
    name: string;
    items: number;
    totalQuantity: number;
    totalValue: number;
  }>;
  totalAgents: number;
  totalQuantity: number;
  totalValue: number;
}

export const agentInventoryService = {
  async allocateStock(data: {
    productId: number;
    agentId: number;
    quantity: number;
    notes?: string;
  }): Promise<InventoryTransfer> {
    const response = await apiClient.post('/api/agent-inventory/allocate', data);
    return response.data;
  },

  async transferStock(data: {
    productId: number;
    fromAgentId: number;
    toAgentId: number;
    quantity: number;
    notes?: string;
  }): Promise<InventoryTransfer> {
    const response = await apiClient.post('/api/agent-inventory/transfer', data);
    return response.data;
  },

  async returnStock(data: {
    productId: number;
    agentId: number;
    quantity: number;
    notes?: string;
  }): Promise<InventoryTransfer> {
    const response = await apiClient.post('/api/agent-inventory/return', data);
    return response.data;
  },

  async adjustStock(data: {
    productId: number;
    agentId: number;
    newQuantity: number;
    notes: string;
  }): Promise<InventoryTransfer> {
    const response = await apiClient.post('/api/agent-inventory/adjust', data);
    return response.data;
  },

  async getProductAgentStock(productId: number): Promise<ProductAgentStockResponse> {
    const response = await apiClient.get(`/api/agent-inventory/product/${productId}`);
    return response.data;
  },

  async getAgentInventory(agentId: number): Promise<AgentInventoryResponse> {
    const response = await apiClient.get(`/api/agent-inventory/agent/${agentId}`);
    return response.data;
  },

  async getTransferHistory(params?: {
    productId?: number;
    agentId?: number;
    type?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Promise<TransferHistoryResponse> {
    const response = await apiClient.get('/api/agent-inventory/transfers', { params });
    return response.data;
  },

  async getSummary(): Promise<InventorySummaryResponse> {
    const response = await apiClient.get('/api/agent-inventory/summary');
    return response.data;
  },
};
