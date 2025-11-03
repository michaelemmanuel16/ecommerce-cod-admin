import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Play, Pause, Trash2, Edit, GitBranch, Zap, Clock, Sparkles } from 'lucide-react';
import { workflowsService, Workflow } from '../services/workflows.service';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { WorkflowTemplateGallery } from '../components/workflows/WorkflowTemplateGallery';

export const Workflows: React.FC = () => {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);

  useEffect(() => {
    loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      setIsLoading(true);
      const data = await workflowsService.getWorkflows();
      setWorkflows(data);
    } catch (error) {
      console.error('Failed to load workflows:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleWorkflow = async (id: string, currentStatus: boolean) => {
    try {
      await workflowsService.updateWorkflow(id, { isActive: !currentStatus });
      await loadWorkflows();
    } catch (error) {
      console.error('Failed to toggle workflow:', error);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) return;

    try {
      await workflowsService.deleteWorkflow(id);
      await loadWorkflows();
    } catch (error) {
      console.error('Failed to delete workflow:', error);
    }
  };

  const handleExecuteWorkflow = async (id: string) => {
    try {
      await workflowsService.executeWorkflow(id);
      alert('Workflow execution started successfully');
    } catch (error) {
      console.error('Failed to execute workflow:', error);
    }
  };

  const getTriggerTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      order_created: 'Order Created',
      order_status_changed: 'Order Status Changed',
      payment_received: 'Payment Received',
      manual: 'Manual Trigger',
      scheduled: 'Scheduled'
    };
    return labels[type] || type;
  };

  const getTriggerTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      order_created: 'bg-blue-100 text-blue-800',
      order_status_changed: 'bg-purple-100 text-purple-800',
      payment_received: 'bg-green-100 text-green-800',
      manual: 'bg-gray-100 text-gray-800',
      scheduled: 'bg-orange-100 text-orange-800'
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  const handleSelectTemplate = (template: any) => {
    console.log('Selected template:', template);
    // TODO: Navigate to workflow editor with template pre-filled
    navigate('/workflows/new', { state: { template } });
    setShowTemplateGallery(false);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workflow Automation</h1>
          <p className="text-gray-600 mt-1">Automate your business processes with custom workflows</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setShowTemplateGallery(true)}>
            <Sparkles className="w-4 h-4 mr-2" />
            Browse Templates
          </Button>
          <Button variant="primary" onClick={() => navigate('/workflows/new')}>
            <Plus className="w-4 h-4 mr-2" />
            Create Workflow
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Card>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading workflows...</p>
          </div>
        </Card>
      ) : workflows.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <GitBranch className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows yet</h3>
            <p className="text-gray-600 mb-6">
              Create your first workflow to automate order processing, notifications, and more.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="secondary" onClick={() => setShowTemplateGallery(true)}>
                <Sparkles className="w-4 h-4 mr-2" />
                Browse Templates
              </Button>
              <Button variant="primary" onClick={() => navigate('/workflows/new')}>
                <Plus className="w-4 h-4 mr-2" />
                Create From Scratch
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {workflows.map((workflow) => (
            <Card key={workflow.id} className="hover:shadow-lg transition-shadow">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{workflow.name}</h3>
                      <button
                        onClick={() => handleToggleWorkflow(workflow.id, workflow.isActive)}
                        className={`ml-3 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          workflow.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {workflow.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                    <p className="text-sm text-gray-600">{workflow.description}</p>
                  </div>
                </div>

                {/* Trigger Type */}
                <div className="mb-4">
                  <div className="flex items-center mb-2">
                    <Zap className="w-4 h-4 text-yellow-500 mr-2" />
                    <span className="text-xs font-medium text-gray-500">Trigger</span>
                  </div>
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getTriggerTypeColor(workflow.triggerType)}`}>
                    {getTriggerTypeLabel(workflow.triggerType)}
                  </span>
                </div>

                {/* Actions Count */}
                <div className="mb-4 pb-4 border-b border-gray-200">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center text-gray-600">
                      <GitBranch className="w-4 h-4 mr-2 text-blue-500" />
                      <span>Actions</span>
                    </div>
                    <span className="font-semibold text-gray-900">
                      {Array.isArray(workflow.actions) ? workflow.actions.length : 0}
                    </span>
                  </div>
                </div>

                {/* Metadata */}
                <div className="flex items-center text-xs text-gray-500 mb-4">
                  <Clock className="w-3 h-3 mr-1" />
                  <span>Updated {new Date(workflow.updatedAt).toLocaleDateString()}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleExecuteWorkflow(workflow.id)}
                    disabled={!workflow.isActive}
                    className="flex-1 flex items-center justify-center px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Execute
                  </button>
                  <button
                    onClick={() => navigate(`/workflows/${workflow.id}`)}
                    className="flex items-center justify-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteWorkflow(workflow.id)}
                    className="flex items-center justify-center px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Quick Info Section */}
      {!isLoading && workflows.length > 0 && (
        <Card className="mt-6">
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Workflow Statistics</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Workflows</p>
                <p className="text-2xl font-bold text-gray-900">{workflows.length}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Active Workflows</p>
                <p className="text-2xl font-bold text-green-600">
                  {workflows.filter(w => w.isActive).length}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Inactive Workflows</p>
                <p className="text-2xl font-bold text-gray-600">
                  {workflows.filter(w => !w.isActive).length}
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

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
