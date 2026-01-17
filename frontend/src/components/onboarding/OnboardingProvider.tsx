import React, { ReactNode, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useOnboarding } from '../../hooks/useOnboarding';
import { OnboardingContext, OnboardingContextValue } from './OnboardingContext';

interface OnboardingProviderProps {
  children: ReactNode;
}

/**
 * OnboardingProvider
 *
 * Provides onboarding tour functionality to the entire app.
 * Only enables onboarding for users with the 'sales_rep' role.
 *
 * Usage:
 * Wrap your app with this provider:
 * <OnboardingProvider>
 *   <App />
 * </OnboardingProvider>
 *
 * Then use the hook in any component:
 * const { startTour, completeTour } = useOnboardingContext();
 */
export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({ children }) => {
  const { user, isAuthenticated } = useAuthStore();
  const onboarding = useOnboarding();

  const isSalesRep = user?.role === 'sales_rep';

  /**
   * Check onboarding status when user logs in or role changes
   */
  useEffect(() => {
    if (isAuthenticated && isSalesRep) {
      onboarding.checkOnboardingStatus();
    }
  }, [isAuthenticated, isSalesRep, onboarding.checkOnboardingStatus]);

  /**
   * Provide onboarding context only if user is a sales rep
   * For other roles, provide dummy values that disable the tour
   */
  const contextValue: OnboardingContextValue = isSalesRep
    ? onboarding
    : {
      isOnboardingComplete: true,
      isTourRunning: false,
      isLoading: false,
      startTour: () => { },
      stopTour: () => { },
      completeTour: async () => { },
      resetTour: async () => { },
      checkOnboardingStatus: async () => true,
    };

  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}
    </OnboardingContext.Provider>
  );
};

