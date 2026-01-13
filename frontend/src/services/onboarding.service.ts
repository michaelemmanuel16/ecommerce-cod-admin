import { usersService } from './users.service';
import { UserPreferences } from '../types';

export const onboardingService = {
  /**
   * Get the current onboarding status for the logged-in user
   * @returns true if onboarding has been completed, false otherwise
   */
  async getStatus(): Promise<boolean> {
    try {
      const preferences = await usersService.getUserPreferences();
      return preferences?.onboardingCompleted ?? false;
    } catch (error) {
      console.error('Error fetching onboarding status:', error);
      return false;
    }
  },

  /**
   * Mark onboarding as complete for the logged-in user
   * Merges with existing preferences to avoid overwriting other settings
   */
  async markComplete(): Promise<void> {
    try {
      // Get current preferences first to merge
      const currentPreferences = await usersService.getUserPreferences();

      // Merge onboarding completion with existing preferences
      const updatedPreferences: UserPreferences = {
        ...currentPreferences,
        onboardingCompleted: true,
        onboardingCompletedAt: new Date().toISOString(),
      };

      await usersService.updateUserPreferences(updatedPreferences);
    } catch (error) {
      console.error('Error marking onboarding complete:', error);
      throw error;
    }
  },

  /**
   * Reset onboarding status (useful for testing or retaking the tour)
   */
  async reset(): Promise<void> {
    try {
      // Get current preferences first to merge
      const currentPreferences = await usersService.getUserPreferences();

      // Remove onboarding flags while preserving other preferences
      const updatedPreferences: UserPreferences = {
        ...currentPreferences,
        onboardingCompleted: false,
        onboardingCompletedAt: undefined,
      };

      await usersService.updateUserPreferences(updatedPreferences);
    } catch (error) {
      console.error('Error resetting onboarding:', error);
      throw error;
    }
  },
};
