import { apiClient } from './api';
import { publicClient } from './public-orders.service';

export interface SystemConfig {
  id: string;
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
  supportWhatsapp?: string | null;
  contactPerson?: string | null;
  timeZone?: string;
  taxId?: string;
  currency: string;
  operatingHours?: {
    [key: string]: { open: string; close: string; enabled: boolean };
  };
  smsProvider?: {
    provider: string;
    accountSid?: string;
    authToken?: string;
    phoneNumber?: string;
    senderId?: string;
    isEnabled?: boolean;
  };
  emailProvider?: {
    provider: string;
    apiKey?: string;
    fromEmail?: string;
    fromName?: string;
  };
  whatsappProvider?: {
    accessToken?: string;
    phoneNumberId?: string;
    appSecret?: string;
    webhookVerifyToken?: string;
    isEnabled?: boolean;
    authMode?: 'manual' | 'oauth';
    wabaId?: string;
    oauthTokenExpiry?: string;
    oauthConnectedAt?: string;
    oauthVerifiedName?: string;
    oauthDisplayPhone?: string;
    oauthUserId?: string;
  };
  paystackProvider?: {
    publicKey?: string;
    secretKey?: string;
    mode?: 'test' | 'live';
    isEnabled?: boolean;
  };
  /** Slug of the current tenant — used to render the per-tenant Paystack webhook URL. */
  tenantSlug?: string | null;
  notificationTemplates?: {
    orderConfirmation?: { sms: string; email: string };
    outForDelivery?: { sms: string; email: string };
    delivered?: { sms: string; email: string };
    paymentReminder?: { sms: string; email: string };
  };
  rolePermissions?: any;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  role: string;
  commissionAmount?: number;
  deliveryRate?: number;
  isActive: boolean;
  isAvailable?: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface CreateUserData {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  role: string;
  commissionAmount?: number;
  deliveryRate?: number;
}

export interface InviteResult {
  /** Shown once. Copy it when the send failed. */
  link: string;
  delivery: { channel: string; sent: boolean; reason?: string };
}

export interface UpdateUserData {
  email?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  role?: string;
  commissionAmount?: number;
  deliveryRate?: number;
  isActive?: boolean;
}

/** Mirror of WABAPhoneNumber in backend/src/services/metaOAuthService.ts — keep in sync */
export interface WABAPhoneNumber {
  id: string;
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
  code_verification_status?: string;
}

export const adminService = {
  // System Configuration
  async getSystemConfig(): Promise<SystemConfig> {
    const response = await apiClient.get('/api/admin/settings');
    return response.data;
  },

  async getPublicConfig(formSlug: string): Promise<Pick<SystemConfig, 'businessName' | 'currency'>> {
    // Use publicClient (no auth interceptor) since this endpoint doesn't require auth.
    // Using apiClient here caused iframe embedding to break: stale tokens triggered
    // 401 → redirect to /login → X-Frame-Options blocked the iframe.
    // The backend needs the tenant: the form slug of the public page identifies it.
    const response = await publicClient.get('/api/admin/config', { params: { form: formSlug } });
    return response.data;
  },

  // Same shape as getPublicConfig, but authenticated so the backend resolves the
  // caller's tenant from the JWT and returns THEIR currency/business name.
  // Signed-in surfaces use this; the token-less public form page uses /config?form=<slug>.
  async getTenantConfig(): Promise<Pick<SystemConfig, 'businessName' | 'currency'>> {
    const response = await apiClient.get('/api/admin/config/me');
    return response.data;
  },

  async updateSystemConfig(data: Partial<SystemConfig>): Promise<SystemConfig> {
    const response = await apiClient.put('/api/admin/settings', data);
    return response.data;
  },

  async getWhatsAppStatus(): Promise<{
    configured?: boolean;
    enabled?: boolean;
    verifiedName?: string;
    displayPhoneNumber?: string;
    qualityRating?: string;
    error?: string;
  }> {
    const response = await apiClient.get('/api/whatsapp/status');
    return response.data;
  },

  // Role Permissions
  async getRolePermissions(): Promise<any> {
    const response = await apiClient.get('/api/admin/permissions');
    return response.data;
  },

  async updateRolePermissions(permissions: any): Promise<any> {
    const response = await apiClient.put('/api/admin/permissions', permissions);
    return response.data;
  },

  // User Management
  async getUsers(params?: {
    page?: number;
    limit?: number;
    role?: string;
    isActive?: boolean | 'all';
  }): Promise<{
    users: AdminUser[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const response = await apiClient.get('/api/admin/users', { params });
    return response.data;
  },

  /** POST /api/staff/invite (M6-T06): the person gets a link and chooses their own password. */
  async inviteUser(data: CreateUserData): Promise<InviteResult> {
    const response = await apiClient.post('/api/staff/invite', {
      name: `${data.firstName} ${data.lastName}`.trim(),
      email: data.email,
      phoneNumber: data.phoneNumber || undefined,
      role: data.role,
      ...(data.commissionAmount ? { payMethod: 'per_order', amount: data.commissionAmount } : {}),
    });
    return response.data;
  },

  async updateUser(userId: string, data: UpdateUserData): Promise<AdminUser> {
    const response = await apiClient.put(`/api/admin/users/${userId}`, data);
    return response.data;
  },

  async resetUserPassword(userId: string, password: string): Promise<void> {
    await apiClient.post(`/api/admin/users/${userId}/reset-password`, { password });
  },

  async deleteUser(userId: string): Promise<void> {
    await apiClient.delete(`/api/admin/users/${userId}`);
  },

  async permanentlyDeleteUser(userId: string): Promise<void> {
    await apiClient.delete(`/api/admin/users/${userId}/permanent`);
  },

  // WhatsApp OAuth
  async initiateWhatsAppOAuth(): Promise<{ authUrl: string }> {
    const response = await apiClient.post('/api/whatsapp/oauth/initiate');
    return response.data;
  },

  async getWhatsAppOAuthPhones(): Promise<{ phones: WABAPhoneNumber[] }> {
    const response = await apiClient.get('/api/whatsapp/oauth/phones');
    return response.data;
  },

  async selectWhatsAppOAuthPhone(data: {
    phoneNumberId: string;
    displayPhone: string;
    verifiedName: string;
    wabaId?: string;
  }): Promise<{ success: boolean; verifiedName: string; displayPhone: string }> {
    const response = await apiClient.post('/api/whatsapp/oauth/select', data);
    return response.data;
  },

  async disconnectWhatsAppOAuth(): Promise<{ success: boolean }> {
    const response = await apiClient.delete('/api/whatsapp/oauth/disconnect');
    return response.data;
  },

  async checkWhatsAppOAuthEnabled(): Promise<{ enabled: boolean }> {
    const response = await apiClient.get('/api/whatsapp/oauth/enabled');
    return response.data;
  },

  // Operations Settings (M7-T21, F-1229)
  async getOperationsSettings(): Promise<OperationsSettings> {
    const response = await apiClient.get('/api/admin/settings/operations');
    return response.data;
  },

  async updateOperationsSettings(data: UpdateOperationsSettingsData): Promise<OperationsSettings> {
    const response = await apiClient.put('/api/admin/settings/operations', data);
    return response.data;
  },
};

export interface DayHours {
  open: string;
  close: string;
  enabled: boolean;
}

export interface OperatingHoursConfig {
  days?: Partial<Record<string, DayHours>>;
  queueWaitAlertMinutes?: number;
  firstCallTargetMinutes?: number;
  defaultDaysToPay?: number;
  lowStockCoverDays?: number;
}

export interface OperationsSettings {
  operatingHours: OperatingHoursConfig | null;
  autoConfirmEnabled: boolean;
  autoConfirmChannel: 'whatsapp' | 'sms';
  timeZone: string;
  queueWaitAlertMinutes: number;
  firstCallTargetMinutes: number;
  defaultDaysToPay: number;
  lowStockCoverDays: number;
}

export interface UpdateOperationsSettingsData {
  operatingHours?: OperatingHoursConfig;
  autoConfirmEnabled?: boolean;
  autoConfirmChannel?: 'whatsapp' | 'sms';
  timeZone?: string;
  queueWaitAlertMinutes?: number;
  firstCallTargetMinutes?: number;
  defaultDaysToPay?: number;
  lowStockCoverDays?: number;
}
