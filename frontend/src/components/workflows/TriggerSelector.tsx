import React from 'react';
import { Clock, Webhook, Activity, Play, RefreshCw } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface TriggerType {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  value: string;
}

const triggerTypes: TriggerType[] = [
  {
    id: 'order_created',
    value: 'order_created',
    label: 'Order Created',
    description: 'Trigger when a new order is created',
    icon: <Activity className="w-6 h-6" />,
  },
  {
    id: 'status_change',
    value: 'status_change',
    label: 'Order Status Changed',
    description: 'Trigger when order status changes',
    icon: <RefreshCw className="w-6 h-6" />,
  },
  {
    id: 'payment_received',
    value: 'payment_received',
    label: 'Payment Received',
    description: 'Trigger when payment is confirmed',
    icon: <Activity className="w-6 h-6" />,
  },
  {
    id: 'time_based',
    value: 'time_based',
    label: 'Time-Based',
    description: 'Trigger on a schedule (cron)',
    icon: <Clock className="w-6 h-6" />,
  },
  {
    id: 'manual',
    value: 'manual',
    label: 'Manual',
    description: 'Trigger manually or via API',
    icon: <Play className="w-6 h-6" />,
  },
  {
    id: 'webhook',
    value: 'webhook',
    label: 'Webhook',
    description: 'Trigger from external webhook',
    icon: <Webhook className="w-6 h-6" />,
  },
];

interface TriggerSelectorProps {
  selectedTrigger?: string;
  onSelectTrigger: (triggerId: string) => void;
  config?: any;
  onConfigChange?: (config: any) => void;
}

export const TriggerSelector: React.FC<TriggerSelectorProps> = ({
  selectedTrigger,
  onSelectTrigger,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Select Workflow Trigger
        </h3>
        <p className="text-sm text-gray-600">
          Choose what event will start this workflow
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {triggerTypes.map((trigger) => (
          <button
            key={trigger.id}
            onClick={() => onSelectTrigger(trigger.value)}
            className={cn(
              'relative p-6 rounded-lg border-2 transition-all duration-200 text-left',
              'hover:shadow-lg hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500',
              selectedTrigger === trigger.value
                ? 'border-blue-500 bg-blue-50 shadow-md'
                : 'border-gray-200 bg-white hover:border-blue-300'
            )}
          >
            {selectedTrigger === trigger.value && (
              <div className="absolute top-3 right-3">
                <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center">
                  <svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path d="M5 13l4 4L19 7"></path>
                  </svg>
                </div>
              </div>
            )}

            <div
              className={cn(
                'w-12 h-12 rounded-lg mb-4 flex items-center justify-center',
                selectedTrigger === trigger.value
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600'
              )}
            >
              {trigger.icon}
            </div>

            <h4 className="font-semibold text-gray-900 mb-2">
              {trigger.label}
            </h4>
            <p className="text-sm text-gray-600">{trigger.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
};
