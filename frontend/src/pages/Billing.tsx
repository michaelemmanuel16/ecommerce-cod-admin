import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency, formatDate } from '../utils/format';
import { billingService, BillingPlan, Subscription } from '../services/billing.service';

const PAID_TIERS = ['growth', 'scale', 'enterprise'];

export function Billing() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'super_admin';
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    Promise.all([billingService.getPlans(), billingService.getSubscription()])
      .then(([p, s]) => {
        setPlans(p.filter((x) => PAID_TIERS.includes(x.name)));
        setSubscription(s);
      })
      .catch(() => setError('Failed to load billing information'))
      .finally(() => setLoading(false));
  }, []);

  const billingEnabled = subscription?.billingEnabled !== false;
  const status = subscription?.subscriptionStatus ?? 'active';
  const currentPlanName = subscription?.plan?.name ?? null;

  const handleSubscribe = async (planName: string) => {
    if (!isAdmin || !billingEnabled) return;
    setBusy(planName);
    try {
      const { authorizationUrl } = await billingService.startSubscription(planName);
      window.location.href = authorizationUrl; // shows "Redirecting…" until the browser leaves
    } catch {
      setError('Could not start checkout. Please try again.');
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    setBusy('cancel');
    try {
      await billingService.cancelSubscription();
      setSubscription(await billingService.getSubscription());
      setConfirmCancel(false);
    } catch {
      setError('Could not cancel the subscription. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  const ordersThisMonth = subscription?.usage.ordersThisMonth ?? 0;
  const maxOrders = subscription?.usage.maxOrders ?? null;
  const usagePercent = maxOrders ? Math.min(100, Math.round((ordersThisMonth / maxOrders) * 100)) : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing &amp; Plans</h1>
        <p className="text-gray-500 mt-1">Manage your subscription and usage</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      {!billingEnabled && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-gray-600 text-sm">
          Billing is being set up. Plans are shown for reference; subscribing will be available shortly.
        </div>
      )}

      {/* State-driven hierarchy: past_due banner dominates > pending card > active card. */}
      {status === 'past_due' && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-red-800">Your last payment failed</h2>
          <p className="text-red-700 text-sm mt-1">
            We couldn't charge your card{subscription?.paymentFailedAt ? ` on ${formatDate(subscription.paymentFailedAt)}` : ''}.
            Re-authorize to keep your account active.
          </p>
          {isAdmin && billingEnabled && currentPlanName && (
            <button
              onClick={() => handleSubscribe(currentPlanName)}
              disabled={busy === currentPlanName}
              className="mt-4 min-h-[44px] px-5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60"
            >
              {busy === currentPlanName ? 'Redirecting to Paystack…' : 'Update payment method'}
            </button>
          )}
        </div>
      )}

      {status === 'pending' && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-primary-900">Finish setting up your subscription</h2>
          <p className="text-primary-800 text-sm mt-1">
            Your account is ready — complete payment to activate
            {subscription?.plan ? ` ${subscription.plan.displayName}` : ' your plan'}.
          </p>
          {isAdmin && billingEnabled && currentPlanName && (
            <button
              onClick={() => handleSubscribe(currentPlanName)}
              disabled={busy === currentPlanName}
              className="mt-4 min-h-[44px] px-5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
            >
              {busy === currentPlanName ? 'Redirecting to Paystack…' : 'Complete payment'}
            </button>
          )}
        </div>
      )}

      {/* Current plan summary */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl font-bold text-primary-700">{subscription?.plan?.displayName ?? 'Free'}</span>
          <span
            className={`px-2 py-1 text-xs rounded-full font-medium ${
              status === 'active'
                ? 'bg-green-100 text-green-700'
                : status === 'past_due'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-yellow-100 text-yellow-700'
            }`}
          >
            {status}
          </span>
        </div>

        {status === 'active' && subscription?.renewsAt && (
          <p className="text-sm text-gray-600">
            Renews on <strong>{formatDate(subscription.renewsAt)}</strong>
            {subscription.nextChargeAmount != null && (
              <> · next charge {formatCurrency(Number(subscription.nextChargeAmount), 'NGN')}</>
            )}
            {subscription.cardLast4 && <> · card ending {subscription.cardLast4}</>}
          </p>
        )}

        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Orders this month</span>
            <span>{ordersThisMonth}{maxOrders ? ` / ${maxOrders.toLocaleString()}` : ' (unlimited)'}</span>
          </div>
          {maxOrders && (
            <div className="w-full bg-gray-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${usagePercent >= 90 ? 'bg-red-500' : 'bg-primary-500'}`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          )}
        </div>

        {isAdmin && status === 'active' && subscription?.subscriptionCode && (
          <button
            onClick={() => setConfirmCancel(true)}
            className="mt-5 text-sm font-medium text-red-600 hover:text-red-700"
          >
            Cancel subscription
          </button>
        )}
      </div>

      {/* Plan options (difference-first; Free is admin-only and not listed) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.name === currentPlanName && status === 'active';
            const isEnterprise = plan.name === 'enterprise';
            return (
              <div
                key={plan.id}
                className={`rounded-xl border-2 p-6 flex flex-col gap-3 ${
                  isCurrent ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-white'
                }`}
              >
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{plan.displayName}</h3>
                  <p className="text-2xl font-bold mt-1">
                    {isEnterprise || plan.priceNGN == null
                      ? "Let's talk"
                      : `${formatCurrency(Number(plan.priceNGN), 'NGN')}/mo`}
                  </p>
                </div>
                <p className="text-sm text-gray-600 flex-1">
                  {plan.maxOrders ? `${plan.maxOrders.toLocaleString()} orders/mo · ${plan.maxUsers} staff` : 'Unlimited — every ceiling removed'}
                </p>
                {isCurrent ? (
                  <span className="text-center py-2 text-sm font-medium text-primary-700">Current plan</span>
                ) : isEnterprise ? (
                  <a
                    href="mailto:sales@codadmin.app"
                    className="text-center min-h-[44px] py-2.5 rounded-lg border border-gray-300 font-semibold hover:bg-gray-50 flex items-center justify-center"
                  >
                    Contact us
                  </a>
                ) : isAdmin && billingEnabled ? (
                  <button
                    onClick={() => handleSubscribe(plan.name)}
                    disabled={busy === plan.name}
                    className="min-h-[44px] py-2.5 rounded-lg bg-primary-600 text-white font-semibold hover:bg-primary-700 disabled:opacity-60"
                  >
                    {busy === plan.name ? 'Redirecting to Paystack…' : `Switch to ${plan.displayName}`}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cancel confirmation */}
      {confirmCancel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-900">Cancel subscription?</h3>
            <p className="text-sm text-gray-600 mt-2">
              You'll keep access until the end of your current billing cycle
              {subscription?.renewsAt ? ` (${formatDate(subscription.renewsAt)})` : ''}.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmCancel(false)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
              >
                Keep plan
              </button>
              <button
                onClick={handleCancel}
                disabled={busy === 'cancel'}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
