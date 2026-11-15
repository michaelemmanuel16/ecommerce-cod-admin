import apiClient from './api';

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

/** The answer of a bulk SMS or WhatsApp send. `skipped` counts customers messageSender did not send to (opted out). */
export interface BulkSendResult {
  total: number;
  skipped: number;
  results: Array<{ customerId: number; success: boolean; skipped?: boolean; messageLogId?: number; error?: string }>;
}

/** The customers a send reaches (capped at `limit`) and how many match in all. */
export interface RecipientList { recipients: Recipient[]; total: number; limit: number }

export const communicationService = {
  async getRecipients(filters: Record<string, any>): Promise<RecipientList> {
    const res = await apiClient.get('/api/communications/recipients', { params: filters });
    return res.data;
  },

  async bulkSendSms(customerIds: number[], message: string): Promise<BulkSendResult> {
    const res = await apiClient.post('/api/communications/bulk-sms', { customerIds, message });
    return res.data;
  },

  async bulkSendWhatsApp(customerIds: number[], templateKey: string, customLink?: string): Promise<BulkSendResult> {
    const res = await apiClient.post('/api/communications/bulk-whatsapp', { customerIds, templateKey, customLink });
    return res.data;
  },

  async getCampaigns(): Promise<EmailCampaign[]> {
    const res = await apiClient.get('/api/communications/campaigns');
    return res.data;
  },
};
