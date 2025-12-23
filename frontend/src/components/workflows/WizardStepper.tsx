import React from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface Step {
  id: number;
  title: string;
  description?: string;
}

interface WizardStepperProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (stepId: number) => void;
}

export const WizardStepper: React.FC<WizardStepperProps> = ({
  steps,
  currentStep,
  onStepClick,
}) => {
  const getStepStatus = (stepId: number) => {
    if (stepId < currentStep) return 'completed';
    if (stepId === currentStep) return 'current';
    return 'upcoming';
  };

  return (
    <div className="w-full py-6">
      <nav aria-label="Progress">
        <ol className="flex items-center justify-between md:justify-center md:space-x-8">
          {steps.map((step, index) => {
            const status = getStepStatus(step.id);
            const isClickable = onStepClick && step.id < currentStep;

            return (
              <li
                key={step.id}
                className={cn(
                  'relative flex flex-col items-center',
                  index < steps.length - 1 ? 'flex-1 md:flex-initial' : ''
                )}
              >
                {/* Connector Line - Show between steps on desktop */}
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'absolute top-5 left-1/2 hidden h-0.5 w-full md:block',
                      'transform translate-x-1/2',
                      status === 'completed'
                        ? 'bg-blue-600'
                        : 'bg-gray-300'
                    )}
                    aria-hidden="true"
                  />
                )}

                {/* Step Button/Indicator */}
                <button
                  onClick={() => isClickable && onStepClick(step.id)}
                  disabled={!isClickable}
                  className={cn(
                    'relative z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all',
                    'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                    status === 'completed' &&
                      'border-blue-600 bg-blue-600 text-white hover:bg-blue-700',
                    status === 'current' &&
                      'border-blue-600 bg-white text-blue-600',
                    status === 'upcoming' && 'border-gray-300 bg-white text-gray-400',
                    isClickable && 'cursor-pointer hover:scale-105',
                    !isClickable && status !== 'current' && 'cursor-default'
                  )}
                  aria-current={status === 'current' ? 'step' : undefined}
                  aria-label={`Step ${step.id}: ${step.title}`}
                >
                  {status === 'completed' ? (
                    <Check className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        status === 'current' && 'text-blue-600',
                        status === 'upcoming' && 'text-gray-400'
                      )}
                    >
                      {step.id}
                    </span>
                  )}
                </button>

                {/* Step Label */}
                <div className="mt-2 text-center">
                  <p
                    className={cn(
                      'text-xs md:text-sm font-medium',
                      status === 'current' && 'text-blue-600',
                      status === 'completed' && 'text-gray-900',
                      status === 'upcoming' && 'text-gray-500'
                    )}
                  >
                    {step.title}
                  </p>
                  {step.description && (
                    <p className="hidden md:block text-xs text-gray-500 mt-1 max-w-[80px]">
                      {step.description}
                    </p>
                  )}
                </div>

                {/* Mobile Connector - Show as dots below on mobile */}
                {index < steps.length - 1 && (
                  <div
                    className={cn(
                      'absolute top-5 left-full h-0.5 w-full md:hidden',
                      status === 'completed' ? 'bg-blue-600' : 'bg-gray-300'
                    )}
                    aria-hidden="true"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
};
