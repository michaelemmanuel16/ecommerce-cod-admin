import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillingTab } from '../../pages/settings/BillingTab';
import type { BillingPlan, Subscription } from '../../services/billing.service';

const getPlans = vi.fn();
const getSubscription = vi.fn();
const startSubscription = vi.fn();
const cancelSubscription = vi.fn();
vi.mock('../../services/billing.service', () => ({
  billingService: {
    getPlans: (...a: unknown[]) => getPlans(...a),
    getSubscription: (...a: unknown[]) => getSubscription(...a),
    startSubscription: (...a: unknown[]) => startSubscription(...a),
    cancelSubscription: (...a: unknown[]) => cancelSubscription(...a),
  },
}));

const plan = (name: string, displayName: string, over: Partial<BillingPlan> = {}): BillingPlan => ({
  id: name, name, displayName, maxOrders: null, maxUsers: null, priceGHS: 0, priceNGN: null, paystackPlanCode: `PLN_${name}`, features: {}, isActive: true, ...over,
});
const PLANS = [
  plan('free', 'Free'),
  plan('growth', 'Growth', { maxOrders: 5000, maxUsers: 10, priceNGN: 10000 }),
  plan('scale', 'Scale', { priceNGN: 20000 }),
  plan('enterprise', 'Enterprise'),
];
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  plan: PLANS[0], subscriptionStatus: 'active', trialEndsAt: null, subscriptionCode: null, renewsAt: null, paymentFailedAt: null, cardLast4: null,
  freeAccessExpiresAt: null, nextChargeAmount: null, billingEnabled: true, usage: { ordersThisMonth: 1445, maxOrders: null }, ...over,
});
const growth = (orders: number, over: Partial<Subscription> = {}) =>
  sub({ plan: PLANS[1], subscriptionCode: 'SUB_1', renewsAt: '2026-11-12T00:00:00.000Z', nextChargeAmount: 10000, cardLast4: '4081', usage: { ordersThisMonth: orders, maxOrders: 5000 }, ...over });

beforeEach(() => {
  [getPlans, getSubscription, startSubscription, cancelSubscription].forEach((m) => m.mockReset());
  getPlans.mockResolvedValue(PLANS);
  getSubscription.mockResolvedValue(sub());
});

describe('Billing & plans tab (M3-T65, F-1234)', () => {
  it('the Free plan shows as the current plan with no limit and no usage bar', async () => {
    render(<BillingTab />);
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getByText('no limit on your plan')).toBeInTheDocument();
    // No literal "None" on the plan summary (QA-04)
    expect(screen.getByText('No limit')).toBeInTheDocument();
    expect(screen.getByText('Nothing due')).toBeInTheDocument();
    expect(screen.queryByText('None')).not.toBeInTheDocument();
    expect(screen.getByText('1,445')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/near your plan limit/)).not.toBeInTheDocument();
    // Free is not offered in the plan list
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['Growth', 'Scale', 'Enterprise']);
  });

  it('lists the live plans with their prices and limits from the API', async () => {
    render(<BillingTab />);
    await screen.findByText('Growth');
    expect(screen.getByText('₦10,000')).toBeInTheDocument();
    expect(screen.getByText('₦20,000')).toBeInTheDocument();
    expect(screen.getByText('5,000 orders a month')).toBeInTheDocument();
    expect(screen.getByText('10 staff')).toBeInTheDocument();
    expect(screen.getByText('Unlimited orders')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact sales' })).toHaveAttribute('href', 'mailto:sales@codadmin.app');
    expect(screen.getByRole('button', { name: 'Subscribe to Growth' })).toBeInTheDocument();
  });

  it('shows the usage bar for a plan with a limit: 1,445 of 5,000 is 29 percent, no notice', async () => {
    getSubscription.mockResolvedValue(growth(1445));
    render(<BillingTab />);
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '29');
    expect(screen.getByText('of 5,000')).toBeInTheDocument();
    expect(screen.queryByText(/near your plan limit/)).not.toBeInTheDocument();
    expect(screen.getByText(/Renews on/)).toHaveTextContent('card ending 4081');
  });

  it('shows the soft notice from 90 percent and never blocking text', async () => {
    getSubscription.mockResolvedValue(growth(4600));
    const { container } = render(<BillingTab />);
    expect(await screen.findByText('You are near your plan limit.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/over the limit|new orders wait|blocked/i);
    expect(screen.getByRole('button', { name: 'Switch to Scale' })).toBeEnabled();
  });

  it('cancel asks first, keeps access until the cycle end, then reloads the subscription', async () => {
    getSubscription.mockResolvedValue(growth(100));
    cancelSubscription.mockResolvedValue({ status: 'cancelled', accessUntil: '2026-11-12' });
    render(<BillingTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
    expect(screen.getByText(/You keep access until the end of your current billing cycle/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep plan' }));
    expect(cancelSubscription).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
    await waitFor(() => expect(cancelSubscription).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(2));
  });

  it('a failed payment banner stays and offers to update the payment method', async () => {
    getSubscription.mockResolvedValue(growth(100, { subscriptionStatus: 'past_due', paymentFailedAt: '2026-10-20T00:00:00.000Z' }));
    render(<BillingTab />);
    expect(await screen.findByText(/Your last payment failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update payment method' })).toBeInTheDocument();
  });

  it('a plan without a Paystack code, or billing not set up, has no subscribe button', async () => {
    getPlans.mockResolvedValue([PLANS[0], { ...PLANS[1], paystackPlanCode: null }, PLANS[2], PLANS[3]]);
    render(<BillingTab />);
    await screen.findByText('Growth');
    expect(screen.getByText('Billing is being set up')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe to Growth' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subscribe to Scale' })).toBeInTheDocument();
  });

  it('billing not enabled shows the set-up note and no subscribe buttons', async () => {
    getSubscription.mockResolvedValue(sub({ billingEnabled: false }));
    render(<BillingTab />);
    expect(await screen.findByText(/Billing is being set up\. Plans are shown for reference/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subscribe to/ })).not.toBeInTheDocument();
  });
});
