import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Pagination } from '../components/ui/Pagination';
import { usePlatformStore } from '../stores/platformStore';

const PLAN_OPTIONS = [
  { value: '', label: 'All Plans' },
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'pro', label: 'Pro' },
  { value: 'enterprise', label: 'Enterprise' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'trial', label: 'Trial' },
];

const statusBadgeVariant = (status: string): 'success' | 'danger' | 'default' | 'warning' => {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'danger';
  if (status === 'trial') return 'default';
  return 'default';
};

export const PlatformTenants: React.FC = () => {
  const navigate = useNavigate();
  const {
    tenants,
    tenantsTotal,
    tenantsPage,
    tenantsTotalPages,
    isLoading,
    fetchTenants,
    createTenant,
  } = usePlatformStore();

  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  // Create tenant modal state
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    planName: '',
    region: '',
    currency: 'GHS',
  });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    (p = page) => {
      fetchTenants({
        search: search || undefined,
        plan: plan || undefined,
        status: status || undefined,
        page: p,
      });
    },
    [fetchTenants, search, plan, status, page]
  );

  // Reload when filters change, reset to page 1
  useEffect(() => {
    setPage(1);
    fetchTenants({
      search: search || undefined,
      plan: plan || undefined,
      status: status || undefined,
      page: 1,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, plan, status]);

  // Reload when page changes
  useEffect(() => {
    fetchTenants({
      search: search || undefined,
      plan: plan || undefined,
      status: status || undefined,
      page,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createTenant({
        name: form.name,
        slug: form.slug,
        planName: form.planName || undefined,
        region: form.region || undefined,
        currency: form.currency || 'GHS',
      });
      setShowCreate(false);
      setForm({ name: '', slug: '', planName: '', region: '', currency: 'GHS' });
      load(1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Platform Tenants</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Create Tenant
        </button>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by name or slug…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PLAN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    {['Name', 'Slug', 'Plan', 'Status', 'Users', 'Orders', 'Created'].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {tenants.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                        No tenants found.
                      </td>
                    </tr>
                  ) : (
                    tenants.map((t) => (
                      <tr
                        key={t.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => navigate(`/platform/tenants/${t.id}`)}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 font-mono">{t.slug}</td>
                        <td className="px-4 py-3 text-sm">
                          {t.currentPlan ? (
                            <Badge variant="secondary">{t.currentPlan.displayName}</Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <Badge variant={statusBadgeVariant(t.subscriptionStatus)}>
                            {t.subscriptionStatus}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{t._count.users}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{t._count.orders}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/platform/tenants/${t.id}`);
                            }}
                            className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {tenantsTotalPages > 1 && (
              <Pagination
                currentPage={tenantsPage}
                totalPages={tenantsTotalPages}
                totalItems={tenantsTotal}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </Card>

      {/* Create Tenant Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create Tenant">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Name *"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="Acme Corp"
          />
          <Input
            label="Slug *"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            required
            placeholder="acme-corp"
          />
          <Input
            label="Plan Name (optional)"
            value={form.planName}
            onChange={(e) => setForm({ ...form, planName: e.target.value })}
            placeholder="free"
          />
          <Input
            label="Region (optional)"
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
            placeholder="GH"
          />
          <Input
            label="Currency"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            placeholder="GHS"
          />
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
