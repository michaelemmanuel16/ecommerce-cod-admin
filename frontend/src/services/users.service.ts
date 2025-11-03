import { apiClient } from './api';
import { UserPreferences } from '../types';

export const usersService = {
  getUserPreferences: async (): Promise<UserPreferences> => {
    const response = await apiClient.get('/api/users/preferences');
    return response.data.preferences;
  },

  updateUserPreferences: async (preferences: UserPreferences): Promise<UserPreferences> => {
    const response = await apiClient.put('/api/users/preferences', { preferences });
    return response.data.preferences;
  },
};
