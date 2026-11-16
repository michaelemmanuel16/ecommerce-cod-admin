import apiClient from './api';

export type CardStatus = 'connected' | 'not_connected' | 'error';

/** One card of GET /api/connections. `reason` is the API's own sentence for a card that is off or in error. */
export interface ConnectionCard {
  status: CardStatus;
  reason: string | null;
  lastEventAt: string | null;
}

export interface ConnectionCards {
  sms: ConnectionCard;
  whatsapp: ConnectionCard;
  email: ConnectionCard & { provider: string | null };
  paystack: ConnectionCard & { mode: 'test' | 'live' | null };
  meta: ConnectionCard & { accounts: number };
  checkout: ConnectionCard & { forms: number; lastOrderAt: string | null };
  csv: ConnectionCard & { templateUrl: string };
}

export interface PaymentConnection {
  id: number | null;
  provider: string;
  mode: 'test' | 'live';
  publicKey: string | null;
  /** The mask sentinel, never the key. */
  secretKey: string | null;
  hasSecret: boolean;
  isEnabled: boolean;
  lastCheckedAt: string | null;
  legacy: boolean;
}

export type ActivityLevel = 'info' | 'warning' | 'error';
export type ActivityTab = 'all' | 'error' | 'warning';

export interface ActivityItem {
  id: number;
  connection: string;
  level: ActivityLevel;
  message: string;
  at: string;
}

export interface ActivityPage {
  counts: { all: number; error: number; warning: number };
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface SmtpFields {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  password?: string;
  fromEmail?: string;
}

export const connectionsService = {
  async getCards(): Promise<ConnectionCards> {
    return (await apiClient.get('/api/connections')).data;
  },

  async getActivity(level: ActivityTab, cursor?: string): Promise<ActivityPage> {
    return (await apiClient.get('/api/connections/activity', { params: { level, cursor } })).data;
  },

  /** The partner CSV template as a Blob (the route needs the sign-in token, so a plain link would not work). */
  async getCsvTemplate(): Promise<Blob> {
    return (await apiClient.get('/api/connections/csv/template', { responseType: 'blob' })).data;
  },

  async getSmsReportUrl(): Promise<{ url: string | null; message?: string }> {
    return (await apiClient.get('/api/settings/sms/report-url')).data;
  },

  async testSmtp(fields: SmtpFields): Promise<{ ok: boolean; sentTo: string }> {
    return (await apiClient.post('/api/settings/smtp/test', fields)).data;
  },

  async getPaymentConnections(): Promise<PaymentConnection[]> {
    return (await apiClient.get('/api/payment-connections')).data.connections;
  },

  async savePaymentConnection(body: {
    provider: string;
    mode: 'test' | 'live';
    publicKey?: string | null;
    secretKey?: string | null;
    isEnabled?: boolean;
  }): Promise<PaymentConnection> {
    return (await apiClient.put('/api/payment-connections', body)).data.connection;
  },

  async testPaymentConnection(id: number): Promise<{ ok: boolean; message: string }> {
    return (await apiClient.post(`/api/payment-connections/${id}/test`)).data;
  },

  async sendSmsTest(phoneNumber: string): Promise<void> {
    await apiClient.post('/api/sms/test', { phoneNumber });
  },

  async disconnectSms(): Promise<void> {
    await apiClient.delete('/api/sms/disconnect');
  },

  async sendEmailTest(email: string): Promise<void> {
    await apiClient.post('/api/email/test', { email });
  },
};
