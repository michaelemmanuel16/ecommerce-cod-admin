import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, User, Mail, MessageSquare, RefreshCw, Clock, Globe } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { ActionSequence } from '../ActionSequence';
import { ActionConfigModal } from '../ActionConfigModal';
import { WorkflowFormData, WorkflowAction } from '../../../pages/WorkflowWizard';

interface ActionsStepProps {
  formData: WorkflowFormData;
  onUpdate: (updates: Partial<WorkflowFormData>) => void;
}

interface ActionType {
  type: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const actionTypes: ActionType[] = [
  {
    type: 'assign_user',
    label: 'Assign User',
    description: 'Assign orders to sales reps or delivery agents',
    icon: <User className="w-5 h-5" />,
    color: 'from-purple-500 to-purple-600',
  },
  {
    type: 'send_email',
    label: 'Send Email',
    description: 'Send email notifications to customers',
    icon: <Mail className="w-5 h-5" />,
    color: 'from-blue-500 to-blue-600',
  },
  {
    type: 'send_sms',
    label: 'Send SMS',
    description: 'Send SMS notifications to customers',
    icon: <MessageSquare className="w-5 h-5" />,
    color: 'from-green-500 to-green-600',
  },
  {
    type: 'update_order',
    label: 'Update Order',
    description: 'Change order status or properties',
    icon: <RefreshCw className="w-5 h-5" />,
    color: 'from-orange-500 to-orange-600',
  },
  {
    type: 'wait',
    label: 'Wait',
    description: 'Pause workflow for a specified duration',
    icon: <Clock className="w-5 h-5" />,
    color: 'from-gray-500 to-gray-600',
  },
  {
    type: 'http_request',
    label: 'HTTP Request',
    description: 'Make API calls to external systems',
    icon: <Globe className="w-5 h-5" />,
    color: 'from-indigo-500 to-indigo-600',
  },
];

export const ActionsStep: React.FC<ActionsStepProps> = ({
  formData,
  onUpdate,
}) => {
  const [editingAction, setEditingAction] = useState<WorkflowAction | null>(null);
  const [showActionPalette, setShowActionPalette] = useState(false);

  const handleAddAction = (actionType: string) => {
    let defaultConfig: any = {};

    // Initialize config based on action type
    if (actionType === 'assign_user') {
      defaultConfig = {
        userType: 'sales_rep',
        assignments: [],
        distributionMode: 'even',
        onlyUnassigned: true,
      };
    }

    const newAction: WorkflowAction = {
      id: `action-${Date.now()}`,
      type: actionType,
      config: defaultConfig,
    };

    onUpdate({ actions: [...formData.actions, newAction] });
    setShowActionPalette(false);

    // Auto-open editor for new action
    setEditingAction(newAction);
  };

  const handleEditAction = (actionId: string) => {
    const action = formData.actions.find((a) => a.id === actionId);
    if (action) {
      setEditingAction(action);
    }
  };

  const handleSaveAction = (actionId: string, config: any) => {
    onUpdate({
      actions: formData.actions.map((action) =>
        action.id === actionId ? { ...action, config } : action
      ),
    });
  };

  const handleRemoveAction = (actionId: string) => {
    if (confirm('Are you sure you want to remove this action?')) {
      onUpdate({
        actions: formData.actions.filter((a) => a.id !== actionId),
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">What should happen?</h2>
        <p className="text-gray-600 mt-2">
          Define the actions that execute when your workflow runs
        </p>
      </div>

      {/* Actions List */}
      {formData.actions.length === 0 ? (
        <Card className="text-center py-12 bg-gradient-to-br from-gray-50 to-blue-50 border-2 border-dashed border-gray-300">
          <div className="max-w-md mx-auto">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <RefreshCw className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No actions added yet
            </h3>
            <p className="text-gray-600 mb-6">
              Add at least one action to define what happens when this workflow runs
            </p>
            <Button
              variant="primary"
              onClick={() => setShowActionPalette(true)}
              size="lg"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Your First Action
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Action Sequence
            </h3>
            <p className="text-sm text-gray-600">
              Actions execute in order from top to bottom
            </p>
          </div>

          <ActionSequence
            actions={formData.actions}
            onEditAction={handleEditAction}
            onRemoveAction={handleRemoveAction}
          />

          {/* Add Action Button */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <Button
              variant="ghost"
              onClick={() => setShowActionPalette(true)}
              className="w-full border-2 border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Another Action
            </Button>
          </div>
        </Card>
      )}

      {/* Action Palette */}
      {showActionPalette && (
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Choose an Action
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Select the type of action you want to add
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {actionTypes.map((actionType) => (
              <button
                key={actionType.type}
                onClick={() => handleAddAction(actionType.type)}
                className="group relative p-4 bg-white rounded-lg border-2 border-gray-200 hover:border-blue-500 hover:shadow-lg transition-all duration-200 text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div
                  className={`w-12 h-12 rounded-lg bg-gradient-to-br ${actionType.color} flex items-center justify-center text-white mb-3 group-hover:scale-110 transition-transform`}
                >
                  {actionType.icon}
                </div>
                <h4 className="font-semibold text-gray-900 mb-1">
                  {actionType.label}
                </h4>
                <p className="text-sm text-gray-600">
                  {actionType.description}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="ghost"
              onClick={() => setShowActionPalette(false)}
            >
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg
              className="h-5 w-5 text-blue-400"
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
            <h3 className="text-sm font-medium text-blue-800">
              Pro Tips
            </h3>
            <ul className="mt-2 text-sm text-blue-700 space-y-1">
              <li>• Actions execute sequentially from top to bottom</li>
              <li>• Use the "Wait" action to add delays between steps</li>
              <li>• Variables like {'{orderNumber}'} are automatically replaced</li>
              <li>• You can edit or reorder actions anytime</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Action Config Modal */}
      {editingAction && (
        <ActionConfigModal
          action={editingAction}
          onSave={(config) => {
            handleSaveAction(editingAction.id, config);
            setEditingAction(null);
          }}
          onClose={() => setEditingAction(null)}
        />
      )}


    </div>
  );
};
