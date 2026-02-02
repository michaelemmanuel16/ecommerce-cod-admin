import { apiClient } from './api';

export interface SystemConfig {
  id: string;
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
  businessAddress?: string;
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
  };
  emailProvider?: {
    provider: string;
    apiKey?: string;
    fromEmail?: string;
    fromName?: string;
  };
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
  password: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  role: string;
  commissionAmount?: number;
  deliveryRate?: number;
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

export const adminService = {
  // System Configuration
  async getSystemConfig(): Promise<SystemConfig> {
    const response = await apiClient.get('/api/admin/settings');
    return response.data;
  },

  async getPublicConfig(): Promise<Pick<SystemConfig, 'businessName' | 'currency'>> {
    const response = await apiClient.get('/api/admin/config');
    return response.data;
  },

  async updateSystemConfig(data: Partial<SystemConfig>): Promise<SystemConfig> {
    const response = await apiClient.put('/api/admin/settings', data);
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
    isActive?: boolean;
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

  async createUser(data: CreateUserData): Promise<AdminUser> {
    const response = await apiClient.post('/api/admin/users', data);
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
};
