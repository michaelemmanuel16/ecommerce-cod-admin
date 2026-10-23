import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { Button, Card, Tag, type TagTone } from '../../components/ui-v2';
import { billingService, type BillingPlan, type Subscription } from '../../services/billing.service';
import { formatCurrency, formatDate, formatNumber } from '../../utils/format';

/** Where a person asks for the Enterprise plan. */
const SALES_EMAIL = 'sales@codadmin.app';
/** The soft notice shows from this share of the plan's order limit. Nothing is blocked. */
const NEAR_LIMIT_PERCENT = 90;

const STATUS_TONE: Record<string, TagTone> = { active: 'ok', past_due: 'bad' };
const statusText = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

const limitText = (plan: BillingPlan) => [
  plan.maxOrders ? `${formatNumber(plan.maxOrders)} orders a month` : 'Unlimited orders',
  plan.maxUsers ? `${formatNumber(plan.maxUsers)} staff` : 'Unlimited staff',
];

/**
 * Billing & plans (M3-T65, F-1234). Owner only. Plans, prices and limits come from the plans table through the
 * API. Free is shown only as the current plan, never in the list. Limits are not enforced, so the page only
 * shows a soft notice near the limit and never blocks anything.
 */
export function BillingTab() {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    Promise.all([billingService.getPlans(), billingService.getSubscription()])
      .then(([p, s]) => {
        setPlans(p.filter((x) => x.name !== 'free'));
        setSubscription(s);
      })
      .catch(() => setError('The billing information could not be loaded'))
      .finally(() => setLoading(false));
  }, []);

  const billingEnabled = subscription?.billingEnabled !== false;
  const status = subscription?.subscriptionStatus ?? 'active';
  const current = subscription?.plan ?? null;
  const ordersThisMonth = subscription?.usage.ordersThisMonth ?? 0;
  const maxOrders = subscription?.usage.maxOrders ?? null;
  const percent = maxOrders ? Math.min(100, Math.round((ordersThisMonth / maxOrders) * 100)) : 0;

  const subscribe = async (planName: string) => {
    setBusy(planName);
    setError(null);
    try {
      const { authorizationUrl } = await billingService.startSubscription(planName);
      window.location.href = authorizationUrl;
    } catch {
      setError('Checkout could not be started. Try again.');
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      await billingService.cancelSubscription();
      setSubscription(await billingService.getSubscription());
      setConfirmCancel(false);
    } catch {
      setError('The subscription could not be cancelled. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Card title="Billing & plans"><p className="setnote">Loading...</p></Card>;

  return (
    <>
      {error && <p className="setbar bad" role="alert">{error}</p>}
      {!billingEnabled && <p className="setbar">Billing is being set up. Plans are shown for reference; subscribing will be available shortly.</p>}

      {status === 'past_due' && (
        <div className="setbar bad">
          <span><b>Your last payment failed.</b> {subscription?.paymentFailedAt ? `We could not charge your card on ${formatDate(subscription.paymentFailedAt)}. ` : ''}Authorize again to keep your account active.</span>
          {billingEnabled && current && (
            <Button variant="danger" disabled={busy === current.name} onClick={() => subscribe(current.name)}>
              {busy === current.name ? 'Redirecting to Paystack...' : 'Update payment method'}
            </Button>
          )}
        </div>
      )}
      {status === 'pending' && (
        <div className="setbar warn">
          <span><b>Finish setting up your subscription.</b> Complete payment to start {current ? current.displayName : 'your plan'}.</span>
          {billingEnabled && current && (
            <Button variant="primary" disabled={busy === current.name} onClick={() => subscribe(current.name)}>
              {busy === current.name ? 'Redirecting to Paystack...' : 'Complete payment'}
            </Button>
          )}
        </div>
      )}

      <Card title="Billing & plans" aside={<Tag tone={STATUS_TONE[status] ?? 'warn'}>{statusText(status)}</Tag>}>
        <div className="plan">
          <div><small>Plan</small><div className="big">{current?.displayName ?? 'Free'}</div></div>
          <div><small>Limits</small><div className="big">{maxOrders ? `${formatNumber(maxOrders)} orders` : 'No limit'}</div></div>
          <div>
            <small>Next charge</small>
            <div className="big">{status === 'active' && subscription?.nextChargeAmount != null ? formatCurrency(Number(subscription.nextChargeAmount), 'NGN') : 'Nothing due'}</div>
          </div>
        </div>
        <div className="usage">
          <div className="ut">
            <div>
              <small>Orders this month</small><br />
              <b className="num">{formatNumber(ordersThisMonth)}</b>{' '}
              <span className="muted">{maxOrders ? `of ${formatNumber(maxOrders)}` : 'no limit on your plan'}</span>
            </div>
          </div>
          {maxOrders && (
            <div className="prog" role="progressbar" aria-label="Orders this month" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <i className={percent >= NEAR_LIMIT_PERCENT ? 'gold' : undefined} style={{ width: `${percent}%` }} />
            </div>
          )}
          {maxOrders && percent >= NEAR_LIMIT_PERCENT && <p className="setbar warn">You are near your plan limit.</p>}
          <small className="usagenote">
            {status === 'active' && subscription?.renewsAt && <>Renews on {formatDate(subscription.renewsAt)}{subscription.cardLast4 && ` · card ending ${subscription.cardLast4}`}. </>}
            {current ? 'Plans are billed in ₦. No free trial.' : 'Your plan was set by CodAdmin. Plans are billed in ₦. No free trial. Cancel subscription appears here after you subscribe.'}
          </small>
        </div>
        {status === 'active' && subscription?.subscriptionCode && !confirmCancel && (
          <div className="cardfoot" style={{ justifyContent: 'flex-start' }}>
            <Button variant="danger" onClick={() => setConfirmCancel(true)}>Cancel subscription</Button>
          </div>
        )}
        {confirmCancel && (
          <div className="confirm">
            <p className="setinfo plain">
              You keep access until the end of your current billing cycle{subscription?.renewsAt ? ` (${formatDate(subscription.renewsAt)})` : ''}.
            </p>
            <div className="row">
              <Button onClick={() => setConfirmCancel(false)}>Keep plan</Button>
              <Button variant="danger" disabled={busy === 'cancel'} onClick={cancel}>{busy === 'cancel' ? 'Cancelling...' : 'Cancel subscription'}</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Plans" aside="Billed in ₦ a month">
        <div className="plans">
          {plans.map((plan) => {
            const isCurrent = plan.name === current?.name && status === 'active';
            const enterprise = plan.name === 'enterprise' || plan.priceNGN == null;
            const lines = enterprise ? ['Custom contract', SALES_EMAIL] : limitText(plan);
            return (
              <div className={`pl${isCurrent ? ' cur' : ''}`} key={plan.id}>
                <h4>{plan.displayName}{isCurrent && <Tag tone="ok">Current plan</Tag>}</h4>
                <div className="pr">
                  {enterprise ? <span className="pr-talk">Contact sales</span> : <>{formatCurrency(Number(plan.priceNGN), 'NGN')}<small> a month</small></>}
                </div>
                <ul>{lines.map((l) => <li key={l}><Check aria-hidden="true" />{l}</li>)}</ul>
                {isCurrent ? null : enterprise ? (
                  <a className="btn" href={`mailto:${SALES_EMAIL}`}>Contact sales</a>
                ) : !billingEnabled || !plan.paystackPlanCode ? (
                  <small className="muted">Billing is being set up</small>
                ) : (
                  <Button variant="primary" disabled={busy === plan.name} onClick={() => subscribe(plan.name)}>
                    {busy === plan.name ? 'Redirecting to Paystack...' : `${current && current.name !== 'free' && status === 'active' ? 'Switch to' : 'Subscribe to'} ${plan.displayName}`}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
