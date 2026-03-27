import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Pagination } from '../components/ui/Pagination';
import { Tabs } from '../components/ui/Tabs';
import { WHATSAPP_TEMPLATE_OPTIONS } from '../constants/workflow';
import { useProductsStore } from '../stores/productsStore';
import {
  communicationService,
  MessageLog,
  SmsTemplate,
  Recipient,
} from '../services/communication.service';
import { useCommunicationStore } from '../stores/communicationStore';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import toast from 'react-hot-toast';
import {
  MessageSquare,
  Send,
  Phone,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Trash2,
  Edit2,
  Plus,
  Search,
} from 'lucide-react';

// ─── Overview Tab ───────────────────────────────────────────────────────────────

const OverviewTab: React.FC = () => {
  const { stats, isLoadingStats, fetchStats } = useCommunicationStore();

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const total = stats?.total || 0;
  const delivered = stats?.byStatus?.delivered || 0;
  const failed = stats?.byStatus?.failed || 0;
  const deliveryRate = total > 0 ? ((delivered / total) * 100).toFixed(1) : '0';

  const channelData = stats
    ? Object.entries(stats.byChannel).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        count: value,
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <MessageSquare className="w-8 h-8 text-blue-500" />
            <div>
              <p className="text-sm text-gray-500">Total Messages</p>
              <p className="text-2xl font-bold">{total}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-500" />
            <div>
              <p className="text-sm text-gray-500">Delivered</p>
              <p className="text-2xl font-bold text-green-600">{delivered}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <XCircle className="w-8 h-8 text-red-500" />
            <div>
              <p className="text-sm text-gray-500">Failed</p>
              <p className="text-2xl font-bold text-red-600">{failed}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Send className="w-8 h-8 text-indigo-500" />
            <div>
              <p className="text-sm text-gray-500">Delivery Rate</p>
              <p className="text-2xl font-bold">{deliveryRate}%</p>
            </div>
          </div>
        </Card>
      </div>

      {channelData.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">Messages by Channel</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={channelData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
};

// ─── Message History Tab ────────────────────────────────────────────────────────

const MessageHistoryTab: React.FC = () => {
  const { messages, pagination, isLoadingMessages, fetchMessages } = useCommunicationStore();
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

  const loadMessages = useCallback(() => {
    const params: Record<string, any> = { page, limit: 20 };
    if (channel) params.channel = channel;
    if (status) params.status = status;
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;
    fetchMessages(params);
  }, [page, channel, status, startDate, endDate, fetchMessages]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const handleFilter = () => {
    setPage(1);
  };

  const statusBadgeVariant = (s: string): 'success' | 'danger' | 'warning' | 'secondary' | 'default' => {
    switch (s) {
      case 'delivered':
      case 'read':
        return 'success';
      case 'failed':
        return 'danger';
      case 'pending':
        return 'warning';
      case 'sent':
        return 'secondary';
      default:
        return 'default';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
        <Button size="sm" onClick={handleFilter}>
          <Search className="w-4 h-4 mr-1" />
          Filter
        </Button>
      </div>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Channel</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recipient</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Template</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoadingMessages ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : messages.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No messages found</td>
                </tr>
              ) : (
                messages.map((msg) => (
                  <tr key={msg.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
                      {new Date(msg.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={msg.channel === 'whatsapp' ? 'success' : 'secondary'}>
                        {msg.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {msg.customer
                        ? `${msg.customer.firstName} ${msg.customer.lastName} (${msg.customer.phoneNumber})`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{msg.templateName || '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(msg.status)}>{msg.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                      {msg.messageBody}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pagination && pagination.totalPages > 1 && (
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            onPageChange={setPage}
          />
        )}
      </Card>
    </div>
  );
};

// ─── Bulk Send Tab ──────────────────────────────────────────────────────────────

const BulkSendTab: React.FC = () => {
  const { templates, fetchTemplates } = useCommunicationStore();
  const [channelType, setChannelType] = useState<'sms' | 'whatsapp'>('sms');
  const [smsMessage, setSmsMessage] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState('');
  const [customLink, setCustomLink] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [hasOrdered, setHasOrdered] = useState(false);
  const { products, fetchProducts } = useProductsStore();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [showRecipients, setShowRecipients] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [sendResult, setSendResult] = useState<any>(null);

  useEffect(() => {
    fetchTemplates();
    fetchProducts().catch(() => {});
  }, [fetchTemplates, fetchProducts]);

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    if (templateId) {
      const tmpl = templates.find((t) => t.id === Number(templateId));
      if (tmpl) setSmsMessage(tmpl.body);
    }
  };

  const handlePreviewRecipients = async () => {
    setIsLoadingPreview(true);
    setSendResult(null);
    try {
      const filters: Record<string, any> = { channel: channelType };
      if (stateFilter) filters.state = stateFilter;
      if (productFilter) filters.productId = productFilter;
      if (hasOrdered) filters.hasOrdered = true;
      const data = await communicationService.getRecipients(filters);
      setRecipients(data);
      setShowRecipients(true);
    } catch {
      toast.error('Failed to load recipients');
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleSend = async () => {
    if (recipients.length === 0) {
      toast.error('No recipients to send to');
      return;
    }

    if (channelType === 'sms' && !smsMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    if (channelType === 'whatsapp' && !whatsappTemplate) {
      toast.error('Please select a WhatsApp template');
      return;
    }

    const confirmed = window.confirm(
      `Send ${channelType.toUpperCase()} to ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}?`
    );
    if (!confirmed) return;

    setIsSending(true);
    try {
      const customerIds = recipients.map((r) => r.id);
      let result;
      if (channelType === 'sms') {
        result = await communicationService.bulkSendSms(customerIds, smsMessage);
      } else {
        result = await communicationService.bulkSendWhatsApp(
          customerIds,
          whatsappTemplate,
          customLink || undefined
        );
      }
      setSendResult(result);
      const successCount = result.results?.filter((r: any) => r.success).length ?? result.total;
      toast.success(`Successfully queued ${successCount} messages`);
    } catch {
      toast.error('Failed to send messages');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Channel selector */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">Channel</h3>
        <div className="flex gap-3">
          <button
            onClick={() => setChannelType('sms')}
            className={`flex items-center gap-2 px-6 py-4 rounded-lg border-2 transition-colors ${
              channelType === 'sms'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <Phone className="w-5 h-5" />
            <span className="font-medium">SMS</span>
          </button>
          <button
            onClick={() => setChannelType('whatsapp')}
            className={`flex items-center gap-2 px-6 py-4 rounded-lg border-2 transition-colors ${
              channelType === 'whatsapp'
                ? 'border-green-500 bg-green-50 text-green-700'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span className="font-medium">WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Message content */}
      <Card>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Message Content</h3>
        {channelType === 'sms' ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Use saved template</label>
              <select
                value={selectedTemplate}
                onChange={(e) => handleTemplateSelect(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">— Write custom message —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <textarea
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value)}
                placeholder="Enter your SMS message..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">{smsMessage.length} characters</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">WhatsApp Template</label>
              <select
                value={whatsappTemplate}
                onChange={(e) => setWhatsappTemplate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value="">Select a template...</option>
                {WHATSAPP_TEMPLATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Custom Link (optional)</label>
              <input
                type="url"
                value={customLink}
                onChange={(e) => setCustomLink(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
        )}
      </Card>

      {/* Recipient filters */}
      <Card>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Recipient Filters</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm text-gray-600 mb-1">State / Region</label>
            <input
              type="text"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              placeholder="e.g. Greater Accra"
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Product</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 py-2">
            <input
              type="checkbox"
              checked={hasOrdered}
              onChange={(e) => setHasOrdered(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Has ordered before</span>
          </label>
          <Button size="sm" variant="outline" onClick={handlePreviewRecipients} isLoading={isLoadingPreview}>
            Preview Recipients
          </Button>
        </div>
      </Card>

      {/* Recipients preview */}
      {showRecipients && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">
              {recipients.length} recipient{recipients.length !== 1 ? 's' : ''} found
            </h3>
            <Button
              onClick={handleSend}
              isLoading={isSending}
              disabled={recipients.length === 0}
            >
              <Send className="w-4 h-4 mr-1" />
              Send to {recipients.length} recipient{recipients.length !== 1 ? 's' : ''}
            </Button>
          </div>
          {recipients.length > 0 && (
            <div className="max-h-60 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Phone</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">State</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Area</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {recipients.slice(0, 50).map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2">{r.firstName} {r.lastName}</td>
                      <td className="px-3 py-2">{r.phoneNumber}</td>
                      <td className="px-3 py-2">{r.state || '—'}</td>
                      <td className="px-3 py-2">{r.area || '—'}</td>
                    </tr>
                  ))}
                  {recipients.length > 50 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-gray-500 text-center">
                        ...and {recipients.length - 50} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Send result */}
      {sendResult && (
        <Card>
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">
              Messages queued: {sendResult.results?.filter((r: any) => r.success).length ?? sendResult.total ?? 0}
              {sendResult.results?.filter((r: any) => !r.success).length
                ? ` | Failed: ${sendResult.results.filter((r: any) => !r.success).length}`
                : ''}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
};

// ─── Templates Tab ──────────────────────────────────────────────────────────────

const TemplatesTab: React.FC = () => {
  const { templates, isLoadingTemplates, fetchTemplates } = useCommunicationStore();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setName('');
    setBody('');
  };

  const handleEdit = (template: SmsTemplate) => {
    setEditingId(template.id);
    setName(template.name);
    setBody(template.body);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !body.trim()) {
      toast.error('Name and body are required');
      return;
    }
    setIsSaving(true);
    try {
      if (editingId) {
        await communicationService.updateTemplate(editingId, { name, body });
        toast.success('Template updated');
      } else {
        await communicationService.createTemplate({ name, body });
        toast.success('Template created');
      }
      resetForm();
      fetchTemplates();
    } catch {
      toast.error('Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await communicationService.deleteTemplate(id);
      toast.success('Template deleted');
      fetchTemplates();
    } catch {
      toast.error('Failed to delete template');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">SMS Templates</h3>
        {!showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Create Template
          </Button>
        )}
      </div>

      {showForm && (
        <Card>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Order Confirmation"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message Body</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Enter template message..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <p className="text-xs text-gray-400 mt-1">{body.length} characters</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} isLoading={isSaving}>
                {editingId ? 'Update' : 'Create'}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {isLoadingTemplates ? (
        <p className="text-gray-500 text-center py-8">Loading templates...</p>
      ) : templates.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No templates yet</p>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <Card key={t.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-gray-900">{t.name}</h4>
                  <p className="text-sm text-gray-500 mt-1 whitespace-pre-wrap">{t.body}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Updated {new Date(t.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(t)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Opt-outs Tab ───────────────────────────────────────────────────────────────

const OptOutsTab: React.FC = () => {
  const { optOutCustomers, optOutPagination, isLoadingOptOuts, fetchOptOutCustomers } =
    useCommunicationStore();
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetchOptOutCustomers(page, 20);
  }, [page, fetchOptOutCustomers]);

  const handleToggle = async (
    customerId: number,
    field: 'smsOptOut' | 'whatsappOptOut',
    currentValue: boolean
  ) => {
    try {
      await communicationService.updateOptOut(customerId, { [field]: !currentValue });
      toast.success('Opt-out preference updated');
      fetchOptOutCustomers(page, 20);
    } catch {
      toast.error('Failed to update opt-out');
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Customer Opt-out Preferences</h3>
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">SMS Opt-out</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">WhatsApp Opt-out</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {isLoadingOptOuts ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : optOutCustomers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">No customers found</td>
                </tr>
              ) : (
                optOutCustomers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {c.firstName} {c.lastName}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{c.phoneNumber}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggle(c.id, 'smsOptOut', c.smsOptOut)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          c.smsOptOut ? 'bg-red-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            c.smsOptOut ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggle(c.id, 'whatsappOptOut', c.whatsappOptOut)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          c.whatsappOptOut ? 'bg-red-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            c.whatsappOptOut ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {optOutPagination && optOutPagination.totalPages > 1 && (
          <Pagination
            currentPage={optOutPagination.page}
            totalPages={optOutPagination.totalPages}
            totalItems={optOutPagination.total}
            pageSize={optOutPagination.limit}
            onPageChange={setPage}
          />
        )}
      </Card>
    </div>
  );
};

// ─── Main Page ──────────────────────────────────────────────────────────────────

export const Communications: React.FC = () => {
  const tabs = [
    { id: 'overview', label: 'Overview', content: () => <OverviewTab /> },
    { id: 'history', label: 'Message History', content: () => <MessageHistoryTab /> },
    { id: 'bulk-send', label: 'Bulk Send', content: () => <BulkSendTab /> },
    { id: 'templates', label: 'Templates', content: () => <TemplatesTab /> },
    { id: 'opt-outs', label: 'Opt-outs', content: () => <OptOutsTab /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Communications</h1>
        <p className="text-gray-500 mt-1">Manage SMS and WhatsApp messaging</p>
      </div>
      <Tabs tabs={tabs} defaultTab="overview" persistKey="tab" />
    </div>
  );
};

export default Communications;
