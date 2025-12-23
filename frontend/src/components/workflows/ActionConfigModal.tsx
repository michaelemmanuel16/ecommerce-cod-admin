import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { WorkflowAction } from '../../pages/WorkflowWizard';
import { AssignUserAction } from './actions/AssignUserAction';

interface ActionConfigModalProps {
  action: WorkflowAction;
  onSave: (config: any) => void;
  onClose: () => void;
}

export const ActionConfigModal: React.FC<ActionConfigModalProps> = ({
  action,
  onSave,
  onClose,
}) => {
  const [config, setConfig] = useState(action.config);

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const getActionTitle = (type: string) => {
    const titles: Record<string, string> = {
      assign_user: 'Configure User Assignment',
      send_email: 'Configure Email',
      send_sms: 'Configure SMS',
      update_order: 'Configure Order Update',
      wait: 'Configure Wait Time',
      http_request: 'Configure HTTP Request',
    };
    return titles[type] || 'Configure Action';
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">
              {getActionTitle(action.type)}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-6">
            {action.type === 'assign_user' && (
              <AssignUserAction
                config={config}
                onChange={(newConfig) => setConfig(newConfig)}
              />
            )}

            {action.type === 'send_email' && (
              <div className="space-y-4">
                <Input
                  label="Subject"
                  value={config.subject || ''}
                  onChange={(e) =>
                    setConfig({ ...config, subject: e.target.value })
                  }
                  placeholder="Order Confirmation"
                  required
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Body
                  </label>
                  <textarea
                    value={config.message || ''}
                    onChange={(e) =>
                      setConfig({ ...config, message: e.target.value })
                    }
                    placeholder="Hi {customerName}, your order #{orderNumber} has been confirmed..."
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Available variables: {'{customerName}'}, {'{orderNumber}'}, {'{totalAmount}'}, {'{orderStatus}'}
                  </p>
                </div>
              </div>
            )}

            {action.type === 'send_sms' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SMS Message
                  </label>
                  <textarea
                    value={config.message || ''}
                    onChange={(e) =>
                      setConfig({ ...config, message: e.target.value })
                    }
                    placeholder="Your order #{orderNumber} has been confirmed!"
                    rows={4}
                    maxLength={160}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    {(config.message || '').length}/160 characters •
                    Available variables: {'{customerName}'}, {'{orderNumber}'}, {'{totalAmount}'}
                  </p>
                </div>
              </div>
            )}

            {action.type === 'update_order' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    New Order Status
                  </label>
                  <select
                    value={config.status || ''}
                    onChange={(e) =>
                      setConfig({ ...config, status: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select status...</option>
                    <option value="pending_confirmation">Pending Confirmation</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="preparing">Preparing</option>
                    <option value="ready_for_pickup">Ready for Pickup</option>
                    <option value="out_for_delivery">Out for Delivery</option>
                    <option value="delivered">Delivered</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="returned">Returned</option>
                    <option value="failed_delivery">Failed Delivery</option>
                  </select>
                </div>
              </div>
            )}

            {action.type === 'wait' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Wait Duration (seconds)
                  </label>
                  <input
                    type="number"
                    value={config.duration || ''}
                    onChange={(e) =>
                      setConfig({ ...config, duration: parseInt(e.target.value) || 0 })
                    }
                    placeholder="60"
                    min="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    The workflow will pause for this duration before continuing to the next action
                  </p>
                </div>
              </div>
            )}

            {action.type === 'http_request' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    HTTP Method
                  </label>
                  <select
                    value={config.method || 'GET'}
                    onChange={(e) =>
                      setConfig({ ...config, method: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                </div>

                <Input
                  label="URL"
                  value={config.url || ''}
                  onChange={(e) =>
                    setConfig({ ...config, url: e.target.value })
                  }
                  placeholder="https://api.example.com/webhook"
                  required
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Request Body (JSON)
                  </label>
                  <textarea
                    value={config.body || ''}
                    onChange={(e) =>
                      setConfig({ ...config, body: e.target.value })
                    }
                    placeholder='{"orderId": "{orderNumber}", "status": "confirmed"}'
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Optional. Use variables like {'{orderNumber}'} in your JSON
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave}>
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
