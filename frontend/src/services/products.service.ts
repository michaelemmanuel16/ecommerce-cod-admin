import apiClient from './api';
import { Product } from '../types';

/** The Products page API (backend productRoutes.ts, inventoryRoutes.ts). The api client turns money strings into numbers (utils/money). */

export type ProductTab = 'active' | 'archived' | 'all';
export type ProductStatus = 'archived' | 'digital' | 'out_of_stock' | 'low_stock' | 'active';

/** One row of GET /api/products. `cogs` and `marginPct` are absent for a role that may not see cost. */
export interface ProductRow {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  price: number;
  cogs?: number | null;
  marginPct?: number | null;
  imageUrl: string | null;
  isActive: boolean;
  productType: 'physical' | 'digital';
  lowStockDays: number | null;
  digitalFileUrl: string | null;
  digitalFileType: string | null;
  downloadLinkExpiryHours: number | null;
  maxDownloads: number | null;
  onHandTotal: number | null;
  reservedTotal: number | null;
  daysOfCover: number | null;
  lowStockDaysEffective: number | null;
  deliveredInPeriod: number;
  deliverySuccess: number | null;
  status: ProductStatus;
}

export interface ProductList {
  products: ProductRow[];
  counts: { active: number; archived: number; all: number };
  month: string;
  pagination: { page: number; limit: number; total: number; pages: number };
  /** The signed-in role may see cost and margin (the API sends them only then). */
  canSeeCost: boolean;
}

export interface ProductsSummary {
  month: string;
  activeProducts: { active: number; archived: number };
  bestSeller: { productId: number; name: string; sku: string; units: number } | null;
  averageMargin: number | null;
  lowStock: number;
  /** Delivery success target in percent (the tenant setting, 60 by default). */
  deliverySuccessTarget: number;
}

export interface HolderCount {
  countId: number;
  lineId: number;
  date: string;
  source: 'own_count' | 'three_pl_dashboard' | 'agent_count';
  counted: number;
  /** Our records minus the count. Null when stock moved after the count ("old"). */
  difference: number | null;
  status: 'matches' | 'off' | 'old';
}

export interface Holder {
  locationId: number;
  name: string;
  type: 'own_store' | 'partner_3pl' | 'agent';
  isActive: boolean;
  allocated: number;
  inTransit: number;
  delivered: number;
  returned: number;
  onHand: number;
  reserved: number;
  value: number;
  count: HolderCount | null;
}

export interface Holders {
  product: { id: number; name: string; sku: string; archived: boolean };
  holders: Holder[];
  total: { allocated: number; inTransit: number; delivered: number; returned: number; onHand: number; reserved: number; value: number };
  productTotal: number;
  holdersWithNone: string[];
}

/** One product, with the two facts the drawer needs (backend getProduct). */
export interface ProductDetail extends Omit<ProductRow, 'onHandTotal' | 'reservedTotal' | 'daysOfCover' | 'lowStockDaysEffective' | 'deliveredInPeriod' | 'deliverySuccess' | 'status'> {
  /** Fields the server refuses to change: the type once there are order lines, the cost once a shipment was received. */
  lockedFields: Array<'productType' | 'cogs'>;
  canSeeCost: boolean;
}

export interface StockLocationOption {
  id: number;
  name: string;
  type: 'own_store' | 'partner_3pl' | 'agent';
}

/** What the drawer sends. Starting stock is for create only. */
export interface ProductPayload {
  productType: 'physical' | 'digital';
  name: string;
  description?: string;
  sku: string;
  category: string;
  price: number;
  cogs?: number;
  isActive?: boolean;
  imageUrl?: string;
  lowStockDays?: number | null;
  digitalFileUrl?: string;
  digitalFileType?: string;
  downloadLinkExpiryHours?: number;
  maxDownloads?: number;
  openingStock?: { locationId: number; quantity: number };
}

export interface ArchiveResult {
  product: { id: number; name: string };
  openOrders: number;
  unitsOnHand: number;
}

export const productsService = {
  async getProducts(): Promise<Product[]> {
    const response = await apiClient.get('/api/products');
    return response.data.products || [];
  },

  /** The Products table: the server filters by `tab` and computes the figures for `month` (YYYY-MM). */
  async list(tab: ProductTab, month: string | null, skipCache = false): Promise<ProductList> {
    const response = await apiClient.get('/api/products', { params: { tab, limit: 100, ...(month ? { month } : {}) }, skipCache, quiet: true });
    return response.data;
  },

  /** The four tiles. 403 for a role that may not see cost. */
  async summary(month: string | null, skipCache = false): Promise<ProductsSummary> {
    const response = await apiClient.get('/api/products/summary', { params: month ? { month } : {}, skipCache, quiet: true });
    return response.data;
  },

  async detail(id: number): Promise<ProductDetail> {
    const response = await apiClient.get(`/api/products/${id}`, { skipCache: true, quiet: true });
    return { ...response.data.product, canSeeCost: response.data.canSeeCost };
  },

  async create(body: ProductPayload): Promise<ProductRow> {
    const response = await apiClient.post('/api/products', body, { quiet: true });
    return response.data.product;
  },

  async update(id: number, body: Omit<ProductPayload, 'openingStock'>): Promise<ProductRow> {
    const response = await apiClient.put(`/api/products/${id}`, body, { quiet: true });
    return response.data.product;
  },

  /** Archive: the product leaves new orders and forms. Says what it still holds. */
  async archive(id: number): Promise<ArchiveResult> {
    const response = await apiClient.post(`/api/products/${id}/archive`, undefined, { quiet: true });
    return response.data;
  },

  async restore(id: number): Promise<void> {
    await apiClient.post(`/api/products/${id}/restore`, undefined, { quiet: true });
  },

  /** Stock by holder, read only (F-603). */
  async holders(id: number): Promise<Holders> {
    const response = await apiClient.get(`/api/inventory/product/${id}/holders`, { skipCache: true, quiet: true });
    return response.data;
  },

  /** Active physical stock locations, for the starting-stock and receive pickers. */
  async stockLocations(): Promise<StockLocationOption[]> {
    const response = await apiClient.get('/api/inventory/overview', { quiet: true });
    return (response.data.locations as StockLocationOption[]).map((l) => ({ id: l.id, name: l.name, type: l.type }));
  },
};
