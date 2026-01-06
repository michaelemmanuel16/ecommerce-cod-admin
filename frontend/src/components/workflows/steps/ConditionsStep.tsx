import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { ConditionBuilder, ConditionGroup } from '../ConditionBuilder';
import { WorkflowFormData } from '../../../pages/WorkflowWizard';
import { cn } from '../../../utils/cn';

interface ConditionsStepProps {
  formData: WorkflowFormData;
  onUpdate: (updates: Partial<WorkflowFormData>) => void;
}

export const ConditionsStep: React.FC<ConditionsStepProps> = ({
  formData,
  onUpdate,
}) => {
  const [skipConditions, setSkipConditions] = useState(
    !formData.conditions || !formData.conditions.rules || formData.conditions.rules.length === 0
  );

  const handleSkipChange = (skip: boolean) => {
    setSkipConditions(skip);
    if (skip) {
      onUpdate({ conditions: undefined });
    }
  };

  const handleConditionsChange = (conditions?: ConditionGroup) => {
    onUpdate({ conditions });
    if (conditions && conditions.rules && conditions.rules.length > 0) {
      setSkipConditions(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Add Conditions (Optional)</h2>
        <p className="text-gray-600 mt-2">
          Add rules to control when this workflow should execute
        </p>
      </div>

      {/* Skip Option Card */}
      <Card className="bg-gradient-to-r from-gray-50 to-gray-100">
        <div className="space-y-4">
          <h3 className="font-semibold text-gray-900">Do you need conditions?</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Skip Conditions Option */}
            <button
              onClick={() => handleSkipChange(true)}
              className={cn(
                'p-4 rounded-lg border-2 transition-all duration-200 text-left',
                'focus:outline-none focus:ring-2 focus:ring-blue-500',
                skipConditions
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-300 bg-white hover:border-blue-300'
              )}
            >
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-1">
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      skipConditions
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-300'
                    )}
                  >
                    {skipConditions && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M5 13l4 4L19 7"></path>
                      </svg>
                    )}
                  </div>
                </div>
                <div className="ml-3">
                  <h4 className="font-medium text-gray-900 mb-1">
                    No conditions needed
                  </h4>
                  <p className="text-sm text-gray-600">
                    Run for all {formData.triggerType.replace('_', ' ')} events
                  </p>
                </div>
              </div>
            </button>

            {/* Add Conditions Option */}
            <button
              onClick={() => handleSkipChange(false)}
              className={cn(
                'p-4 rounded-lg border-2 transition-all duration-200 text-left',
                'focus:outline-none focus:ring-2 focus:ring-blue-500',
                !skipConditions
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-300 bg-white hover:border-blue-300'
              )}
            >
              <div className="flex items-start">
                <div className="flex-shrink-0 mt-1">
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center',
                      !skipConditions
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-300'
                    )}
                  >
                    {!skipConditions && (
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M5 13l4 4L19 7"></path>
                      </svg>
                    )}
                  </div>
                </div>
                <div className="ml-3">
                  <h4 className="font-medium text-gray-900 mb-1">
                    Add conditions
                  </h4>
                  <p className="text-sm text-gray-600">
                    Filter by order amount, product type, etc.
                  </p>
                </div>
              </div>
            </button>
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start">
            <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="ml-3">
              <p className="text-sm text-blue-800">
                <strong>Tip:</strong> Conditions are optional but recommended for targeted workflows.
                Without conditions, the workflow will run for every {formData.triggerType.replace('_', ' ')} event.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Condition Builder - Only show if not skipped */}
      {!skipConditions && (
        <Card>
          <ConditionBuilder
            conditions={formData.conditions}
            onChange={handleConditionsChange}
          />
        </Card>
      )}

      {/* Examples Section */}
      {!skipConditions && (
        <Card className="bg-gray-50 border-gray-200">
          <div className="space-y-3">
            <h3 className="font-semibold text-gray-900 flex items-center">
              <svg
                className="w-5 h-5 mr-2 text-yellow-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Example Conditions
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-start">
                <span className="text-gray-600 mr-2">•</span>
                <span className="text-gray-700">
                  <strong>Premium orders:</strong> Order Total {">"} 100 AND Product Name contains "Premium"
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-gray-600 mr-2">•</span>
                <span className="text-gray-700">
                  <strong>Specific regions:</strong> State equals "California" OR State equals "Texas"
                </span>
              </div>
              <div className="flex items-start">
                <span className="text-gray-600 mr-2">•</span>
                <span className="text-gray-700">
                  <strong>High-value bulk:</strong> Order Total {">"} 500 AND Item Count {">"} 10
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Summary if skipped */}
      {skipConditions && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800">
                No conditions set
              </h3>
              <p className="mt-1 text-sm text-yellow-700">
                This workflow will execute for <strong>all</strong> {formData.triggerType.replace('_', ' ')} events.
                You can add conditions later if needed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Help Section */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-gray-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-gray-900">
              What's next?
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              In the next step, you'll define what actions should happen when this workflow runs
              (e.g., send email, assign user, update order status).
            </p>
          </div>
        </div>
      </div>


    </div>
  );
};
