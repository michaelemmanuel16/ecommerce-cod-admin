import React, { useEffect, useState } from 'react';
import Joyride, { CallBackProps, STATUS, Step } from 'react-joyride';
import { useOnboardingContext } from './OnboardingProvider';
import { customerRepTourSteps, tourConfig } from './tourSteps.tsx';
import { useAuthStore } from '../../stores/authStore';
import { useLocation, useNavigate } from 'react-router-dom';
import './styles.css';

/**
 * CustomerRepOnboarding Component
 *
 * Renders the interactive onboarding tour using React Joyride.
 * Automatically triggers on first login for sales_rep users.
 * Can be manually restarted from the Help menu.
 *
 * Features:
 * - Auto-navigation between pages (Dashboard → Orders → Customers)
 * - Progress tracking (Step X of 11)
 * - Skippable at any time
 * - Saves completion status to backend
 */
export const CustomerRepOnboarding: React.FC = () => {
  const {
    isTourRunning,
    isOnboardingComplete,
    isLoading,
    stopTour,
    completeTour,
  } = useOnboardingContext();

  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  const [stepIndex, setStepIndex] = useState(0);
  const [steps, setSteps] = useState<Step[]>(customerRepTourSteps);
  const [isNavigating, setIsNavigating] = useState(false);

  // Only show tour for sales_rep role
  const isSalesRep = user?.role === 'sales_rep';

  /**
   * Handle Joyride callbacks
   */
  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, type, index, action } = data;

    console.log('[Onboarding] Joyride callback:', { status, type, index, action });

    // Handle tour completion or skip
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      if (status === STATUS.FINISHED) {
        // Tour completed successfully
        completeTour()
          .then(() => {
            console.log('[Onboarding] Tour completed successfully');
          })
          .catch((error) => {
            console.error('[Onboarding] Error completing tour:', error);
          });
      } else {
        // Tour was skipped
        stopTour();
      }
      setStepIndex(0);
      return;
    }

    // Update step index
    if (type === 'step:after') {
      setStepIndex(index + (action === 'next' ? 1 : -1));

      // Handle navigation between pages
      handlePageNavigation(index + 1);
    }
  };

  /**
   * Navigate to appropriate page based on tour step
   */
  const handlePageNavigation = (nextStepIndex: number) => {
    // Step 5: Navigate to Orders page
    if (nextStepIndex === 5 && location.pathname !== '/orders') {
      console.log('[Onboarding] Navigating to Orders page');
      setIsNavigating(true);
      setTimeout(() => navigate('/orders'), 300);
    }

    // Step 9: Navigate to Customers page
    if (nextStepIndex === 9 && location.pathname !== '/customers') {
      console.log('[Onboarding] Navigating to Customers page');
      setIsNavigating(true);
      setTimeout(() => navigate('/customers'), 300);
    }
  };

  /**
   * Update tour steps based on current page to highlight correct elements
   */
  useEffect(() => {
    // Filter steps based on which elements are actually present on the page
    // For now, we'll show all steps and let Joyride handle missing targets gracefully
    setSteps(customerRepTourSteps);
  }, [location.pathname]);

  /**
   * Resume tour after page navigation completes
   */
  useEffect(() => {
    if (isNavigating) {
      console.log('[Onboarding] Page changed, waiting for DOM to settle...');
      // Wait for the new page to render and DOM elements to be available
      const timer = setTimeout(() => {
        console.log('[Onboarding] Resuming tour after navigation');
        setIsNavigating(false);
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [location.pathname, isNavigating]);

  // Don't render anything if not a sales rep or still loading
  if (!isSalesRep || isLoading) {
    return null;
  }

  // Don't render if tour is not running
  if (!isTourRunning) {
    return null;
  }

  return (
    <Joyride
      steps={steps}
      run={isTourRunning && !isNavigating}
      stepIndex={stepIndex}
      callback={handleJoyrideCallback}
      continuous={tourConfig.continuous}
      showProgress={tourConfig.showProgress}
      showSkipButton={tourConfig.showSkipButton}
      disableOverlayClose={tourConfig.disableOverlayClose}
      disableCloseOnEsc={tourConfig.disableCloseOnEsc}
      spotlightClicks={tourConfig.spotlightClicks}
      styles={tourConfig.styles}
      locale={tourConfig.locale}
      scrollToFirstStep
      scrollOffset={100}
      disableScrolling={false}
    />
  );
};

/**
 * Welcome Modal Component
 *
 * Shows before the tour starts, giving users the option to start or skip.
 * Only appears on first login when onboarding is not complete.
 */
export const OnboardingWelcomeModal: React.FC = () => {
  const { isOnboardingComplete, isLoading, startTour } = useOnboardingContext();
  const { user } = useAuthStore();
  const [showModal, setShowModal] = useState(false);

  const isSalesRep = user?.role === 'sales_rep';

  useEffect(() => {
    // Show modal on first login (when not completed and user is sales rep)
    if (isSalesRep && !isOnboardingComplete && !isLoading) {
      // Delay showing modal slightly to let the dashboard load
      const timer = setTimeout(() => {
        setShowModal(true);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [isSalesRep, isOnboardingComplete, isLoading]);

  const handleStart = () => {
    setShowModal(false);
    startTour();
  };

  const handleSkip = () => {
    setShowModal(false);
  };

  if (!showModal) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col max-h-[90vh]">
        {/* Scrollable content area */}
        <div className="overflow-y-auto flex-1 p-6">
          <h2 className="text-2xl font-bold mb-3">Welcome to Your Dashboard!</h2>
          <p className="text-gray-600 mb-4">
            We've prepared a quick 2-3 minute tour to help you get started with the 4 main tasks you'll do every day:
          </p>
          <ul className="list-disc ml-6 space-y-1 mb-6 text-sm text-gray-700">
            <li>Creating new orders</li>
            <li>Following up on pending orders (your #1 priority!)</li>
            <li>Adding customers</li>
            <li>Updating order status</li>
          </ul>
          <p className="text-sm text-gray-500">
            You can skip the tour anytime or restart it later from the Help menu.
          </p>
        </div>

        {/* Fixed button footer */}
        <div className="flex gap-3 p-6 pt-4 border-t border-gray-200 flex-shrink-0">
          <button
            onClick={handleSkip}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Skip for Now
          </button>
          <button
            onClick={handleStart}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Start Tour
          </button>
        </div>
      </div>
    </div>
  );
};
