import apiClient from './api';
import { LoginCredentials, RegisterData, User, AuthTokens } from '../types';

export interface LoginResponse {
  user: User;
  tokens: AuthTokens;
  permissions?: string[];
}

export const authService = {
  async login(credentials: LoginCredentials): Promise<LoginResponse> {
    const response = await apiClient.post('/api/auth/login', credentials);
    return response.data;
  },

  async register(data: RegisterData): Promise<{ user: User; tokens: AuthTokens }> {
    const response = await apiClient.post('/api/auth/register', data);
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

  async getMe(): Promise<{ user: User; permissions: any }> {
    const response = await apiClient.get('/api/auth/me');
    return response.data;
  },

  async registerTenant(data: {
    companyName: string;
    adminEmail: string;
    adminPassword: string;
    adminName: string;
  }): Promise<{ user: User; tokens: AuthTokens; tenant: { id: string; name: string; slug: string } }> {
    const response = await apiClient.post('/api/auth/register-tenant', data);
    return response.data;
  },

  async setupOnboarding(data: {
    country: string;
    currency: string;
  }): Promise<{ tenant: any }> {
    const response = await apiClient.post('/api/onboarding/setup', data);
    return response.data;
  },
};
