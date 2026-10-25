import apiClient from './api';

/** The Inventory page API (backend inventoryRoutes.ts, M4-T09 to T15). Quantities are whole numbers; no money is sent to this page. */

export type StockLocationType = 'own_store' | 'partner_3pl' | 'agent';
export type CountSource = 'own_count' | 'three_pl_dashboard' | 'agent_count';
export type TransferType =
  | 'allocation' | 'order_fulfillment' | 'agent_transfer' | 'return_to_warehouse' | 'adjustment'
  | 'receipt' | 'opening' | 'order_reversal' | 'count_adjustment';
export type TransferStatus = 'in_transit' | 'received' | 'disputed' | 'cancelled';
export type TransferReason =
  | 'short_in_package' | 'damaged' | 'not_received' | 'failed_deliveries' | 'customer_refused' | 'agent_stopped_delivering'
  | 'physical_count_correction' | 'lost_or_stolen' | 'found_extra_stock' | 'short_on_arrival' | 'other';
export type DisputeReason = 'short_in_package' | 'damaged' | 'not_received';
export type ReturnReason = 'failed_deliveries' | 'customer_refused' | 'damaged' | 'agent_stopped_delivering' | 'other';
export type AdjustReason = 'physical_count_correction' | 'damaged' | 'lost_or_stolen' | 'found_extra_stock' | 'other';
export type CountReason = AdjustReason | 'short_on_arrival';

export interface LatestCount {
  countId: number;
  date: string;
  source: CountSource;
  unitsOff: number;
  /** Stock moved after the count: the card says "Count is old" instead of a gap. */
  isOld: boolean;
}

export interface LocationCard {
  id: number;
  name: string;
  type: StockLocationType;
  address: string | null;
  userId: number | null;
  onHand: number;
  reserved: number;
  products: number;
  inTransit: number;
  latestCount: LatestCount | null;
}

export interface CountCompare {
  countId: number;
  lineId: number;
  date: string;
  source: CountSource;
  counted: number;
  /** Our records minus the count. null when the count is old. */
  difference: number | null;
  status: 'matches' | 'off' | 'old';
}

export interface StockRow {
  locationId: number;
  locationName: string;
  locationType: StockLocationType;
  locationActive: boolean;
  productId: number;
  productName: string;
  sku: string;
  archived: boolean;
  onHand: number;
  reserved: number;
  inTransit: number;
  count: CountCompare | null;
}

export interface Overview {
  hasOwnStore: boolean;
  locations: LocationCard[];
  stockByLocation: StockRow[];
}

export interface TransferPlace {
  id: number;
  name: string;
  type: StockLocationType | 'in_transit';
}

export interface Transfer {
  id: number;
  productId: number;
  quantity: number;
  transferType: TransferType;
  status: TransferStatus;
  receivedQuantity: number | null;
  receivedAt: string | null;
  reason: TransferReason | null;
  notes: string | null;
  orderId: number | null;
  shipmentId: number | null;
  createdAt: string;
  reversedAt: string | null;
  product: { id: number; name: string; sku: string };
  fromLocation: TransferPlace | null;
  toLocation: TransferPlace | null;
  createdBy: { id: number; firstName: string; lastName: string };
  shortQuantity: number;
  overdue: boolean;
}

export interface TransferList {
  transfers: Transfer[];
  /** Only with `includeCounts`. */
  typeCounts?: Partial<Record<TransferType, number>>;
  /** `total` and `pages` only with `includeCounts`. */
  pagination: { page: number; limit: number; total?: number; pages?: number };
}

export interface TransferFilters {
  type?: TransferType;
  status?: TransferStatus;
  locationId?: number;
  productId?: number;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  /** Ask for the total and the per-type counts (the history modal). Recent transfers and the agent screen leave it out. */
  includeCounts?: boolean;
}

export interface TrailRow {
  id: number;
  action: string;
  at: string;
  by: { id: number; firstName: string; lastName: string } | null;
  details: Record<string, unknown> | null;
}

export interface StockLevelRow {
  locationId: number;
  locationName: string;
  locationType: StockLocationType;
  productId: number;
  productName: string;
  sku: string;
  onHand: number;
  reserved: number;
  inTransit: number;
}

export interface PhysicalProduct {
  id: number;
  name: string;
  sku: string;
}

export interface LowStockProduct extends PhysicalProduct {
  onHandTotal: number | null;
  daysOfCover: number | null;
  lowStockDaysEffective: number | null;
}

export interface CountLine {
  id: number;
  productId: number;
  systemQuantity: number;
  countedQuantity: number;
  difference: number;
  applied: boolean;
  product: PhysicalProduct;
  finding: { id: number; status: string } | null;
}

