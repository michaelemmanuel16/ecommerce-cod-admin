import apiClient from './api';
import { InventoryShipment, CreateShipmentPayload } from '../types';

export const shipmentsService = {
  async listShipments(status?: string): Promise<InventoryShipment[]> {
    const params = status ? { status } : {};
    const response = await apiClient.get('/api/products/shipments', { params });
    return response.data;
  },

  async createShipment(data: CreateShipmentPayload): Promise<InventoryShipment> {
    const response = await apiClient.post('/api/products/shipments', data);
    return response.data;
  },

  async updateShipment(id: number, data: Partial<CreateShipmentPayload>): Promise<InventoryShipment> {
    const response = await apiClient.patch(`/api/products/shipments/${id}`, data);
    return response.data;
  },

  async markArrived(id: number): Promise<InventoryShipment> {
    const response = await apiClient.patch(`/api/products/shipments/${id}/arrive`);
    return response.data;
  },

  async deleteShipment(id: number): Promise<void> {
    await apiClient.delete(`/api/products/shipments/${id}`);
  },
};
