import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RepEarningsPage } from '../../pages/rep/RepEarningsPage';
import {
  repService,
  type RepEarningsResult,
  type RewardProgressResult,
} from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';

vi.mock('../../services/rep.service', () => ({
  repService: {
    getEarnings: vi.fn(),
    getRewardProgress: vi.fn(),
  },
}));

const mockEarningsResult: RepEarningsResult = {
  currency: 'GHS',
  commission: '2024.00',
  upsellReward: '610.00',
  targetReward: '0.00',
  earned: '2634.00',
  paid: '600.00',
  owed: '2034.00',
  overpaid: null,
  isOverpaid: false,
  openOrdersCount: 154,
  openOrdersNote: '154 of your confirmed orders are still open, each adds GH₵8.00 when delivered.',
  lines: [
    {
      orderId: 1042,
      date: '2026-10-09T10:00:00.000Z',
      customerName: 'Ama Mensah',
      status: 'delivered',
      base: '8.00',
      upsell: '12.00',
      earned: '20.00',
      paid: '0.00',
      reversal: null,
      isReversal: false,
    },
    {
      orderId: 1044,
      date: '2026-10-10T14:00:00.000Z',
      customerName: 'Kofi Badu',
      status: 'returned',
      base: '0.00',
      upsell: '0.00',
      earned: '0.00',
      paid: '0.00',
      reversal: '20.00',
      isReversal: true,
    },
  ],
  payouts: [
    {
      id: 1,
      date: '2026-10-09T12:00:00.000Z',
      amount: '600.00',
      status: 'completed',
      notes: 'October commission',
      method: 'mobile_money',
      reference: 'TX12345',
    },
  ],
};

const mockRewardProgress: RewardProgressResult = {
  period: '2026-10',
  currency: 'GHS',
  target: '423',
  actual: 425,
  percent: 100.5,
  tier: '100',
  tiers: {
    tier100: { amount: '300.00', dayOff: false, payout: true },
    tier120: null,
  },
  reward: { amount: '300.00', dayOff: false },
  distance: null,
  message: 'Target reached',
  note: 'Paid after month close',
  targetReached: true,
  earned: true,
};

