import apiClient from './api';
import {
  Webhook,
  WebhookLog,
  WebhookStats,
  WebhookFormData,
  WebhookTestResult,
  PaginationMeta
} from '../types';

export const webhooksService = {
  /**
   * Get all webhooks with optional pagination
   */
  async getWebhooks(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{ webhooks: Webhook[]; pagination?: PaginationMeta }> {
    const response = await apiClient.get('/api/webhooks', { params });
    const webhooks = response.data.webhooks || [];
    const pagination = response.data.pagination;

    // Transform backend data to match frontend types
    return {
      webhooks: webhooks.map((w: any) => ({
        ...w,
        fieldMapping: w.fieldMapping || w.field_mapping || {},
        isActive: w.isActive !== undefined ? w.isActive : w.is_active !== undefined ? w.is_active : true,
        apiKey: w.apiKey || w.api_key
      })),
      pagination
    };
  },

  /**
   * Get single webhook by ID with recent logs
   */
  async getWebhookById(id: number): Promise<Webhook> {
    const response = await apiClient.get(`/api/webhooks/${id}`);
    const webhook = response.data.webhook || response.data;

    return {
      ...webhook,
      fieldMapping: webhook.fieldMapping || webhook.field_mapping || {},
      isActive: webhook.isActive !== undefined ? webhook.isActive : webhook.is_active !== undefined ? webhook.is_active : true,
      apiKey: webhook.apiKey || webhook.api_key
    };
  },

  /**
   * Create new webhook configuration
   */
  async createWebhook(data: WebhookFormData): Promise<Webhook> {
    const response = await apiClient.post('/api/webhooks', {
      name: data.name,
      url: data.url,
      secret: data.secret,
      apiKey: data.apiKey,
      fieldMapping: data.fieldMapping,
      headers: data.headers || {}
    });

    return response.data.webhook || response.data;
  },

  /**
   * Update existing webhook configuration
   */
  async updateWebhook(id: number, data: Partial<WebhookFormData>): Promise<Webhook> {
    const response = await apiClient.put(`/api/webhooks/${id}`, data);
    return response.data.webhook || response.data;
  },

  /**
   * Delete webhook configuration
   */
  async deleteWebhook(id: number): Promise<void> {
    await apiClient.delete(`/api/webhooks/${id}`);
  },

  /**
   * Get webhook logs with pagination
   */
  async getWebhookLogs(
    webhookId: number,
    params?: { page?: number; limit?: number }
  ): Promise<{ logs: WebhookLog[]; pagination: PaginationMeta }> {
    const response = await apiClient.get(`/api/webhooks/${webhookId}/logs`, { params });

    return {
      logs: response.data.logs || [],
      pagination: response.data.pagination || { page: 1, limit: 20, total: 0, pages: 0 }
    };
  },

  /**
   * Test webhook field mapping with sample data
   */
  async testWebhook(webhookId: number, sampleData: any): Promise<WebhookTestResult> {
    const response = await apiClient.post(`/api/webhooks/${webhookId}/test`, { sampleData });
    return response.data;
  },

  /**
   * Get webhook statistics
   */
  async getWebhookStats(
    webhookId: number,
    filters?: { days?: number }
  ): Promise<WebhookStats> {
    const response = await apiClient.get(`/api/webhooks/${webhookId}/stats`, {
      params: filters
    });

    return response.data || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 0,
      recentActivity: []
    };
  },

  /**
   * Retry failed webhook log
   */
  async retryWebhook(logId: number): Promise<any> {
    const response = await apiClient.post(`/api/webhooks/logs/${logId}/retry`);
    return response.data;
  }
};
