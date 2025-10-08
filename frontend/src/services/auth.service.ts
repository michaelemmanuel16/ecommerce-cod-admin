import apiClient from './api';
import { LoginCredentials, RegisterData, User, AuthTokens } from '../types';

export const authService = {
  async login(credentials: LoginCredentials): Promise<{ user: User; tokens: AuthTokens }> {
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

  async getProfile(): Promise<User> {
    const response = await apiClient.get('/api/auth/profile');
    return response.data;
  },
};