describe('M7-T19: Rep Earnings page (F-761)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ currency: 'GHS', loaded: true });
    useAuthStore.setState({
      user: {
        id: 42,
        email: 'adwoa@example.com',
        firstName: 'Adwoa',
        lastName: 'Darko',
        role: 'sales_rep',
        createdAt: '',
        updatedAt: '',
      },
      isAuthenticated: true,
      accessToken: 'token',
    });
    vi.mocked(repService.getEarnings).mockResolvedValue(mockEarningsResult);
    vi.mocked(repService.getRewardProgress).mockResolvedValue(mockRewardProgress);
  });

  it('renders owed, paid and lines breakdown correctly', async () => {
    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('earnings-main-amount')).toHaveTextContent('GH₵2,034');
    });

    expect(screen.getByTestId('line-commission')).toHaveTextContent('GH₵2,024');
    expect(screen.getByTestId('line-upsell')).toHaveTextContent('GH₵610');
    expect(screen.getByTestId('line-upsell')).toHaveTextContent('Share of extra value on delivered orders');
    expect(screen.getByTestId('line-upsell')).not.toHaveTextContent('10%');
    expect(screen.getByTestId('line-paid')).toHaveTextContent('− GH₵600');
    expect(screen.getByTestId('owed-now-amount')).toHaveTextContent('GH₵2,034');

    expect(
      screen.getByText(/154 of your confirmed orders are still open/i)
    ).toBeInTheDocument();
  });

  it('displays "Overpaid GH₵X" when owed is negative / isOverpaid is true', async () => {
    vi.mocked(repService.getEarnings).mockResolvedValueOnce({
      ...mockEarningsResult,
      owed: '-50.00',
      overpaid: '50.00',
      isOverpaid: true,
    });

    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('earnings-main-amount')).toHaveTextContent('Overpaid GH₵50');
      expect(screen.getByTestId('owed-now-amount')).toHaveTextContent('Overpaid GH₵50');
    });
  });

  it('displays reversal line on returned/failed order in order earnings', async () => {
    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('order-line-1044')).toBeInTheDocument();
    });

    // Reversal badge on order 1044
    const reversalBadge = screen.getByTestId('reversal-badge-1044');
    expect(reversalBadge).toBeInTheDocument();
    expect(reversalBadge).toHaveTextContent(/Reversal/);
    expect(reversalBadge).toHaveTextContent(/−GH₵20/);
  });

  it('displays "Paid after month close" when reward target is reached', async () => {
    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reward-target-reached')).toBeInTheDocument();
      expect(screen.getByTestId('reward-target-reached')).toHaveTextContent(
        'Paid after month close'
      );
    });
  });

  it('displays payment history table with payouts', async () => {
    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('payout-row-1')).toBeInTheDocument();
    });

    const row = screen.getByTestId('payout-row-1');
    expect(row).toHaveTextContent('GH₵600');
    expect(row).toHaveTextContent('Paid');
    expect(row).toHaveTextContent('October commission');
  });

  it('a new rep sees zeros and dashes, no errors', async () => {
    vi.mocked(repService.getEarnings).mockResolvedValueOnce({
      currency: 'GHS',
      commission: '0.00',
      upsellReward: '0.00',
      targetReward: '0.00',
      earned: '0.00',
      paid: '0.00',
      owed: '0.00',
      overpaid: null,
      isOverpaid: false,
      openOrdersCount: 0,
      openOrdersNote: '',
      lines: [],
      payouts: [],
    });
    vi.mocked(repService.getRewardProgress).mockResolvedValueOnce({
      period: '2026-10',
      currency: 'GHS',
      target: null,
      actual: 0,
      percent: null,
      tier: 'none',
      tiers: null,
      reward: null,
      distance: null,
      message: 'No target set',
      note: '',
      targetReached: false,
      earned: false,
    });

    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('earnings-main-amount')).toHaveTextContent('GH₵0');
    });

    expect(screen.getByTestId('line-commission')).toHaveTextContent('GH₵0');
    expect(screen.getByTestId('line-upsell')).toHaveTextContent('GH₵0');
    expect(screen.getByTestId('line-paid')).toHaveTextContent('GH₵0');
    expect(screen.getByTestId('owed-now-amount')).toHaveTextContent('GH₵0');

    expect(screen.getByText('No target set')).toBeInTheDocument();
    expect(screen.getByText('No order earnings yet.')).toBeInTheDocument();
    expect(screen.getByText('No payment history yet.')).toBeInTheDocument();
  });

  it('when reward progress fails, earnings still show, reward line shows error and "Try again"', async () => {
    vi.mocked(repService.getEarnings).mockResolvedValueOnce(mockEarningsResult);
    vi.mocked(repService.getRewardProgress).mockRejectedValueOnce(new Error('Network error'));

    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('earnings-main-amount')).toHaveTextContent('GH₵2,034');
    });

    // Earnings data still shows
    expect(screen.getByTestId('line-commission')).toHaveTextContent('GH₵2,024');

    // Reward line shows error and "Try again"
    const rewardLine = screen.getByTestId('reward-progress-line');
    expect(rewardLine).toHaveTextContent('Could not load target reward');
    expect(within(rewardLine).getByRole('button', { name: /try again/i })).toBeInTheDocument();

    // Does NOT show "No target set"
    expect(screen.queryByText('No target set')).not.toBeInTheDocument();
  });

  it('when tiers is null, shows no amount; when tier100.amount is 450.00, shows formatted 450', async () => {
    vi.mocked(repService.getRewardProgress).mockResolvedValueOnce({
      ...mockRewardProgress,
      target: '423',
      tiers: null,
    });

    const { unmount } = render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reward-progress-line')).toBeInTheDocument();
    });

    // tiers: null shows "Target: 423 confirmed and delivered" and no currency amount
    const rewardLine1 = screen.getByTestId('reward-progress-line');
    expect(rewardLine1).toHaveTextContent('Target: 423 confirmed and delivered');
    expect(rewardLine1).not.toHaveTextContent('300');
    expect(rewardLine1).not.toHaveTextContent('GH₵');

    unmount();

    // Now test tier100.amount: '450.00'
    vi.mocked(repService.getRewardProgress).mockResolvedValueOnce({
      ...mockRewardProgress,
      target: '423',
      tiers: {
        tier100: { amount: '450.00', dayOff: false, payout: true },
        tier120: null,
      },
    });

    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('reward-progress-line')).toBeInTheDocument();
    });

    const rewardLine2 = screen.getByTestId('reward-progress-line');
    expect(rewardLine2).toHaveTextContent('GH₵450 at 423 confirmed and delivered (100%)');
    expect(rewardLine2).not.toHaveTextContent('300');
  });

  it('displays deduction row with "Order #<id> returned" and negative amount (COD-193)', async () => {
    vi.mocked(repService.getEarnings).mockResolvedValueOnce({
      ...mockEarningsResult,
      lines: [
        {
          orderId: 1042,
          date: '2026-10-09T10:00:00.000Z',
          customerName: 'Ama Mensah',
          status: 'returned',
          base: '-8.00',
          upsell: '0.00',
          earned: '-8.00',
          paid: '0.00',
          reversal: null,
          isReversal: false,
          isDeduction: true,
          label: 'Order #1042 returned',
        } as any,
      ],
    });

    render(
      <MemoryRouter>
        <RepEarningsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('order-lines-table')).toBeInTheDocument();
    });

    const row = screen.getByTestId('order-line-1042');
    expect(row).toHaveTextContent('Order #1042 returned');
    expect(row).toHaveTextContent('-GH₵8');
  });
});
