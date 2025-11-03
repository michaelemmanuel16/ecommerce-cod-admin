import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle, XCircle, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { workflowsService, WorkflowExecution } from '../../services/workflows.service';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

interface ExecutionHistoryProps {
  workflowId: string;
  refreshTrigger?: number; // Change this to force refresh
}

export const ExecutionHistory: React.FC<ExecutionHistoryProps> = ({ workflowId, refreshTrigger }) => {
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadExecutions();
  }, [workflowId, currentPage, refreshTrigger]);

  // Auto-refresh every 10 seconds if there are running executions
  useEffect(() => {
    const hasRunning = executions.some(e => e.status === 'running' || e.status === 'pending');
    if (!hasRunning) return;

    const interval = setInterval(() => {
      loadExecutions();
    }, 10000);

    return () => clearInterval(interval);
  }, [executions, workflowId, currentPage]);

  const loadExecutions = async () => {
    try {
      setIsLoading(true);
      const data = await workflowsService.getWorkflowExecutions(workflowId, {
        page: currentPage,
        limit: 10
      });
      setExecutions(data.executions || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error('Failed to load executions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'running':
        return <Loader className="w-5 h-5 text-blue-600 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      running: 'bg-blue-100 text-blue-800',
      pending: 'bg-gray-100 text-gray-800'
    };
    return styles[status] || styles.pending;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getDuration = (startedAt: string, completedAt?: string) => {
    if (!completedAt) return 'In progress...';
    const start = new Date(startedAt).getTime();
    const end = new Date(completedAt).getTime();
    const durationMs = end - start;
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (isLoading && executions.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading execution history...</p>
          </div>
        </div>
      </Card>
    );
  }

  if (executions.length === 0) {
    return (
      <Card>
        <div className="p-6">
          <div className="text-center py-8">
            <Clock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Executions Yet</h3>
            <p className="text-gray-600">
              This workflow hasn't been executed yet. Click the Execute button to run it.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Execution History</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadExecutions}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        <div className="space-y-3">
          {executions.map((execution) => (
            <div key={execution.id} className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-4 bg-white hover:bg-gray-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    {getStatusIcon(execution.status)}

                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(execution.status)}`}>
                          {execution.status.toUpperCase()}
                        </span>
                        <span className="text-sm text-gray-600">
                          {formatDate(execution.startedAt)}
                        </span>
                      </div>

                      <div className="text-xs text-gray-500">
                        Duration: {getDuration(execution.startedAt, execution.completedAt)}
                      </div>

                      {execution.error && (
                        <div className="mt-2 text-sm text-red-600 bg-red-50 p-2 rounded">
                          <strong>Error:</strong> {execution.error}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => toggleExpand(execution.id)}
                    className="ml-4 p-2 hover:bg-gray-100 rounded transition-colors"
                  >
                    {expandedId === execution.id ? (
                      <ChevronUp className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    )}
                  </button>
                </div>

                {expandedId === execution.id && (
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-700 mb-2">Input Data</h4>
                      <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                        {JSON.stringify(execution.input, null, 2)}
                      </pre>
                    </div>

                    {execution.output && (
                      <div>
                        <h4 className="text-xs font-semibold text-gray-700 mb-2">Output Data</h4>
                        <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                          {JSON.stringify(execution.output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {pagination && pagination.pages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4">
            <div className="text-sm text-gray-600">
              Page {pagination.page} of {pagination.pages} ({pagination.total} total)
            </div>
            <div className="flex space-x-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === pagination.pages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
