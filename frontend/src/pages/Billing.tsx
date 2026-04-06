import React, { useEffect, useState } from 'react';
import apiClient from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency } from '../utils/format';

interface Plan {
  id: string;
  name: string;
  displayName: string;
  maxOrders: number | null;
  maxUsers: number | null;
  priceGHS: number;
  features: Record<string, boolean>;
}

interface Subscription {
  plan: Plan | null;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  usage: {
    ordersThisMonth: number;
    maxOrders: number | null;
  };
}

export function Billing() {
  const { user } = useAuthStore();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient.get<{ plans: Plan[] }>('/api/billing/plans'),
      apiClient.get<Subscription>('/api/billing/subscription'),
    ])
      .then(([plansRes, subRes]) => {
        setPlans(plansRes.data.plans);
        setSubscription(subRes.data);
      })
      .catch(() => setError('Failed to load billing information'))
      .finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async (planName: string) => {
    if (!user || user.role !== 'super_admin') return;
    setUpgrading(planName);
    try {
      await apiClient.post('/api/billing/upgrade', { planName });
      const subRes = await apiClient.get<Subscription>('/api/billing/subscription');
      setSubscription(subRes.data);
    } catch {
      setError('Failed to update plan. Please try again.');
    } finally {
      setUpgrading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
      </div>
    );
  }

  const currentPlanName = subscription?.plan?.name ?? 'free';
  const ordersThisMonth = subscription?.usage.ordersThisMonth ?? 0;
  const maxOrders = subscription?.usage.maxOrders;
  const usagePercent = maxOrders ? Math.min(100, Math.round((ordersThisMonth / maxOrders) * 100)) : 0;

  const trialDaysLeft = subscription?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(subscription.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing & Plans</h1>
        <p className="text-gray-500 mt-1">Manage your subscription and usage</p>
      </div>

      {/* Current plan summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Current Plan</h2>
        <div className="flex items-center gap-4 mb-4">
          <span className="text-2xl font-bold text-blue-600">
            {subscription?.plan?.displayName ?? 'Free'}
          </span>
          <span className={`px-2 py-1 text-xs rounded-full font-medium ${
            subscription?.subscriptionStatus === 'active'
              ? 'bg-green-100 text-green-700'
              : 'bg-yellow-100 text-yellow-700'
          }`}>
            {subscription?.subscriptionStatus ?? 'active'}
          </span>
        </div>

        {trialDaysLeft !== null && trialDaysLeft > 0 && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-700 text-sm">
            Trial ends in <strong>{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''}</strong>
          </div>
        )}

        <div>
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Orders this month</span>
            <span>
              {ordersThisMonth}{maxOrders ? ` / ${maxOrders.toLocaleString()}` : ' (unlimited)'}
            </span>
          </div>
          {maxOrders && (
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${usagePercent >= 90 ? 'bg-red-500' : 'bg-blue-500'}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Plan selection */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.name === currentPlanName;
            const isUpgrade = user?.role === 'super_admin' && !isCurrent;
            return (
              <div
                key={plan.id}
                className={`rounded-xl border-2 p-6 flex flex-col gap-4 ${
                  isCurrent ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{plan.displayName}</h3>
                  <p className="text-2xl font-bold mt-1">
                    {plan.priceGHS === 0 ? 'Free' : `${formatCurrency(Number(plan.priceGHS), 'GHS')}/mo`}
                  </p>
                </div>
                <ul className="space-y-1 text-sm text-gray-600 flex-1">
                  <li>{plan.maxOrders ? `${plan.maxOrders.toLocaleString()} orders/mo` : 'Unlimited orders'}</li>
                  <li>{plan.maxUsers ? `${plan.maxUsers} users` : 'Unlimited users'}</li>
                  {Object.entries(plan.features).map(([key, enabled]) => (
                    <li key={key} className={enabled ? 'text-gray-800' : 'text-gray-400 line-through'}>
                      {key.replace(/_/g, ' ')}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <span className="text-center py-2 text-sm font-medium text-blue-600">Current Plan</span>
                ) : isUpgrade ? (
                  <button
                    onClick={() => handleUpgrade(plan.name)}
                    disabled={upgrading === plan.name}
                    className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {upgrading === plan.name ? 'Updating...' : `Switch to ${plan.displayName}`}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
