import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Play, Pause, Trash2, Edit, GitBranch, Zap, Clock, Sparkles, Search, Loader2 } from 'lucide-react';
import { workflowsService, Workflow } from '../services/workflows.service';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { WorkflowTemplateGallery } from '../components/workflows/WorkflowTemplateGallery';
import { getSocket } from '../services/socket';
import toast from 'react-hot-toast';

export const Workflows: React.FC = () => {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [executingIds, setExecutingIds] = useState<Set<string>>(new Set());
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadWorkflows();

    // Listen for real-time execution updates
    const socket = getSocket();
    if (socket) {
      const handleStarted = (data: { workflowId: string }) => {
        setRunningIds(prev => new Set(prev).add(String(data.workflowId)));
      };
      const handleCompleted = (data: { workflowId: string }) => {
        setRunningIds(prev => {
          const next = new Set(prev);
          next.delete(String(data.workflowId));
          return next;
        });
      };

      socket.on('workflow:execution_started', handleStarted);
      socket.on('workflow:execution_completed', handleCompleted);

      return () => {
        socket.off('workflow:execution_started', handleStarted);
        socket.off('workflow:execution_completed', handleCompleted);
      };
    }
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
      setExecutingIds(prev => new Set(prev).add(id));
      await workflowsService.executeWorkflow(id);
      toast.success('Workflow execution requested');
    } catch (error: any) {
      console.error('Failed to execute workflow:', error);
      toast.error(error.response?.data?.message || error.message || 'Failed to execute workflow');
    } finally {
      setExecutingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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

  // Filter workflows based on search query
  const filteredWorkflows = workflows.filter((workflow) => {
    const query = searchQuery.toLowerCase();
    return (
      workflow.name.toLowerCase().includes(query) ||
      (workflow.description && workflow.description.toLowerCase().includes(query))
    );
  });

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

      {/* Search Bar */}
      <Card className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search workflows by name or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading workflows...</p>
          </div>
        </Card>
      ) : filteredWorkflows.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <GitBranch className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery ? 'No workflows found' : 'No workflows yet'}
            </h3>
            <p className="text-gray-600 mb-6">
              {searchQuery
                ? 'Try adjusting your search terms or clear the search to see all workflows.'
                : 'Create your first workflow to automate order processing, notifications, and more.'}
            </p>
            {!searchQuery && (
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
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Workflow Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Trigger Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Updated
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredWorkflows.map((workflow) => (
                  <tr
                    key={workflow.id}
                    className={`hover:bg-gray-100 transition-colors ${workflow.isActive ? 'bg-green-50' : ''}`}
                  >
                    <td className={`px-6 py-4 whitespace-nowrap ${workflow.isActive ? 'border-l-4 border-green-500 shadow-[inset_4px_0_0_0_rgba(34,197,94,0.1)]' : 'border-l-4 border-transparent'}`}>
                      <div className="text-sm font-bold text-gray-900">{workflow.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col items-start gap-2">
                        <button
                          onClick={() => handleToggleWorkflow(workflow.id, workflow.isActive)}
                          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider transition-all shadow-sm border ${workflow.isActive
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : 'bg-gray-100 text-gray-600 border-gray-200'
                            }`}
                        >
                          {workflow.isActive && <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
                          {workflow.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </button>
                        {runningIds.has(String(workflow.id)) && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 animate-pulse uppercase tracking-wider">
                            <Zap className="w-3 h-3 mr-1 fill-current" />
                            Running
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-600 max-w-xs truncate">
                        {workflow.description || '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getTriggerTypeColor(workflow.triggerType)}`}>
                        {getTriggerTypeLabel(workflow.triggerType)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-sm text-gray-900">
                        <GitBranch className="w-4 h-4 mr-2 text-blue-500" />
                        {Array.isArray(workflow.actions) ? workflow.actions.length : 0}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center text-xs text-gray-500">
                        <Clock className="w-3 h-3 mr-1" />
                        {new Date(workflow.updatedAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleExecuteWorkflow(workflow.id)}
                          disabled={!workflow.isActive || executingIds.has(workflow.id)}
                          className="text-blue-600 hover:text-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Execute Workflow"
                        >
                          {executingIds.has(workflow.id) ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Play className="w-5 h-5" />
                          )}
                        </button>
                        <button
                          onClick={() => navigate(`/workflows/${workflow.id}`)}
                          className="text-blue-600 hover:text-blue-800 transition-colors"
                          title="Edit Workflow"
                        >
                          <Edit className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleDeleteWorkflow(workflow.id)}
                          className="text-red-600 hover:text-red-800 transition-colors"
                          title="Delete Workflow"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
