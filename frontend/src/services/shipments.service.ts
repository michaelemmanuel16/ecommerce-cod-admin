import apiClient from './api';
import { InventoryShipment, CreateShipmentPayload } from '../types';

export const shipmentsService = {
  async listShipments(status?: string): Promise<InventoryShipment[]> {
    const params = status ? { status } : {};
    const response = await apiClient.get('/api/shipments', { params });
    return response.data;
  },

  async createShipment(data: CreateShipmentPayload): Promise<InventoryShipment> {
    const response = await apiClient.post('/api/shipments', data);
    return response.data;
  },

  async updateShipment(id: number, data: Partial<CreateShipmentPayload>): Promise<InventoryShipment> {
    const response = await apiClient.patch(`/api/shipments/${id}`, data);
    return response.data;
  },

  async markArrived(id: number): Promise<InventoryShipment> {
    const response = await apiClient.patch(`/api/shipments/${id}/arrive`);
    return response.data;
  },

  async deleteShipment(id: number): Promise<void> {
    await apiClient.delete(`/api/shipments/${id}`);
  },
};
