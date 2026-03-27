import apiClient from './api';

export interface MessageLog {
  id: number;
  orderId?: number;
  customerId?: number;
  channel: 'whatsapp' | 'sms';
  direction: 'outbound' | 'inbound';
  templateName?: string;
  messageBody: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  errorMessage?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  createdAt: string;
  order?: { id: number; status: string; orderNumber?: string };
  customer?: { id: number; firstName: string; lastName: string; phoneNumber: string };
}

export interface MessageStats {
  total: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
}

export interface SmsTemplate {
  id: number;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Recipient {
  id: number;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  state: string;
  area: string;
  smsOptOut: boolean;
  whatsappOptOut: boolean;
}

export const communicationService = {
  async getMessages(params?: Record<string, any>): Promise<{ messages: MessageLog[]; pagination: any }> {
    const res = await apiClient.get('/api/communications/messages', { params });
    return { messages: res.data.data || res.data.messages || [], pagination: res.data.pagination };
  },

  async getStats(startDate?: string, endDate?: string): Promise<MessageStats> {
    const res = await apiClient.get('/api/communications/stats', { params: { startDate, endDate } });
    return res.data;
  },

  async getRecipients(filters: Record<string, any>): Promise<Recipient[]> {
    const res = await apiClient.get('/api/communications/recipients', { params: filters });
    return res.data;
  },

  async bulkSendSms(customerIds: number[], message: string) {
    const res = await apiClient.post('/api/communications/bulk-sms', { customerIds, message });
    return res.data;
  },

  async bulkSendWhatsApp(customerIds: number[], templateKey: string, customLink?: string) {
    const res = await apiClient.post('/api/communications/bulk-whatsapp', { customerIds, templateKey, customLink });
    return res.data;
  },

  async getTemplates(): Promise<SmsTemplate[]> {
    const res = await apiClient.get('/api/communications/sms-templates');
    return res.data;
  },

  async createTemplate(data: { name: string; body: string }): Promise<SmsTemplate> {
    const res = await apiClient.post('/api/communications/sms-templates', data);
    return res.data;
  },

  async updateTemplate(id: number, data: { name?: string; body?: string }): Promise<SmsTemplate> {
    const res = await apiClient.put(`/api/communications/sms-templates/${id}`, data);
    return res.data;
  },

  async deleteTemplate(id: number): Promise<void> {
    await apiClient.delete(`/api/communications/sms-templates/${id}`);
  },

  async getOptOutCustomers(page?: number, limit?: number) {
    const res = await apiClient.get('/api/communications/opt-outs', { params: { page, limit } });
    return res.data;
  },

  async updateOptOut(customerId: number, data: { smsOptOut?: boolean; whatsappOptOut?: boolean }) {
    const res = await apiClient.patch(`/api/communications/opt-out/${customerId}`, data);
    return res.data;
  },
};
