import { useState, useCallback, useEffect } from 'react';
import { onboardingService } from '../services/onboarding.service';

/**
 * Custom hook for managing onboarding tour state
 *
 * Provides methods to:
 * - Check if onboarding has been completed
 * - Start/stop the tour
 * - Mark tour as complete
 * - Reset tour for retaking
 */
export const useOnboarding = () => {
  const [isOnboardingComplete, setIsOnboardingComplete] = useState<boolean>(true);
  const [isTourRunning, setIsTourRunning] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /**
   * Fetch the current onboarding status from the backend
   */
  const checkOnboardingStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const completed = await onboardingService.getStatus();
      setIsOnboardingComplete(completed);
      return completed;
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Start the onboarding tour
   */
  const startTour = useCallback(() => {
    setIsTourRunning(true);
  }, []);

  /**
   * Stop the onboarding tour
   */
  const stopTour = useCallback(() => {
    setIsTourRunning(false);
  }, []);

  /**
   * Mark onboarding as complete and stop the tour
   */
  const completeTour = useCallback(async () => {
    try {
      await onboardingService.markComplete();
      setIsOnboardingComplete(true);
      setIsTourRunning(false);
    } catch (error) {
      console.error('Error completing onboarding:', error);
      throw error;
    }
  }, []);

  /**
   * Reset onboarding status (useful for retaking the tour)
   */
  const resetTour = useCallback(async () => {
    try {
      await onboardingService.reset();
      setIsOnboardingComplete(false);
      setIsTourRunning(false);
    } catch (error) {
      console.error('Error resetting onboarding:', error);
      throw error;
    }
  }, []);


  return {
    isOnboardingComplete,
    isTourRunning,
    isLoading,
    startTour,
    stopTour,
    completeTour,
    resetTour,
    checkOnboardingStatus,
  };
};
