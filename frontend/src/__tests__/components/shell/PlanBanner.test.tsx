import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PlanBanner } from '../../../components/shell/PlanBanner';

const getSubscription = vi.fn();
const startSubscription = vi.fn();
vi.mock('../../../services/billing.service', () => ({
  billingService: {
    getSubscription: (...a: unknown[]) => getSubscription(...a),
    startSubscription: (...a: unknown[]) => startSubscription(...a),
  },
}));

const sub = (over: Record<string, unknown>) => ({
  plan: { name: 'growth', displayName: 'Growth' },
  subscriptionStatus: 'pending',
  billingEnabled: true,
  ...over,
});

const renderBanner = () => render(<MemoryRouter><PlanBanner /></MemoryRouter>);

describe('Plan banner (F-108)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('pending: asks to finish payment and sends the plan to Paystack', async () => {
    getSubscription.mockResolvedValue(sub({}));
    startSubscription.mockRejectedValue(new Error('down'));
    renderBanner();
    expect(await screen.findByText(/Complete payment to activate Growth/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume payment' }));
    expect(startSubscription).toHaveBeenCalledWith('growth');
    // the failed start puts the button back
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume payment' })).toBeEnabled());
  });

  it('past due: links to billing and has no payment button', async () => {
    getSubscription.mockResolvedValue(sub({ subscriptionStatus: 'past_due' }));
    renderBanner();
    expect(await screen.findByText(/last payment did not go through/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open billing' })).toHaveAttribute('href', '/settings?tab=billing');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('pending with billing off: links to billing instead of Paystack', async () => {
    getSubscription.mockResolvedValue(sub({ billingEnabled: false }));
    renderBanner();
    expect(await screen.findByRole('link', { name: 'Open billing' })).toBeInTheDocument();
  });

  it('active plan or a failed request shows nothing', async () => {
    getSubscription.mockResolvedValueOnce(sub({ subscriptionStatus: 'active' }));
    const first = renderBanner();
    await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(1));
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();
    getSubscription.mockRejectedValueOnce(new Error('offline'));
    const second = renderBanner();
    await waitFor(() => expect(getSubscription).toHaveBeenCalledTimes(2));
    expect(second.container).toBeEmptyDOMElement();
  });
});
