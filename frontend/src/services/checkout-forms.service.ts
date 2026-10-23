import apiClient from './api';
import { CheckoutForm as CheckoutFormType } from '../types/checkout-form';
import type { PaymentConnectionInfo } from '../lib/paymentMatrix';

export type CheckoutForm = CheckoutFormType;

export interface CheckoutFormStats {
  id: number;
  totalSubmissions: number;
  totalRevenue: number;
  conversionRate: number;
  averageOrderValue: number;
  submissionsByStatus: Record<string, number>;
}

/** Reply of DELETE /:id: a form with orders is archived, any other is removed (F-408). */
export interface DeleteFormResult {
  archived?: boolean;
  deleted?: boolean;
  ordersTotal?: number;
  /** "No active form sells this product." when this was the product's last active form. */
  warning?: string;
}

/** Reply of POST /:id/clone. The Conversion API token is never copied. */
export interface CloneFormResult {
  form: CheckoutForm;
  capiTokenNotCopied: boolean;
}

export interface CheckoutFormFilters {
  search?: string;
  isActive?: boolean;
  /** true lists archived forms only; the default hides them. */
  archived?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/** The reason an image file cannot be used, or null. One check for the banner and the upsell images. */
export function validateImageFile(file: File, rule: { types: string[]; maxBytes: number; message: string }): string | null {
  return rule.types.includes(file.type) && file.size <= rule.maxBytes ? null : rule.message;
}

/** Reply of GET /payment-options: the tenant flag and the payment account's state. Never a key. */
export interface PaymentOptions {
  prepaidPhysical: boolean;
  connection: PaymentConnectionInfo | null;
}

/** Reply of GET /:id/upsell-stats. An upsell with no entry cannot be counted reliably (a manual upsell whose name repeats). */
export interface UpsellStats {
  ordersTotal: number;
  upsells: Array<{ upsellId: number; orders: number }>;
}

/** Reply of POST /:id/test-event: Meta's answer as it came back. */
export interface TestEventResult {
  ok: boolean;
  status: number;
  metaResponse: unknown;
}

export const checkoutFormsService = {
  async getCheckoutForms(filters?: CheckoutFormFilters): Promise<CheckoutForm[]> {
    const response = await apiClient.get('/api/checkout-forms', { params: filters, skipCache: true });
    return response.data.forms || response.data || [];
  },

  async getCheckoutForm(id: number): Promise<CheckoutForm> {
    const response = await apiClient.get(`/api/checkout-forms/${id}`);
    return response.data.form || response.data;
  },

  async getCheckoutFormPreviewConfig(id: number): Promise<any> {
    const response = await apiClient.get(`/api/checkout-forms/${id}/preview-config`);
    return response.data.form || response.data;
  },

  async createCheckoutForm(data: Partial<CheckoutForm>): Promise<CheckoutForm> {
    const response = await apiClient.post('/api/checkout-forms', data);
    return response.data.form || response.data;
  },

  async updateCheckoutForm(id: number, data: Partial<CheckoutForm>): Promise<CheckoutForm> {
    const response = await apiClient.put(`/api/checkout-forms/${id}`, data);
    return response.data.form || response.data;
  },

  async deleteCheckoutForm(id: number): Promise<DeleteFormResult> {
    const response = await apiClient.delete(`/api/checkout-forms/${id}`, { quiet: true });
    return response.data ?? {};
  },

  async cloneCheckoutForm(id: number): Promise<CloneFormResult> {
    const response = await apiClient.post(`/api/checkout-forms/${id}/clone`, undefined, { quiet: true });
    return { form: response.data.form, capiTokenNotCopied: Boolean(response.data.capiTokenNotCopied) };
  },

  async restoreCheckoutForm(id: number): Promise<void> {
    await apiClient.post(`/api/checkout-forms/${id}/restore`, undefined, { quiet: true });
  },

  /** The list's active switch: the screen shows a refusal (the required-key guard) itself. */
  async setCheckoutFormActive(id: number, isActive: boolean): Promise<void> {
    await apiClient.put(`/api/checkout-forms/${id}`, { isActive }, { quiet: true });
  },

  /** Uploads one image through the shared upload route and returns its public address. */
  async uploadImage(file: File): Promise<string> {
    const body = new FormData();
    body.append('image', file);
    const response = await apiClient.post('/api/upload', body, { headers: { 'Content-Type': 'multipart/form-data' } });
    return response.data.imageUrl;
  },

  async getPaymentOptions(): Promise<PaymentOptions> {
    const response = await apiClient.get('/api/checkout-forms/payment-options', { quiet: true, skipCache: true });
    return response.data;
  },

  async getUpsellStats(id: number): Promise<UpsellStats> {
    const response = await apiClient.get(`/api/checkout-forms/${id}/upsell-stats`, { quiet: true, skipCache: true });
    return response.data;
  },

  /** Sends one test Purchase to Meta with the form's stored token and test event code. Owner and admin only. */
  async sendTestEvent(id: number): Promise<TestEventResult> {
    const response = await apiClient.post(`/api/checkout-forms/${id}/test-event`, undefined, { quiet: true });
    return response.data;
  },

  async getFormStats(id: number): Promise<CheckoutFormStats> {
    const response = await apiClient.get(`/api/checkout-forms/${id}/stats`);
    return response.data.stats || response.data;
  },
};
