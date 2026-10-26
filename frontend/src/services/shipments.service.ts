import apiClient from './api';

/** The shipments API (backend shipmentRoutes.ts, M4-T11/T12). The api client turns money strings into numbers (utils/money). */

export type ShipmentStatus = 'pending' | 'arrived' | 'received';
export type ClaimStatus = 'none' | 'open' | 'settled' | 'written_off';
export type CountSource = 'own_count' | 'three_pl_dashboard' | 'agent_count';

export interface Shipment {
  id: number;
  productId: number;
  supplier: string | null;
  quantity: number;
  /** In the shipment currency. */
  unitCost: number;
  shippingCost: number;
  customsDuties: number | string;
  otherCosts: number;
  totalCost: number;
  /** Effective currency of the amounts above (the store currency when none was set). */
  currency: string;
  storeCurrency: string;
  fxRate: number | null;
  fxRateSource: 'auto' | 'manual' | null;
  /** The total in the store currency: stored once received, else the total at the stored rate. */
  totalCostStore: number;
  /** Stored once received; before that the total in store currency over the units shipped. */
  landedCostPerUnit: number | null;
  status: ShipmentStatus;
  expectedArrivalDate: string | null;
  receivedAt: string | null;
  quantityCounted: number | null;
  shortQuantity: number | null;
  destinationLocation: { id: number; name: string; type: string } | null;
  claimStatus: ClaimStatus;
  claimAmount: number;
  claimRecovered: number | string | null;
  claimNote: string | null;
  claimJournalEntryId: number | null;
  notes: string | null;
  product: { id: number; name: string; sku: string };
}

export interface ShipmentSummary {
  pendingCount: number;
  unitsOnTheWay: number;
  costToLand: number;
  currency: string;
}

export interface ShipmentPayload {
  productId?: number;
  supplier?: string;
  quantity: number;
  unitCost: number;
  shippingCost: number;
  customsDuties: number;
  otherCosts: number;
  currency?: string;
  /** A typed rate: store currency per 1 unit of the shipment currency. Leave out to use the stored rate of the day. */
  fxRate?: number;
  expectedArrivalDate?: string | null;
  notes?: string;
}

export interface ReceivePayload {
  locationId: number;
  receivedAt: string;
  quantityCounted: number;
  countSource: CountSource;
  note?: string;
  fxRate?: number;
}

export type ClaimPayload = { action: 'settle'; amountRecovered: number } | { action: 'write_off'; note?: string };

export const shipmentsService = {
  async list(status?: 'pending' | 'received', skipCache = false): Promise<Shipment[]> {
    const response = await apiClient.get('/api/shipments', { params: status ? { status } : {}, skipCache, quiet: true });
    return response.data;
  },

  async summary(skipCache = false): Promise<ShipmentSummary> {
    const response = await apiClient.get('/api/shipments/summary', { skipCache, quiet: true });
    return response.data;
  },

  async create(data: ShipmentPayload): Promise<Shipment> {
    const response = await apiClient.post('/api/shipments', data, { quiet: true });
    return response.data;
  },

  async update(id: number, data: Partial<ShipmentPayload>): Promise<Shipment> {
    const response = await apiClient.patch(`/api/shipments/${id}`, data, { quiet: true });
    return response.data;
  },

  async remove(id: number): Promise<void> {
    await apiClient.delete(`/api/shipments/${id}`, { quiet: true });
  },

  async receive(id: number, data: ReceivePayload): Promise<Shipment> {
    const response = await apiClient.post(`/api/shipments/${id}/receive`, data, { quiet: true });
    return response.data;
  },

  async claim(id: number, data: ClaimPayload): Promise<Shipment> {
    const response = await apiClient.post(`/api/shipments/${id}/claim`, data, { quiet: true });
    return response.data;
  },
};
