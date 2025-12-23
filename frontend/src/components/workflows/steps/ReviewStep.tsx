import React, { useState } from 'react';
import { CheckCircle, Edit, Play, Save, ChevronLeft, AlertCircle } from 'lucide-react';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { WorkflowFormData } from '../../../pages/WorkflowWizard';
import { ExecutionHistory } from '../ExecutionHistory';
import { workflowsService } from '../../../services/workflows.service';

interface ReviewStepProps {
  formData: WorkflowFormData;
  isEditMode: boolean;
  workflowId?: string;
  onEdit: (stepId: number) => void;
  onSave: (activate: boolean) => void;
  onBack: () => void;
  saving: boolean;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  formData,
  isEditMode,
  workflowId,
  onEdit,
  onSave,
  onBack,
  saving,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [executionRefreshTrigger, setExecutionRefreshTrigger] = useState(0);

  const handleTest = async () => {
    if (!isEditMode || !workflowId) {
      alert('Please save the workflow before testing');
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      await workflowsService.executeWorkflow(workflowId);
      setTestResult({
        success: true,
        message: 'Workflow executed successfully! Check execution history below for results.',
      });
      setExecutionRefreshTrigger((prev) => prev + 1);
    } catch (error: any) {
      setTestResult({
        success: false,
        message: error.message || 'Failed to execute workflow. Please check your configuration.',
      });
    } finally {
      setTesting(false);
    }
  };

  const getTriggerLabel = (type: string) => {
    return type.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
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

  const getActionSummary = (action: any): string => {
    switch (action.type) {
      case 'assign_user':
        return `${action.config.userType || 'user'} (${action.config.distributionMode || 'even'})`;
      case 'send_email':
        return action.config.subject || 'No subject';
      case 'send_sms':
        return action.config.message?.substring(0, 50) || 'No message';
      case 'update_order':
        return action.config.status || 'unspecified';
      case 'wait':
        return `${action.config.duration || 0} seconds`;
      case 'http_request':
        return `${action.config.method || 'GET'} ${action.config.url || ''}`;
      default:
        return 'Configured';
    }
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Review & Activate</h2>
        <p className="text-gray-600 mt-2">
          Review your workflow configuration before saving
        </p>
      </div>

      {/* Workflow Summary */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h3 className="text-xl font-bold text-gray-900">
                  {formData.name}
                </h3>
              </div>
              {formData.description && (
                <p className="text-gray-700">{formData.description}</p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    formData.isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full mr-2 ${
                      formData.isActive ? 'bg-green-600' : 'bg-gray-600'
                    }`}
                  />
                  {formData.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onEdit(1)}>
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </div>

          <div className="border-t border-blue-200 pt-6 space-y-6">
            {/* Trigger */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900 flex items-center">
                  <span className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center mr-3 text-sm font-bold">
                    1
                  </span>
                  WHEN
                </h4>
                <Button variant="ghost" size="sm" onClick={() => onEdit(2)}>
                  <Edit className="w-4 h-4" />
                </Button>
              </div>
              <div className="ml-11 bg-white rounded-lg p-4 border border-blue-200">
                <p className="text-gray-900 font-medium">
                  {getTriggerLabel(formData.triggerType)}
                </p>
                {formData.triggerConfig.schedule && (
                  <p className="text-sm text-gray-600 mt-1">
                    Schedule: {formData.triggerConfig.schedule}
                  </p>
                )}
                {formData.triggerConfig.targetStatus && (
                  <p className="text-sm text-gray-600 mt-1">
                    Target Status: {formData.triggerConfig.targetStatus}
                  </p>
                )}
              </div>
            </div>

            {/* Conditions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900 flex items-center">
                  <span className="w-8 h-8 bg-purple-500 text-white rounded-full flex items-center justify-center mr-3 text-sm font-bold">
                    2
                  </span>
                  IF
                </h4>
                <Button variant="ghost" size="sm" onClick={() => onEdit(3)}>
                  <Edit className="w-4 h-4" />
                </Button>
              </div>
              <div className="ml-11 bg-white rounded-lg p-4 border border-purple-200">
                {formData.conditions && formData.conditions.rules && formData.conditions.rules.length > 0 ? (
                  <div className="space-y-2">
                    {formData.conditions.rules.map((rule, index) => (
                      <p key={rule.id} className="text-sm text-gray-900">
                        {index > 0 && (
                          <span className="font-semibold text-purple-600 mr-2">
                            {formData.conditions?.logic}
                          </span>
                        )}
                        <span className="font-medium">{rule.field}</span>{' '}
                        <span className="text-gray-600">{rule.operator}</span>{' '}
                        <span className="font-medium">"{rule.value}"</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-600 italic">No conditions - runs for all events</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-gray-900 flex items-center">
                  <span className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center mr-3 text-sm font-bold">
                    3
                  </span>
                  THEN
                </h4>
                <Button variant="ghost" size="sm" onClick={() => onEdit(4)}>
                  <Edit className="w-4 h-4" />
                </Button>
              </div>
              <div className="ml-11 space-y-2">
                {formData.actions.map((action, index) => (
                  <div
                    key={action.id}
                    className="bg-white rounded-lg p-4 border border-green-200"
                  >
                    <div className="flex items-start">
                      <span className="flex-shrink-0 w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-xs font-semibold mr-3 mt-0.5">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {getActionLabel(action.type)}
                        </p>
                        <p className="text-sm text-gray-600 mt-1">
                          {getActionSummary(action)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Test Section */}
      {isEditMode && workflowId && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Test Workflow
          </h3>
          <p className="text-gray-600 mb-4">
            Test your workflow to ensure it works as expected before activating it.
          </p>

          <div className="flex items-center gap-3 mb-4">
            <Button
              variant="secondary"
              onClick={handleTest}
              disabled={testing}
            >
              <Play className="w-4 h-4 mr-2" />
              {testing ? 'Running Test...' : 'Run Test'}
            </Button>
          </div>

          {testResult && (
            <div
              className={`p-4 rounded-lg border ${
                testResult.success
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-start">
                {testResult.success ? (
                  <CheckCircle className="w-5 h-5 text-green-600 mr-3 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600 mr-3 mt-0.5" />
                )}
                <p
                  className={`text-sm ${
                    testResult.success ? 'text-green-800' : 'text-red-800'
                  }`}
                >
                  {testResult.message}
                </p>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Execution History */}
      {isEditMode && workflowId && (
        <ExecutionHistory
          workflowId={workflowId}
          refreshTrigger={executionRefreshTrigger}
        />
      )}

      {/* Validation Warning */}
      {formData.actions.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-yellow-600 mr-3 mt-0.5" />
            <div>
              <h4 className="font-medium text-yellow-900">Action Required</h4>
              <p className="text-sm text-yellow-800 mt-1">
                You must add at least one action before saving this workflow.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <Button variant="ghost" onClick={onBack}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          Back to Actions
        </Button>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => onSave(false)}
            disabled={saving || formData.actions.length === 0}
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save as Draft'}
          </Button>
          <Button
            variant="primary"
            onClick={() => onSave(true)}
            disabled={saving || formData.actions.length === 0}
            size="lg"
          >
            <CheckCircle className="w-5 h-5 mr-2" />
            {saving ? 'Saving...' : 'Save & Activate'}
          </Button>
        </div>
      </div>
    </div>
  );
};
