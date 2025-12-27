import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, X, AlertCircle, CheckCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Tabs } from '../ui/Tabs';
import { Pagination } from '../ui/Pagination';
import { Webhook, WebhookLog, WebhookStats } from '../../types';
import { webhooksService } from '../../services/webhooks.service';

interface WebhookLogsProps {
  isOpen: boolean;
  onClose: () => void;
  webhook: Webhook | null;
}

export const WebhookLogs: React.FC<WebhookLogsProps> = ({
  isOpen,
  onClose,
  webhook,
}) => {
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [stats, setStats] = useState<WebhookStats | null>(null);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && webhook) {
      fetchStats();
      fetchLogs(1);
    } else {
      // Reset state when modal closes
      setLogs([]);
      setStats(null);
      setExpandedLogId(null);
      setCurrentPage(1);
      setError(null);
    }
  }, [isOpen, webhook]);

  const fetchStats = async () => {
    if (!webhook) return;

    try {
      setIsLoadingStats(true);
      setError(null);
      const fetchedStats = await webhooksService.getWebhookStats(webhook.id, { days: 30 });
      setStats(fetchedStats);
    } catch (error: any) {
      console.error('Error fetching webhook stats:', error);
      setError('Failed to load statistics');
    } finally {
      setIsLoadingStats(false);
    }
  };

  const fetchLogs = async (page: number) => {
    if (!webhook) return;

    try {
      setIsLoadingLogs(true);
      setError(null);
      const result = await webhooksService.getWebhookLogs(webhook.id, {
        page,
        limit: 20,
      });
      setLogs(result.logs);
      setCurrentPage(result.pagination.page);
      setTotalPages(result.pagination.pages);
    } catch (error: any) {
      console.error('Error fetching webhook logs:', error);
      setError('Failed to load logs');
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handlePageChange = (page: number) => {
    setExpandedLogId(null); // Collapse any expanded row
    fetchLogs(page);
  };

  const toggleLogExpand = (logId: number) => {
    setExpandedLogId(expandedLogId === logId ? null : logId);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  if (!webhook) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Webhook Logs: ${webhook.name}`}
      size="xl"
    >
      <div className="space-y-6">
        {/* Error banner */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 mr-2" />
            <p className="text-sm text-red-800 flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-600 hover:text-red-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats Cards */}
        {isLoadingStats ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-sm text-gray-600">Loading statistics...</p>
          </div>
        ) : stats ? (
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="text-2xl font-bold text-gray-900">{stats.totalRequests}</div>
              <div className="text-sm text-gray-600 mt-1">Total</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="text-2xl font-bold text-green-700">{stats.successfulRequests}</div>
              <div className="text-sm text-gray-600 mt-1">Success</div>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg border border-red-200">
              <div className="text-2xl font-bold text-red-700">{stats.failedRequests}</div>
              <div className="text-sm text-gray-600 mt-1">Failed</div>
            </div>
            <div className="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="text-2xl font-bold text-blue-700">{stats.successRate.toFixed(1)}%</div>
              <div className="text-sm text-gray-600 mt-1">Success Rate</div>
            </div>
          </div>
        ) : null}

        {/* Logs Table */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h3>

          {isLoadingLogs ? (
            <div className="text-center py-12 border rounded-lg">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 border rounded-lg">
              <p className="text-gray-600">No logs found for this webhook.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto border rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Timestamp
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Method
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Endpoint
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Status Code
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {logs.map((log) => (
                      <React.Fragment key={log.id}>
                        {/* Log row */}
                        <tr className="hover:bg-gray-50">
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                            {formatDate(log.processedAt)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Badge variant={log.success ? 'success' : 'danger'}>
                              {log.success ? (
                                <span className="flex items-center gap-1">
                                  <CheckCircle className="w-3 h-3" />
                                  Success
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  Failed
                                </span>
                              )}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-mono">
                            {log.method}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <span className="truncate max-w-xs inline-block" title={log.endpoint}>
                              {log.endpoint}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm">
                            {log.statusCode ? (
                              <span
                                className={
                                  log.statusCode >= 200 && log.statusCode < 300
                                    ? 'text-green-700 font-semibold'
                                    : 'text-red-700 font-semibold'
                                }
                              >
                                {log.statusCode}
                              </span>
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-right">
                            <button
                              onClick={() => toggleLogExpand(log.id)}
                              className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                              title={expandedLogId === log.id ? 'Collapse' : 'Expand'}
                            >
                              {expandedLogId === log.id ? (
                                <>
                                  <ChevronUp className="w-4 h-4" />
                                  <span className="text-sm">Collapse</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-4 h-4" />
                                  <span className="text-sm">Expand</span>
                                </>
                              )}
                            </button>
                          </td>
                        </tr>

                        {/* Expandable row */}
                        {expandedLogId === log.id && (
                          <tr>
                            <td colSpan={6} className="px-0 py-0">
                              <div className="bg-gray-50 border-t border-gray-200">
                                <Tabs
                                  tabs={[
                                    {
                                      id: 'request',
                                      label: 'Request',
                                      content: (
                                        <div className="space-y-3">
                                          <div>
                                            <h4 className="text-xs font-semibold text-gray-700 mb-2">Headers</h4>
                                            <pre className="max-h-48 overflow-auto bg-white p-3 rounded border border-gray-200 text-xs font-mono">
                                              {JSON.stringify(log.headers, null, 2)}
                                            </pre>
                                          </div>
                                          <div>
                                            <h4 className="text-xs font-semibold text-gray-700 mb-2">Body</h4>
                                            <pre className="max-h-64 overflow-auto bg-white p-3 rounded border border-gray-200 text-xs font-mono">
                                              {JSON.stringify(log.body, null, 2)}
                                            </pre>
                                          </div>
                                        </div>
                                      ),
                                    },
                                    {
                                      id: 'response',
                                      label: 'Response',
                                      content: (
                                        <div>
                                          <h4 className="text-xs font-semibold text-gray-700 mb-2">Response Body</h4>
                                          {log.response ? (
                                            <pre className="max-h-96 overflow-auto bg-white p-3 rounded border border-gray-200 text-xs font-mono">
                                              {JSON.stringify(log.response, null, 2)}
                                            </pre>
                                          ) : (
                                            <p className="text-sm text-gray-500 italic">No response data available</p>
                                          )}
                                        </div>
                                      ),
                                    },
                                    ...(log.errorMessage
                                      ? [
                                          {
                                            id: 'error',
                                            label: 'Error',
                                            content: (
                                              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                                                <h4 className="text-sm font-semibold text-red-900 mb-2">Error Message</h4>
                                                <p className="text-sm text-red-800 whitespace-pre-wrap">{log.errorMessage}</p>
                                              </div>
                                            ),
                                          },
                                        ]
                                      : []),
                                  ]}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-4 flex justify-center">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};