export interface StockCount {
  id: number;
  locationId: number;
  countDate: string;
  source: CountSource;
  note: string | null;
  location: { id: number; name: string; type: StockLocationType };
  lines: CountLine[];
}

export interface NewTransfer {
  type: 'allocation' | 'agent_transfer' | 'return_to_warehouse';
  productId: number;
  quantity: number;
  fromLocationId: number;
  toLocationId: number;
  reason?: ReturnReason;
  note?: string;
}

export interface NewAdjustment {
  locationId: number;
  productId: number;
  newQuantity: number;
  reason: AdjustReason;
  note?: string;
}

export interface NewCount {
  locationId: number;
  countDate: string;
  source: CountSource;
  note?: string;
  lines: Array<{ productId: number; countedQuantity: number }>;
}

/** A received shipment, the part the "Short on arrival" pick reads. */
export interface ReceivedShipment {
  id: number;
  productId: number;
  quantity: number;
  quantityCounted: number | null;
  shortQuantity: number | null;
  receivedAt: string | null;
  destinationLocationId: number | null;
}

const clean = <T extends object>(params: T): Partial<T> =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')) as Partial<T>;

export const inventoryService = {
  async overview(skipCache = false): Promise<Overview> {
    const res = await apiClient.get('/api/inventory/overview', { skipCache, quiet: true });
    return res.data;
  },

  async transfers(filters: TransferFilters, skipCache = false): Promise<TransferList> {
    const res = await apiClient.get('/api/inventory/transfers', { params: clean(filters), skipCache, quiet: true });
    return res.data;
  },

  /** The CSV the server builds for the same filters as the list (owner, admin, finance clerk). */
  async exportCsv(filters: TransferFilters): Promise<Blob> {
    const { page: _p, limit: _l, includeCounts: _c, ...rest } = filters;
    const res = await apiClient.get('/api/inventory/transfers/export.csv', { params: clean(rest), responseType: 'blob', skipCache: true, quiet: true });
    return res.data;
  },

  async trail(transferId: number): Promise<TrailRow[]> {
    const res = await apiClient.get(`/api/inventory/transfers/${transferId}/trail`, { skipCache: true, quiet: true });
    return res.data.trail;
  },

  /** The agent's own rows (the server forces the filter for a delivery agent). */
  async levels(skipCache = false): Promise<StockLevelRow[]> {
    const res = await apiClient.get('/api/inventory/levels', { skipCache, quiet: true });
    return res.data.levels;
  },

  async createOwnStore(body: { name: string; address?: string }): Promise<{ id: number; name: string }> {
    const res = await apiClient.post('/api/inventory/locations', body);
    return res.data.location;
  },

  async createTransfer(body: NewTransfer): Promise<Transfer> {
    const res = await apiClient.post('/api/inventory/transfers', body);
    return res.data.transfer;
  },

  async receive(id: number, body: { quantity?: number; reason?: DisputeReason }): Promise<Transfer> {
    const res = await apiClient.post(`/api/inventory/transfers/${id}/receive`, body);
    return res.data.transfer;
  },

  async resolve(id: number, body: { action: 'return_to_source' | 'write_off'; note?: string }): Promise<Transfer> {
    const res = await apiClient.post(`/api/inventory/transfers/${id}/resolve`, body);
    return res.data.transfer;
  },

  async cancel(id: number): Promise<Transfer> {
    const res = await apiClient.post(`/api/inventory/transfers/${id}/cancel`);
    return res.data.transfer;
  },

  async adjust(body: NewAdjustment): Promise<{ previousQuantity: number; newQuantity: number; warning?: string }> {
    const res = await apiClient.post('/api/inventory/adjust', body);
    return res.data;
  },

  async createCount(body: NewCount): Promise<StockCount> {
    const res = await apiClient.post('/api/inventory/counts', body);
    return res.data.count;
  },

  async applyCountLine(countId: number, lineId: number, body: { reason: CountReason; shipmentId?: number; note?: string }): Promise<{ count: StockCount; onHand: number; warning?: string }> {
    const res = await apiClient.post(`/api/inventory/counts/${countId}/lines/${lineId}/apply`, body);
    return res.data;
  },

  /** Every physical product, for the pickers in the stock modals and the count sheet. The server filters and does not page. */
  async products(): Promise<PhysicalProduct[]> {
    const res = await apiClient.get('/api/inventory/products', { quiet: true });
    return res.data.products ?? [];
  },

  async lowStock(): Promise<LowStockProduct[]> {
    const res = await apiClient.get('/api/products/low-stock', { quiet: true, skipCache: true });
    return res.data.products ?? [];
  },

  async receivedShipments(productId: number): Promise<ReceivedShipment[]> {
    const res = await apiClient.get('/api/shipments', { params: { status: 'received', productId }, quiet: true });
    return res.data;
  },
};
