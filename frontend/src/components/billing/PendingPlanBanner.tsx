import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { billingService } from '../../services/billing.service';

/**
 * Persistent app-level nudge (MAN-61) for tenants that registered but never
 * finished paying (subscriptionStatus='pending'). Recovers abandoned Paystack
 * checkouts. Clears once the subscription flips to active. No hard lockout — that
 * is the enforcement sibling.
 */
export const PendingPlanBanner: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore();
  const [planName, setPlanName] = useState<string | null>(null);
  const [planLabel, setPlanLabel] = useState<string>('your plan');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    billingService
      .getSubscription()
      .then((s) => {
        if (!active) return;
        if (s.subscriptionStatus === 'pending' && s.plan) {
          setPlanName(s.plan.name);
          setPlanLabel(s.plan.displayName);
          setEnabled(s.billingEnabled !== false);
        }
      })
      .catch(() => {/* banner is best-effort; never block the app */});
    return () => { active = false; };
  }, [isAuthenticated]);

  if (!planName) return null;

  const resume = async () => {
    if (!enabled || user?.role !== 'super_admin') return;
    setBusy(true);
    try {
      const { authorizationUrl } = await billingService.startSubscription(planName);
      window.location.href = authorizationUrl;
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <p className="text-sm text-primary-900">
        <strong>Finish setting up</strong> — complete payment to activate {planLabel}.
      </p>
      {user?.role === 'super_admin' && enabled && (
        <button
          onClick={resume}
          disabled={busy}
          className="self-start sm:self-auto min-h-[40px] px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-60"
        >
          {busy ? 'Redirecting to Paystack…' : 'Resume payment'}
        </button>
      )}
    </div>
  );
};
