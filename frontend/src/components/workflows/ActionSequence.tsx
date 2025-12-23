import React from 'react';
import {
  User,
  Mail,
  MessageSquare,
  RefreshCw,
  Clock,
  Globe,
  Edit,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { WorkflowAction } from '../../pages/WorkflowWizard';
import { cn } from '../../utils/cn';

interface ActionSequenceProps {
  actions: WorkflowAction[];
  onEditAction: (actionId: string) => void;
  onRemoveAction: (actionId: string) => void;
}

const getActionIcon = (type: string) => {
  switch (type) {
    case 'assign_user':
      return <User className="w-5 h-5" />;
    case 'send_email':
      return <Mail className="w-5 h-5" />;
    case 'send_sms':
      return <MessageSquare className="w-5 h-5" />;
    case 'update_order':
      return <RefreshCw className="w-5 h-5" />;
    case 'wait':
      return <Clock className="w-5 h-5" />;
    case 'http_request':
      return <Globe className="w-5 h-5" />;
    default:
      return <RefreshCw className="w-5 h-5" />;
  }
};

const getActionLabel = (type: string) => {
  const labels: Record<string, string> = {
    assign_user: 'Assign User',
    send_email: 'Send Email',
    send_sms: 'Send SMS',
    update_order: 'Update Order',
    wait: 'Wait',
    http_request: 'HTTP Request',
  };
  return labels[type] || type;
};

const getActionSummary = (action: WorkflowAction): string => {
  switch (action.type) {
    case 'assign_user':
      const userType = action.config.userType || 'user';
      const mode = action.config.distributionMode || 'even';
      return `Assign to: ${userType} • Mode: ${mode === 'even' ? 'Round Robin' : mode}`;

    case 'send_email':
      const subject = action.config.subject || 'No subject';
      return `Subject: ${subject.substring(0, 50)}${subject.length > 50 ? '...' : ''}`;

    case 'send_sms':
      const message = action.config.message || 'No message';
      return `Message: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`;

    case 'update_order':
      const status = action.config.status || 'unspecified';
      return `New status: ${status}`;

    case 'wait':
      const duration = action.config.duration || '0';
      return `Wait for: ${duration} seconds`;

    case 'http_request':
      const url = action.config.url || 'No URL';
      return `URL: ${url.substring(0, 50)}${url.length > 50 ? '...' : ''}`;

    default:
      return 'No configuration';
  }
};

const getActionColor = (type: string) => {
  const colors: Record<string, { bg: string; text: string; icon: string }> = {
    assign_user: {
      bg: 'bg-purple-50',
      text: 'text-purple-900',
      icon: 'text-purple-600',
    },
    send_email: {
      bg: 'bg-blue-50',
      text: 'text-blue-900',
      icon: 'text-blue-600',
    },
    send_sms: {
      bg: 'bg-green-50',
      text: 'text-green-900',
      icon: 'text-green-600',
    },
    update_order: {
      bg: 'bg-orange-50',
      text: 'text-orange-900',
      icon: 'text-orange-600',
    },
    wait: {
      bg: 'bg-gray-50',
      text: 'text-gray-900',
      icon: 'text-gray-600',
    },
    http_request: {
      bg: 'bg-indigo-50',
      text: 'text-indigo-900',
      icon: 'text-indigo-600',
    },
  };
  return colors[type] || { bg: 'bg-gray-50', text: 'text-gray-900', icon: 'text-gray-600' };
};

export const ActionSequence: React.FC<ActionSequenceProps> = ({
  actions,
  onEditAction,
  onRemoveAction,
}) => {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {actions.map((action, index) => {
        const colors = getActionColor(action.type);

        return (
          <div key={action.id}>
            {/* Action Card */}
            <div
              className={cn(
                'relative rounded-lg border-2 border-gray-200 transition-all duration-200',
                'hover:shadow-md hover:border-blue-300'
              )}
            >
              {/* Main Action Content */}
              <div className="flex items-center p-4">
                {/* Step Number */}
                <div className="flex-shrink-0 mr-4">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 font-semibold text-sm">
                    {index + 1}
                  </div>
                </div>

                {/* Icon */}
                <div className="flex-shrink-0 mr-4">
                  <div
                    className={cn(
                      'flex items-center justify-center w-12 h-12 rounded-lg',
                      colors.bg,
                      colors.icon
                    )}
                  >
                    {getActionIcon(action.type)}
                  </div>
                </div>

                {/* Action Details */}
                <div className="flex-1 min-w-0">
                  <h4 className={cn('font-semibold mb-1', colors.text)}>
                    {getActionLabel(action.type)}
                  </h4>
                  <p className="text-sm text-gray-600 truncate">
                    {getActionSummary(action)}
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => onEditAction(action.id)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    title="Edit action"
                  >
                    <Edit className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => onRemoveAction(action.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                    title="Remove action"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Connector Arrow - Show between actions */}
            {index < actions.length - 1 && (
              <div className="flex justify-center py-2">
                <div className="flex flex-col items-center">
                  <ChevronDown className="w-6 h-6 text-gray-400" />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
