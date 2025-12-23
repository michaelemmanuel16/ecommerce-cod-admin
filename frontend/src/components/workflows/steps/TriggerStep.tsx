import React from 'react';
import { ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { TriggerSelector } from '../TriggerSelector';
import { WorkflowFormData } from '../../../pages/WorkflowWizard';

interface TriggerStepProps {
  formData: WorkflowFormData;
  onUpdate: (updates: Partial<WorkflowFormData>) => void;
  onNext: () => void;
  onBack: () => void;
}

const triggerUseCases: Record<string, string[]> = {
  order_created: [
    'Auto-assign orders to sales reps',
    'Send confirmation emails/SMS',
    'Update inventory systems',
    'Create delivery tasks automatically',
  ],
  status_change: [
    'Notify customers of order status updates',
    'Trigger shipment when order is confirmed',
    'Send delivery agent assignments',
    'Update analytics and reporting',
  ],
  payment_received: [
    'Send payment confirmation',
    'Release order for processing',
    'Update accounting systems',
    'Trigger fulfillment workflow',
  ],
  time_based: [
    'Daily sales reports',
    'Weekly inventory checks',
    'Monthly customer summaries',
    'Scheduled data backups',
  ],
  manual: [
    'Bulk order processing',
    'Manual quality checks',
    'Admin-triggered operations',
    'Testing and debugging',
  ],
  webhook: [
    'Integration with external systems',
    'Payment gateway notifications',
    'Third-party app triggers',
    'Custom API integrations',
  ],
};

const triggerDescriptions: Record<string, string> = {
  order_created: 'This workflow will run automatically whenever a new order is created in your system.',
  status_change: 'This workflow triggers when an order status changes (e.g., pending → confirmed → delivered).',
  payment_received: 'This workflow runs when payment for an order is confirmed and recorded.',
  time_based: 'This workflow executes on a schedule using cron expressions (e.g., daily at 9 AM).',
  manual: 'This workflow runs only when manually triggered by an admin or via API call.',
  webhook: 'This workflow triggers when an external system sends a webhook notification to your API.',
};

export const TriggerStep: React.FC<TriggerStepProps> = ({
  formData,
  onUpdate,
  onNext,
  onBack,
}) => {
  const selectedUseCases = triggerUseCases[formData.triggerType] || [];
  const selectedDescription = triggerDescriptions[formData.triggerType] || '';

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">When should this workflow run?</h2>
        <p className="text-gray-600 mt-2">
          Choose a trigger event that will start your workflow automatically
        </p>
      </div>

      {/* Trigger Selector */}
      <Card>
        <TriggerSelector
          selectedTrigger={formData.triggerType}
          onSelectTrigger={(type) => onUpdate({ triggerType: type })}
          config={formData.triggerConfig}
          onConfigChange={(config) => onUpdate({ triggerConfig: config })}
        />
      </Card>

      {/* Selected Trigger Details */}
      {formData.triggerType && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <div className="space-y-4">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Selected Trigger: {formData.triggerType.split('_').map(word =>
                    word.charAt(0).toUpperCase() + word.slice(1)
                  ).join(' ')}
                </h3>
                <p className="text-gray-700 mb-4">
                  {selectedDescription}
                </p>

                {selectedUseCases.length > 0 && (
                  <div>
                    <div className="flex items-center text-sm font-medium text-gray-900 mb-2">
                      <Lightbulb className="w-4 h-4 mr-2 text-yellow-500" />
                      Common use cases:
                    </div>
                    <ul className="space-y-1.5">
                      {selectedUseCases.map((useCase, index) => (
                        <li key={index} className="flex items-start text-sm text-gray-700">
                          <svg
                            className="w-5 h-5 mr-2 text-green-500 flex-shrink-0 mt-0.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          {useCase}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Additional Configuration (for specific trigger types) */}
      {formData.triggerType === 'time_based' && (
        <Card>
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Schedule Configuration</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Cron Expression
              </label>
              <input
                type="text"
                value={formData.triggerConfig.schedule || ''}
                onChange={(e) =>
                  onUpdate({
                    triggerConfig: { ...formData.triggerConfig, schedule: e.target.value },
                  })
                }
                placeholder="0 9 * * * (Every day at 9 AM)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">
                Use cron syntax. Example: "0 9 * * *" runs daily at 9:00 AM
              </p>
            </div>
          </div>
        </Card>
      )}

      {formData.triggerType === 'status_change' && (
        <Card>
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Status Change Configuration</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Trigger on specific status
              </label>
              <select
                value={formData.triggerConfig.targetStatus || ''}
                onChange={(e) =>
                  onUpdate({
                    triggerConfig: { ...formData.triggerConfig, targetStatus: e.target.value },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Any status change</option>
                <option value="confirmed">Confirmed</option>
                <option value="preparing">Preparing</option>
                <option value="ready_for_pickup">Ready for Pickup</option>
                <option value="out_for_delivery">Out for Delivery</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <p className="text-xs text-gray-500 mt-2">
                Leave empty to trigger on any status change
              </p>
            </div>
          </div>
        </Card>
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
              In the next step, you can optionally add conditions to filter when this workflow should execute
              (e.g., only for orders over $100 or specific product types).
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          Back to Basic Info
        </Button>
        <Button
          variant="primary"
          onClick={onNext}
          size="lg"
          className="min-w-[200px]"
        >
          Next: Add Conditions
          <ChevronRight className="w-5 h-5 ml-2" />
        </Button>
      </div>
    </div>
  );
};
