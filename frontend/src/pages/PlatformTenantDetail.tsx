import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ShoppingBag, DollarSign, Users } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { StatCard } from '../components/common/StatCard';
import { usePlatformStore } from '../stores/platformStore';

const statusBadgeVariant = (status: string): 'success' | 'danger' | 'default' | 'warning' => {
  if (status === 'active') return 'success';
  if (status === 'suspended') return 'danger';
  if (status === 'trial') return 'default';
  return 'default';
};

const formatGHS = (value: number) =>
  `GHS ${value.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const PlatformTenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentTenant, isLoading, fetchTenant, updateTenant, suspendTenant, reactivateTenant, deleteTenant } =
    usePlatformStore();

  // Plan management state
  const [planId, setPlanId] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  // Rate limit state
  const [rateLimitEnabled, setRateLimitEnabled] = useState(false);
  const [requestsPer15Min, setRequestsPer15Min] = useState(900);
  const [burstPerSec, setBurstPerSec] = useState(30);
  const [savingRateLimit, setSavingRateLimit] = useState(false);

  // Delete confirmation
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) fetchTenant(id);
  }, [id, fetchTenant]);

  // Populate state from tenant data
  useEffect(() => {
    if (currentTenant) {
      setRateLimitEnabled(currentTenant.rateLimitEnabled);
      setRequestsPer15Min(currentTenant.rateLimitConfig?.requestsPer15Min ?? 900);
      setBurstPerSec(currentTenant.rateLimitConfig?.burstPerSec ?? 30);
      setPlanId(currentTenant.currentPlan?.name ?? '');
    }
  }, [currentTenant]);

  const handleSavePlan = async () => {
    if (!id) return;
    setSavingPlan(true);
    try {
      await updateTenant(id, { currentPlanId: planId });
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSaveRateLimit = async () => {
    if (!id) return;
    setSavingRateLimit(true);
    try {
      await updateTenant(id, {
        rateLimitEnabled,
        rateLimitConfig: rateLimitEnabled ? { requestsPer15Min, burstPerSec } : null,
      });
    } finally {
      setSavingRateLimit(false);
    }
  };

  const handleSuspendReactivate = async () => {
    if (!id || !currentTenant) return;
    if (currentTenant.subscriptionStatus === 'active') {
      await suspendTenant(id);
    } else {
      await reactivateTenant(id);
    }
  };

  const handleDelete = async () => {
    if (!id || !currentTenant) return;
    if (deleteConfirmInput !== currentTenant.slug) return;
    setDeleting(true);
    try {
      await deleteTenant(id, currentTenant.slug);
      navigate('/platform/tenants');
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading && !currentTenant) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!currentTenant) {
    return (
      <div className="space-y-4">
        <Link to="/platform/tenants" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to Tenants
        </Link>
        <p className="text-gray-500">Tenant not found.</p>
      </div>
    );
  }

  const t = currentTenant;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        to="/platform/tenants"
        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Tenants
      </Link>

      {/* Summary Card */}
      <Card>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-gray-900">{t.name}</h2>
            <p className="text-sm text-gray-500 font-mono">{t.slug}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {t.currentPlan && (
                <Badge variant="secondary">{t.currentPlan.displayName}</Badge>
              )}
              <Badge variant={statusBadgeVariant(t.subscriptionStatus)}>
                {t.subscriptionStatus}
              </Badge>
            </div>
          </div>
          <div className="text-sm text-gray-500 space-y-1 sm:text-right">
            {t.region && <p>Region: <span className="font-medium text-gray-700">{t.region}</span></p>}
            <p>Currency: <span className="font-medium text-gray-700">{t.currency}</span></p>
            <p>Created: <span className="font-medium text-gray-700">{new Date(t.createdAt).toLocaleDateString()}</span></p>
          </div>
        </div>
      </Card>

      {/* Usage */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Usage</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Orders This Month"
            value={t.usage.ordersThisMonth}
            icon={ShoppingBag}
            iconColor="text-orange-600"
          />
          <StatCard
            title="Revenue This Month"
            value={formatGHS(t.usage.revenueThisMonth)}
            icon={DollarSign}
            iconColor="text-green-600"
          />
          <StatCard
            title="Total Users"
            value={t.usage.totalUsers}
            icon={Users}
            iconColor="text-blue-600"
          />
        </div>
      </div>

      {/* Plan Management */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Plan Management</h3>
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Plan</label>
            <input
              type="text"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              placeholder="Plan ID (e.g. free, starter, pro)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleSavePlan}
            disabled={savingPlan}
            className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {savingPlan ? 'Saving…' : 'Save Plan'}
          </button>
        </div>
      </Card>

      {/* Rate Limiting */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Rate Limiting</h3>
        <div className="space-y-4">
          {/* Toggle */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={rateLimitEnabled}
              onClick={() => setRateLimitEnabled(!rateLimitEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                rateLimitEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  rateLimitEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-sm font-medium text-gray-700">
              Rate Limit {rateLimitEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>

          {/* Config fields */}
          {rateLimitEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Requests per 15 min
                </label>
                <input
                  type="number"
                  min={1}
                  value={requestsPer15Min}
                  onChange={(e) => setRequestsPer15Min(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Burst per second
                </label>
                <input
                  type="number"
                  min={1}
                  value={burstPerSec}
                  onChange={(e) => setBurstPerSec(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          <div>
            <button
              onClick={handleSaveRateLimit}
              disabled={savingRateLimit}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {savingRateLimit ? 'Saving…' : 'Save Rate Limit'}
            </button>
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      <div className="border-2 border-red-200 rounded-lg p-4 space-y-4">
        <h3 className="text-lg font-semibold text-red-700">Danger Zone</h3>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Suspend / Reactivate */}
          <button
            onClick={handleSuspendReactivate}
            className={`px-4 py-2 text-sm font-medium rounded-lg border ${
              t.subscriptionStatus === 'active'
                ? 'border-orange-400 text-orange-700 hover:bg-orange-50'
                : 'border-green-400 text-green-700 hover:bg-green-50'
            }`}
          >
            {t.subscriptionStatus === 'active' ? 'Suspend Tenant' : 'Reactivate Tenant'}
          </button>

          {/* Delete */}
          <button
            onClick={() => setShowDelete(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-red-400 text-red-700 hover:bg-red-50"
          >
            Delete Tenant
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={showDelete} onClose={() => { setShowDelete(false); setDeleteConfirmInput(''); }} title="Delete Tenant">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            This action is <strong>irreversible</strong>. To confirm, type the tenant slug{' '}
            <code className="bg-gray-100 px-1 rounded text-red-700">{t.slug}</code> below.
          </p>
          <input
            type="text"
            value={deleteConfirmInput}
            onChange={(e) => setDeleteConfirmInput(e.target.value)}
            placeholder={t.slug}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setShowDelete(false); setDeleteConfirmInput(''); }}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteConfirmInput !== t.slug || deleting}
              className="px-4 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete Tenant'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
