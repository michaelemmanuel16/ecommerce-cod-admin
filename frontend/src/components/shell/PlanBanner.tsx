import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { billingService } from '../../services/billing.service';
import { Button } from '../ui-v2';

/**
 * Plan banner (F-108, MAN-61). Shows for the owner only, when the subscription is `pending` (registered, never
 * paid: recovers abandoned Paystack checkouts) or `past_due`. No hard lockout.
 */
export function PlanBanner() {
  const [plan, setPlan] = useState<{ name: string; label: string; status: 'pending' | 'past_due'; paystack: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    billingService
      .getSubscription()
      .then((s) => {
        if (!active || !s.plan) return;
        if (s.subscriptionStatus === 'pending' || s.subscriptionStatus === 'past_due') {
          setPlan({ name: s.plan.name, label: s.plan.displayName, status: s.subscriptionStatus, paystack: s.billingEnabled !== false });
        }
      })
      .catch(() => {
        // best effort; never block the app
      });
    return () => { active = false; };
  }, []);

  if (!plan) return null;

  const resume = async () => {
    if (!plan.paystack) return;
    setBusy(true);
    try {
      const { authorizationUrl } = await billingService.startSubscription(plan.name);
      window.location.href = authorizationUrl;
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="banner plan" role="status">
      {plan.status === 'pending' ? (
        <span><b>Finish setting up.</b> Complete payment to activate {plan.label}.</span>
      ) : (
        <span><b>Your last payment did not go through.</b> Update billing to keep {plan.label}.</span>
      )}
      {plan.status === 'pending' && plan.paystack ? (
        <Button size="mini" variant="primary" onClick={resume} disabled={busy}>
          {busy ? 'Redirecting to Paystack…' : 'Resume payment'}
        </Button>
      ) : (
        <Link className="mini pri" to="/settings?tab=billing">Open billing</Link>
      )}
    </div>
  );
}
