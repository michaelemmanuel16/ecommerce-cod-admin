import React, { useEffect, useState } from 'react';
import { Plus, Search, Webhook as WebhookIcon, Edit2, Trash2, List, AlertCircle, Copy, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useWebhooksStore } from '../stores/webhooksStore';
import { Webhook } from '../types';
import { webhooksService } from '../services/webhooks.service';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Tooltip } from '../components/ui/Tooltip';
import { WebhookForm } from '../components/forms/WebhookForm';
import { WebhookLogs } from '../components/webhook/WebhookLogs';

export const Webhooks: React.FC = () => {
  const {
    webhooks,
    pagination,
    searchQuery,
    isLoading,
    error,
    fetchWebhooks,
    setSearchQuery,
    clearError
  } = useWebhooksStore();

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [isLogsOpen, setIsLogsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [copiedApiKeyId, setCopiedApiKeyId] = useState<number | null>(null);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const handleAddWebhook = () => {
    setSelectedWebhook(null);
    setIsFormOpen(true);
  };

  const handleEditWebhook = (webhook: Webhook) => {
    setSelectedWebhook(webhook);
    setIsFormOpen(true);
  };

  const handleDeleteWebhook = async (webhook: Webhook) => {
    if (!confirm(`Are you sure you want to delete "${webhook.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setDeletingId(webhook.id);
      await webhooksService.deleteWebhook(webhook.id);
      await fetchWebhooks(); // Refresh the list
      toast.success(`Webhook "${webhook.name}" deleted successfully`);
    } catch (error: any) {
      console.error('Failed to delete webhook:', error);
      toast.error(error.response?.data?.message || 'Failed to delete webhook. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleViewLogs = (webhook: Webhook) => {
    setSelectedWebhook(webhook);
    setIsLogsOpen(true);
  };

  const handleCopyApiKey = async (webhook: Webhook) => {
    if (!webhook.apiKey) return;

    try {
      await navigator.clipboard.writeText(webhook.apiKey);
      setCopiedApiKeyId(webhook.id);
      setTimeout(() => setCopiedApiKeyId(null), 2000);
      toast.success('API key copied to clipboard');
    } catch (error) {
      console.error('Failed to copy API key:', error);
      toast.error('Failed to copy API key');
    }
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setSelectedWebhook(null);
    fetchWebhooks(); // Refresh the list
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const truncateUrl = (url: string, maxLength: number = 50) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  };

  const getApiBaseUrl = (): string => {
    if (import.meta.env.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }
    return window.location.origin;
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
          <p className="text-sm text-gray-600 mt-1">
            Configure webhooks to import orders from external systems
          </p>
        </div>
        <Button variant="primary" onClick={handleAddWebhook}>
          <Plus className="w-4 h-4 mr-2" />
          Add Webhook
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start justify-between">
          <div className="flex items-start">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 mr-3" />
            <p className="text-red-800">{error}</p>
          </div>
          <button
            onClick={clearError}
            className="text-red-600 hover:text-red-800"
          >
            ×
          </button>
        </div>
      )}

      {/* Search bar */}
      <Card className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search webhooks by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </Card>

      {/* Loading state */}
      {isLoading ? (
        <Card>
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading webhooks...</p>
          </div>
        </Card>
      ) : webhooks.length === 0 ? (
        /* Empty state */
        <Card>
          <div className="text-center py-12">
            <WebhookIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">
              {searchQuery
                ? 'No webhooks found matching your search.'
                : 'No webhooks configured yet.'}
            </p>
            {!searchQuery && (
              <p className="text-gray-500 text-sm">
                Add your first webhook to start importing orders automatically.
              </p>
            )}
          </div>
        </Card>
      ) : (
        /* Webhooks table */
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Receiving URL
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
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
                {webhooks.map((webhook) => (
                  <tr key={webhook.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded flex items-center justify-center">
                          <WebhookIcon className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {webhook.name}
                          </div>
                          {webhook.apiKey && (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-xs text-gray-500 font-mono">
                                {webhook.apiKey.substring(0, 8)}...
                              </span>
                              <Tooltip content="Copy API key" position="top">
                                <button
                                  onClick={() => handleCopyApiKey(webhook)}
                                  className="text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                  {copiedApiKeyId === webhook.id ? (
                                    <CheckCircle className="w-3 h-3 text-green-600" />
                                  ) : (
                                    <Copy className="w-3 h-3" />
                                  )}
                                </button>
                              </Tooltip>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        <Tooltip content={`${getApiBaseUrl()}/api/webhooks/import/${webhook.uniqueUrl}`} position="top">
                          <span className="truncate max-w-xs inline-block">
                            {truncateUrl(`${getApiBaseUrl()}/api/webhooks/import/${webhook.uniqueUrl}`)}
                          </span>
                        </Tooltip>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={webhook.isActive ? 'success' : 'secondary'}>
                        {webhook.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDate(webhook.updatedAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewLogs(webhook)}
                          className="text-gray-600 hover:text-gray-800"
                          title="View Logs"
                        >
                          <List className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleEditWebhook(webhook)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteWebhook(webhook)}
                          disabled={deletingId === webhook.id}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === webhook.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent"></div>
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
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

      {/* WebhookForm modal */}
      <WebhookForm
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setSelectedWebhook(null);
        }}
        webhook={selectedWebhook}
        onSuccess={handleFormSuccess}
      />

      {/* WebhookLogs modal */}
      <WebhookLogs
        isOpen={isLogsOpen}
        onClose={() => {
          setIsLogsOpen(false);
          setSelectedWebhook(null);
        }}
        webhook={selectedWebhook}
      />
    </div>
  );
};
