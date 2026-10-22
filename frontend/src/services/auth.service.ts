import apiClient from './api';
import { LoginCredentials, User, AuthTokens } from '../types';

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
  permissions?: string[];
}

/** GET /api/auth/me: the person plus what the app shell needs (M3-T07, F-102, F-104). */
export interface MeResponse {
  user: User;
  permissions: any;
  /** Menu keys the person may see, in menu order. */
  menu?: string[];
  homeRoute?: string;
  /** Role names from RoleAssignment, else the base role name. */
  roles?: Array<{ id: number | null; name: string }>;
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await apiClient.post('/api/auth/login', credentials);
    return response.data;
  },

  async logout(): Promise<void> {
    await apiClient.post('/api/auth/logout');
  },

  async refreshToken(refreshToken: string): Promise<{ accessToken: string }> {
    const response = await apiClient.post('/api/auth/refresh', { refreshToken });
    return response.data;
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const response = await apiClient.post('/api/auth/forgot-password', { email });
    return response.data;
  },

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const response = await apiClient.post('/api/auth/reset-password', { token, password });
    return response.data;
  },

  async getProfile(): Promise<User> {
    const response = await apiClient.get('/api/auth/profile');
    return response.data;
  },

  async getMe(): Promise<MeResponse> {
    const response = await apiClient.get('/api/auth/me');
    return response.data;
  },

  async registerTenant(data: {
    companyName: string;
    adminEmail: string;
    adminPassword: string;
    adminName: string;
    planName?: string;
  }): Promise<{ user: User; tokens: AuthTokens; tenant: { id: string; name: string; slug: string } }> {
    const response = await apiClient.post('/api/auth/register-tenant', data);
    return response.data;
  },

  async deleteAccount(password: string): Promise<{ message: string }> {
    const response = await apiClient.delete('/api/auth/delete-account', { data: { password } });
    return response.data;
  },
};
