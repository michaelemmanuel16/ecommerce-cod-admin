import apiClient from './api';
import { Customer, PaginationMeta } from '../types';
import { samePhone } from '../utils/phone';

export const customersService = {
  async getCustomers(params?: { page?: number; limit?: number; search?: string; area?: string; sortBy?: 'totalOrders' | 'totalSpent'; sortOrder?: 'asc' | 'desc' }): Promise<{ customers: Customer[]; pagination: PaginationMeta }> {
    const response = await apiClient.get('/api/customers', { params });
    const customers = response.data.customers || [];
    const pagination = response.data.pagination || { page: 1, limit: 20, total: 0, pages: 0 };
    // Transform backend data to match frontend types
    return {
      customers: customers.map((c: any) => ({
        ...c,
        name: `${c.firstName} ${c.lastName}`.trim(),
        phone: c.phoneNumber,
        alternatePhone: c.alternatePhone,
        address: c.address ? {
          street: c.address,
          state: c.state,
          country: 'US',
          phone: c.phoneNumber
        } : undefined
      })),
      pagination
    };
  },

  async getCustomerById(id: number): Promise<Customer> {
    const response = await apiClient.get(`/api/customers/${id}`);
    const customer = response.data.customer || response.data;
    // Transform if needed
    return {
      ...customer,
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      phone: customer.phoneNumber,
      alternatePhone: customer.alternatePhone,
      address: customer.address ? {
        street: customer.address,
        state: customer.state,
        country: 'US',
        phone: customer.phoneNumber
      } : undefined
    };
  },

  /** The customer a typed phone belongs to, if any (F-362). The list search matches every phone format. */
  async findByPhone(phone: string): Promise<{ id: number; name: string; totalOrders: number; codBlocked: boolean } | null> {
    const response = await apiClient.get('/api/customers', { params: { search: phone, limit: 10 } });
    const hit = (response.data.customers || []).find((c: any) => samePhone(c.phoneNumber, phone) || samePhone(c.alternatePhone, phone));
    if (!hit) return null;
    return { id: hit.id, name: `${hit.firstName} ${hit.lastName}`.trim(), totalOrders: hit.totalOrders ?? 0, codBlocked: hit.codBlocked === true };
  },

  /** The fields the New order sheet prefills from a customer (`/orders?new=1&customerId=`). */
  async getForOrder(id: number) {
    const response = await apiClient.get(`/api/customers/${id}`);
    const c = response.data.customer || response.data;
    return {
      name: `${c.firstName} ${c.lastName}`.trim(),
      phone: c.phoneNumber ?? '',
      alternatePhone: c.alternatePhone ?? '',
      email: c.email ?? '',
      address: typeof c.address === 'string' ? c.address : '',
      region: c.state ?? '',
      town: c.area ?? '',
      landmark: c.landmark ?? '',
    };
  },

  async createCustomer(customer: any): Promise<Customer> {
    const response = await apiClient.post('/api/customers', customer);
    return response.data.customer || response.data;
  },

  async updateCustomer(id: number, customer: any): Promise<Customer> {
    const response = await apiClient.put(`/api/customers/${id}`, customer);
    return response.data.customer || response.data;
  },

  async deleteCustomer(id: number): Promise<void> {
    await apiClient.delete(`/api/customers/${id}`);
  },

  /** The v2 customers list (F-350 to F-353). Rows keep the API names; `skipCache` is for refetches after a change. */
  async listCustomers(params: CustomerListParams, skipCache = false): Promise<{ rows: CustomerRow[]; pagination: PaginationMeta }> {
    const response = await apiClient.get('/api/customers', { params, skipCache });
    return {
      rows: response.data.customers || [],
      pagination: response.data.pagination || { page: 1, limit: 25, total: 0, pages: 0 },
    };
  },

  /** Tiles and tab counts for the same filters as the list (F-351). */
  async getSummary(params: CustomerFilterParams, skipCache = false): Promise<CustomerSummary> {
    const response = await apiClient.get('/api/customers/summary', { params, skipCache });
    return response.data;
  },

  /** The towns in use, for the City filter. */
  async getTowns(skipCache = false): Promise<string[]> {
    const response = await apiClient.get('/api/customers/towns', { skipCache });
    return response.data.towns || [];
  },

  /** One customer with stats, risk, block state and the last orders (F-354). */
  async getCustomerDetail(id: number, skipCache = false): Promise<CustomerDetail> {
    const response = await apiClient.get(`/api/customers/${id}`, { skipCache });
    return response.data.customer;
  },

  /** The filtered list as a CSV file (F-361). */
  async exportCustomers(params: CustomerFilterParams): Promise<void> {
    const response = await apiClient.get('/api/customers/export', { params: { ...params, format: 'csv' }, responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `customers-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};

export type CustomerRisk = 'low' | 'watch' | 'high';
export type CustomerSegment = 'all' | 'repeat' | 'first_time' | 'refused_before' | 'not_reachable';
export type CustomerSortField = 'customer' | 'orders' | 'deliveredValue' | 'lastOrder';

/** The filters shared by the list, the tiles and the export. */
export interface CustomerFilterParams {
  search?: string;
  /** City/Town */
  area?: string;
  /** State */
  region?: string;
  risk?: CustomerRisk;
  blocked?: boolean;
  flagged?: boolean;
  segment?: CustomerSegment;
}

export interface CustomerListParams extends CustomerFilterParams {
  page?: number;
  limit?: number;
  sortBy?: CustomerSortField;
  sortOrder?: 'asc' | 'desc';
}

/** A row of GET /api/customers (customerService.withDerived). Money is parsed to a number at the api edge. */
export interface CustomerRow {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
  phoneNumber: string;
  alternatePhone: string | null;
  address: string;
  /** State */
  state: string;
  /** City/Town */
  area: string;
  landmark: string | null;
  notes: string | null;
  totalOrders: number;
  deliveredOrders: number;
  refusedOrders: number;
  deliveredValue: number;
  lastOrderAt: string | null;
  risk: CustomerRisk;
  codBlocked: boolean;
  notReachable: boolean;
  smsOptOut: boolean;
  whatsappOptOut: boolean;
  emailOptOut: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerDetail extends CustomerRow {
  averageOrderValue: number | null;
  orders: Array<{ id: number; status: string; totalAmount: number; createdAt: string }>;
}

export interface CustomerSummary {
  tiles: { total: number; newThisMonth: number; firstTime: number; firstTimePct: number; repeat: number; repeatPct: number; blocked: number };
  segments: Record<CustomerSegment, number>;
}
