import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usersService } from '../../services/users.service';
import { apiClient } from '../../services/api';
import { UserPreferences } from '../../types';

// Mock the API client
vi.mock('../../services/api', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

describe('Users Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserPreferences', () => {
    it('should fetch user preferences', async () => {
      const mockPreferences: UserPreferences = {
        theme: 'dark',
        language: 'en',
        notifications: {
          email: true,
          push: false,
          sms: true,
        },
      };

      vi.mocked(apiClient.get).mockResolvedValue({
        data: { preferences: mockPreferences },
      } as any);

      const result = await usersService.getUserPreferences();

      expect(apiClient.get).toHaveBeenCalledWith('/api/users/preferences');
      expect(result).toEqual(mockPreferences);
    });

    it('should handle errors when fetching preferences', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Network error'));

      await expect(usersService.getUserPreferences()).rejects.toThrow('Network error');
    });
  });

  describe('updateUserPreferences', () => {
    it('should update user preferences', async () => {
      const preferences: UserPreferences = {
        theme: 'light',
        language: 'es',
        notifications: {
          email: false,
          push: true,
          sms: false,
        },
      };

      vi.mocked(apiClient.put).mockResolvedValue({
        data: { preferences },
      } as any);

      const result = await usersService.updateUserPreferences(preferences);

      expect(apiClient.put).toHaveBeenCalledWith('/api/users/preferences', { preferences });
      expect(result).toEqual(preferences);
    });

    it('should handle errors when updating preferences', async () => {
      const preferences: UserPreferences = {
        theme: 'dark',
        language: 'en',
        notifications: {
          email: true,
          push: false,
          sms: true,
        },
      };

      vi.mocked(apiClient.put).mockRejectedValue(new Error('Update failed'));

      await expect(usersService.updateUserPreferences(preferences)).rejects.toThrow('Update failed');
    });
  });
});
