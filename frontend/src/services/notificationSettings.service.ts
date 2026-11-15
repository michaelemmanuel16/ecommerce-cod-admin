import apiClient from './api';

/** Notification preferences (M9-T16, T39): a person's own channels per event, and the business's defaults per role. */

export const CHANNELS = ['inApp', 'whatsapp', 'email', 'sms'] as const;
export type Channel = (typeof CHANNELS)[number];
export type ChannelSwitch = Record<Channel, boolean>;

export interface ChannelView {
  enabled: boolean;
  /** false: the business has not connected this channel. */
  available: boolean;
  hint?: string;
  /** The owner cannot turn this one off. */
  locked?: boolean;
}

export interface PreferenceRow {
  event: string;
  label: string;
  kind: string;
  source: 'person' | 'role' | 'default';
  channels: Record<Channel, ChannelView>;
}

export interface RoleDefaults { role: string; defaults: PreferenceRow[] }

/** One event's channels to save. Channels left out keep the value they have now. */
export type PreferenceChange = { event: string } & Partial<ChannelSwitch>;

export const notificationSettingsService = {
  async mine(): Promise<PreferenceRow[]> {
    const { data } = await apiClient.get('/api/notifications/preferences', { skipCache: true });
    return data.preferences ?? [];
  },

  async saveMine(preferences: PreferenceChange[]): Promise<PreferenceRow[]> {
    const { data } = await apiClient.put('/api/notifications/preferences', { preferences });
    return data.preferences ?? [];
  },

  async roleDefaults(role: string): Promise<PreferenceRow[]> {
    const { data } = await apiClient.get('/api/notifications/role-defaults', { params: { role }, skipCache: true });
    return (data.roles as RoleDefaults[] | undefined)?.[0]?.defaults ?? [];
  },

  async saveRoleDefaults(role: string, defaults: PreferenceChange[]): Promise<PreferenceRow[]> {
    const { data } = await apiClient.put('/api/notifications/role-defaults', { role, defaults });
    return (data.roles as RoleDefaults[] | undefined)?.[0]?.defaults ?? [];
  },
};
