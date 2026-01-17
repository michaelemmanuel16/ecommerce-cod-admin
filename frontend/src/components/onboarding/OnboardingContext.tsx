import { createContext, useContext } from 'react';

export interface OnboardingContextValue {
    isOnboardingComplete: boolean;
    isTourRunning: boolean;
    isLoading: boolean;
    startTour: () => void;
    stopTour: () => void;
    completeTour: () => Promise<void>;
    resetTour: () => Promise<void>;
    checkOnboardingStatus: () => Promise<boolean>;
}

export const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

/**
 * Hook to access onboarding functionality
 *
 * @throws Error if used outside OnboardingProvider
 */
export const useOnboardingContext = (): OnboardingContextValue => {
    const context = useContext(OnboardingContext);
    if (context === undefined) {
        throw new Error('useOnboardingContext must be used within an OnboardingProvider');
    }
    return context;
};
