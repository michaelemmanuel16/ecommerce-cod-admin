import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ArrowLeft, Play, Save, Sparkles } from 'lucide-react';
import { workflowsService, Workflow } from '../services/workflows.service';
import { TriggerSelector } from '../components/workflows/TriggerSelector';
import { ConditionBuilder, ConditionGroup } from '../components/workflows/ConditionBuilder';
import { AssignUserAction, UserAssignment } from '../components/workflows/actions/AssignUserAction';
import { WorkflowTemplateGallery } from '../components/workflows/WorkflowTemplateGallery';
import { ExecutionHistory } from '../components/workflows/ExecutionHistory';

interface WorkflowAction {
  id: string;
  type: string;
  config: any;
  conditions?: ConditionGroup;
}

export const WorkflowEditor: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const isEditMode = id && id !== 'new';

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [executionRefreshTrigger, setExecutionRefreshTrigger] = useState(0);

  // Workflow basic info
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Trigger
  const [triggerType, setTriggerType] = useState<string>('order_created');
  const [triggerConfig, setTriggerConfig] = useState<any>({});

  // Conditions
  const [conditions, setConditions] = useState<ConditionGroup | undefined>(undefined);

  // Actions
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [showActionSelector, setShowActionSelector] = useState(false);

  useEffect(() => {
    if (isEditMode) {
      loadWorkflow();
    }

    // Check if template was passed from workflows page
    if (location.state?.template) {
      loadTemplate(location.state.template);
    }
  }, [id]);

  const loadWorkflow = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await workflowsService.getWorkflow(id);
      setWorkflowName(data.name || '');
      setWorkflowDescription(data.description || '');
      setIsActive(data.isActive !== undefined ? data.isActive : true);
      setTriggerType(data.triggerType || 'order_created');
      setTriggerConfig(data.triggerData || {});
      setConditions(data.conditions);
      setActions(Array.isArray(data.actions) ? data.actions : []);
    } catch (error) {
      console.error('Error loading workflow:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = (template: any) => {
    setWorkflowName(template.name || '');
    setWorkflowDescription(template.description || '');
    setTriggerType(template.trigger?.type || 'order_created');
    setTriggerConfig(template.trigger?.config || {});
    setConditions(template.conditions);
    setActions(template.actions || []);
  };

  const handleSelectTemplate = (template: any) => {
    loadTemplate(template);
    setShowTemplateGallery(false);
  };

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
    setActions([...actions, newAction]);
    setShowActionSelector(false);
  };

  const handleUpdateAction = (actionId: string, config: any, conditions?: ConditionGroup) => {
    setActions(
      actions.map((action) =>
        action.id === actionId
          ? { ...action, config, conditions }
          : action
      )
    );
  };

  const handleRemoveAction = (actionId: string) => {
    setActions(actions.filter((a) => a.id !== actionId));
  };

  const handleSave = async () => {
    if (!workflowName.trim()) {
      alert('Please enter a workflow name');
      return;
    }

    setSaving(true);
    try {
      const workflowData = {
        name: workflowName,
        description: workflowDescription,
        triggerType: triggerType as any,
        triggerData: triggerConfig,
        conditions,
        actions,
        isActive,
      };

      if (isEditMode && id) {
        await workflowsService.updateWorkflow(id, workflowData);
      } else {
        await workflowsService.createWorkflow(workflowData);
      }

      navigate('/workflows');
    } catch (error) {
      console.error('Error saving workflow:', error);
      alert('Failed to save workflow. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!isEditMode || !id) {
      alert('Please save the workflow first before testing');
      return;
    }
    try {
      await workflowsService.executeWorkflow(id);
      alert('Workflow execution started! Check execution history below for results.');
      // Trigger execution history refresh
      setExecutionRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error('Error executing workflow:', error);
      alert('Error executing workflow. Check console for details.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-8">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/workflows')}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Workflows
        </Button>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">
            {isEditMode ? 'Edit Workflow' : 'Create New Workflow'}
          </h1>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setShowTemplateGallery(true)}>
              <Sparkles className="w-4 h-4 mr-2" />
              Browse Templates
            </Button>
            {isEditMode && (
              <Button variant="ghost" onClick={handleTest}>
                <Play className="w-4 h-4 mr-2" />
                Test
              </Button>
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />
              {saving ? 'Saving...' : 'Save Workflow'}
            </Button>
          </div>
        </div>
      </div>

      {/* Basic Information */}
      <Card className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h2>
        <div className="space-y-4">
          <Input
            label="Workflow Name"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            placeholder="e.g., Assign orders by product type"
            required
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={workflowDescription}
              onChange={(e) => setWorkflowDescription(e.target.value)}
              placeholder="Describe what this workflow does..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
              Active (workflow will run automatically)
            </label>
          </div>
        </div>
      </Card>

      {/* Trigger Selection */}
      <Card className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">When should this workflow run?</h2>
        <TriggerSelector
          selectedTrigger={triggerType}
          onSelectTrigger={(type) => setTriggerType(type)}
          config={triggerConfig}
          onConfigChange={(config) => setTriggerConfig(config)}
        />
      </Card>

      {/* Conditions (Optional) */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Conditions (Optional)</h2>
            <p className="text-sm text-gray-600 mt-1">
              Add conditions to control when this workflow should run
            </p>
          </div>
        </div>
        <ConditionBuilder
          conditions={conditions}
          onChange={(newConditions) => setConditions(newConditions)}
        />
      </Card>

      {/* Actions */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Actions</h2>
            <p className="text-sm text-gray-600 mt-1">
              Define what happens when this workflow runs
            </p>
          </div>
        </div>

        {actions.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <p className="text-gray-600 mb-4">No actions added yet</p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button
                variant="primary"
                onClick={() => handleAddAction('assign_user')}
              >
                Assign User
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleAddAction('send_sms')}
              >
                Send SMS
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleAddAction('send_email')}
              >
                Send Email
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleAddAction('update_order')}
              >
                Update Order
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {actions.map((action, index) => (
              <div key={action.id} className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span className="font-medium text-gray-900">
                      {action.type === 'assign_user' && 'Assign User'}
                      {action.type === 'send_sms' && 'Send SMS'}
                      {action.type === 'send_email' && 'Send Email'}
                      {action.type === 'update_order' && 'Update Order'}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveAction(action.id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                </div>

                {action.type === 'assign_user' && (
                  <AssignUserAction
                    config={action.config}
                    onChange={(config) => handleUpdateAction(action.id, config, action.conditions)}
                  />
                )}

                {action.type === 'send_sms' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Message
                      </label>
                      <textarea
                        value={action.config.message || ''}
                        onChange={(e) =>
                          handleUpdateAction(action.id, { ...action.config, message: e.target.value }, action.conditions)
                        }
                        placeholder="Your order has been confirmed!"
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        You can use variables: {'{orderNumber}'}, {'{customerName}'}, {'{totalAmount}'}
                      </p>
                    </div>
                  </div>
                )}

                {action.type === 'send_email' && (
                  <div className="space-y-3">
                    <Input
                      label="Subject"
                      value={action.config.subject || ''}
                      onChange={(e) =>
                        handleUpdateAction(action.id, { ...action.config, subject: e.target.value }, action.conditions)
                      }
                      placeholder="Order Confirmation"
                    />
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Message
                      </label>
                      <textarea
                        value={action.config.message || ''}
                        onChange={(e) =>
                          handleUpdateAction(action.id, { ...action.config, message: e.target.value }, action.conditions)
                        }
                        placeholder="Email body..."
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                )}

                {action.type === 'update_order' && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        New Status
                      </label>
                      <select
                        value={action.config.status || ''}
                        onChange={(e) =>
                          handleUpdateAction(action.id, { ...action.config, status: e.target.value }, action.conditions)
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
              </div>
            ))}

            <Button
              variant="ghost"
              onClick={() => setShowActionSelector(!showActionSelector)}
              className="w-full border-2 border-dashed border-gray-300"
            >
              + Add Another Action
            </Button>

            {showActionSelector && (
              <div className="flex gap-3 flex-wrap p-4 bg-gray-50 rounded-lg">
                <Button variant="primary" onClick={() => handleAddAction('assign_user')}>
                  Assign User
                </Button>
                <Button variant="secondary" onClick={() => handleAddAction('send_sms')}>
                  Send SMS
                </Button>
                <Button variant="secondary" onClick={() => handleAddAction('send_email')}>
                  Send Email
                </Button>
                <Button variant="secondary" onClick={() => handleAddAction('update_order')}>
                  Update Order
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Execution History - Only show in edit mode */}
      {isEditMode && id && (
        <div className="mb-6">
          <ExecutionHistory
            workflowId={id}
            refreshTrigger={executionRefreshTrigger}
          />
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={() => navigate('/workflows')}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : isEditMode ? 'Update Workflow' : 'Create Workflow'}
        </Button>
      </div>

      {/* Template Gallery Modal */}
      {showTemplateGallery && (
        <WorkflowTemplateGallery
          onSelectTemplate={handleSelectTemplate}
          onClose={() => setShowTemplateGallery(false)}
        />
      )}
    </div>
  );
};
