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
  email?: string | null;
  state: string;
  area: string;
  smsOptOut: boolean;
  whatsappOptOut: boolean;
  emailOptOut?: boolean;
}

// Pre-send eligibility breakdown for the D-CRIT banner. emailable is the
// remainder after removing customers with no address and those opted out.
export interface EmailAudience {
  audienceTotal: number;
  noEmail: number;
  optedOut: number;
  emailable: number;
}

// Per-campaign send breakdown. no-address / opted-out are neutral skips, never
// counted as failures.
export interface CampaignStats {
  audienceTotal: number;
  noEmail: number;
  optedOut: number;
  emailable: number;
  waiting: number;
  sent: number;
  delivered: number;
  failed: number;
  skipped: number;
}

export interface EmailCampaign {
  id: number;
  title: string;
  subject: string;
  body: string;
  status: 'queued' | 'sending' | 'completed';
  audienceTotal: number;
  noEmailCount: number;
  optedOutCount: number;
  totalRecipients: number;
  createdAt: string;
  updatedAt: string;
  stats: CampaignStats;
}

export type AudienceFilter = { state?: string; productId?: number; hasOrdered?: boolean };

export const communicationService = {
  async getMessages(params?: Record<string, any>): Promise<{ messages: MessageLog[]; pagination: any }> {
    const res = await apiClient.get('/api/communications/messages', { params });
    return { messages: res.data.data || [], pagination: res.data.pagination };
  },

  async getStats(startDate?: string, endDate?: string): Promise<MessageStats> {
    const res = await apiClient.get('/api/communications/stats', { params: { startDate, endDate } });
    return res.data;
  },

  async getRecipients(filters: Record<string, any>): Promise<Recipient[]> {
    const res = await apiClient.get('/api/communications/recipients', { params: filters });
    return res.data;
  },

  async getEmailAudience(filters: AudienceFilter): Promise<EmailAudience> {
    const res = await apiClient.get('/api/communications/email-audience', { params: filters });
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

  // Queue a bulk email blast. Send by audience filter (not the capped preview
  // list) so the backend enqueues the full eligible set via cursor pagination.
  async bulkSendEmail(params: {
    title: string;
    subject: string;
    htmlBody: string;
    filter?: AudienceFilter;
    customerIds?: number[];
  }): Promise<EmailCampaign> {
    const res = await apiClient.post('/api/communications/bulk-email', params);
    return res.data;
  },

  async getCampaigns(): Promise<EmailCampaign[]> {
    const res = await apiClient.get('/api/communications/campaigns');
    return res.data;
  },

  async getCampaign(id: number): Promise<EmailCampaign> {
    const res = await apiClient.get(`/api/communications/campaigns/${id}`);
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
