import apiClient from './api';
import type { User } from '../types';

/** The fields the profile routes return (accountService PROFILE_SELECT). */
export type ProfileUser = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'displayName' | 'phoneNumber' | 'photoUrl' | 'role' | 'createdAt'>;

export interface SessionRow {
  id: number;
  deviceLabel: string | null;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

/** Self-service account routes (M3-T22, T23, T24; F-1221 to F-1226). */
export const accountService = {
  async updateProfile(body: { name: string; displayName: string; email: string; phone: string; currentPassword?: string }): Promise<ProfileUser> {
    const response = await apiClient.patch('/api/users/me', body);
    return response.data.user;
  },

  async uploadPhoto(file: File): Promise<ProfileUser> {
    const form = new FormData();
    form.append('photo', file);
    const response = await apiClient.post('/api/users/me/photo', form);
    return response.data.user;
  },

  async removePhoto(): Promise<ProfileUser> {
    const response = await apiClient.delete('/api/users/me/photo');
    return response.data.user;
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await apiClient.post('/api/auth/change-password', { currentPassword, newPassword });
  },

  async listSessions(): Promise<SessionRow[]> {
    const response = await apiClient.get('/api/auth/sessions', { skipCache: true });
    return response.data.sessions;
  },

  async revokeSession(id: number): Promise<void> {
    await apiClient.delete(`/api/auth/sessions/${id}`);
  },

  async revokeOthers(): Promise<number> {
    const response = await apiClient.post('/api/auth/sessions/revoke-others');
    return response.data.revoked;
  },

  /** The ZIP of CSV files; saved as a download. */
  async exportMyData(): Promise<void> {
    const response = await apiClient.get('/api/users/me/export', { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `my-data-${new Date().toISOString().slice(0, 10)}.zip`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
