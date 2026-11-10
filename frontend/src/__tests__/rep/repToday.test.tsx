import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RepTodayPage } from '../../pages/rep/RepTodayPage';
import { repService } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';

vi.mock('../../services/rep.service', () => ({
  repService: {
    getToday: vi.fn(),
    getRewardProgress: vi.fn(),
  },
}));

const mockUser = {
  id: 42,
  email: 'adwoa@example.com',
  firstName: 'Adwoa',
  lastName: 'Darko',
  role: 'sales_rep' as const,
  createdAt: '',
  updatedAt: '',
};

describe('M7-T15: Today page and reward card (F-752, F-753)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ currency: 'GHS', loaded: true });
    useAuthStore.setState({
      user: mockUser,
      isAuthenticated: true,
      accessToken: 'token',
    });
  });

  describe('Full stats and active reward target', () => {
    it('renders hero, calls done, confirmed, upsell, and KPI tiles', async () => {
      vi.mocked(repService.getToday).mockResolvedValue({
        callsDone: 41,
        confirmed: 19,
        upsellExtra: '240.00',
        timeToFirstCall: {
          medianMinutes: 12,
          operatingHoursSet: true,
          targetMinutes: 15,
          alertMinutes: 30,
        },
        targetProgress: {
          hasTarget: true,
          message: '170 more to GH₵300',
          target: '423',
          actual: 253,
          percent: 59.8,
          tier: 'none',
          metric: 'confirmed_delivered',
          unit: 'orders',
        },
        confirmationRate: 73,
        deliveredFromConfirmed: 52,
      });

      vi.mocked(repService.getRewardProgress).mockResolvedValue({
        period: '2026-10',
        currency: 'GHS',
        target: '423',
        actual: 253,
        percent: 59.8,
        tier: 'none',
        tiers: {
          tier100: { amount: '300.00', dayOff: false, payout: true },
          tier120: { amount: '500.00', dayOff: true, payout: true },
        },
        reward: null,
        distance: { next: '100', amount: 170, unit: 'confirmed orders', message: '170 more confirmed orders that get delivered to reach 100% (GH₵300)' },
        message: '170 more to GH₵300',
        note: 'The reward is paid after month close.',
        targetReached: false,
        earned: false,
      });

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      // Hero
      await waitFor(() => {
        expect(screen.getByTestId('b-today')).toHaveTextContent('19');
      });
      expect(screen.getByTestId('confirmed-hero')).toHaveTextContent('Calls done: 41');
      expect(screen.getByTestId('confirmed-hero')).toHaveTextContent('240');

      // KPI tiles
      expect(screen.getByTestId('confirmation-rate-value')).toHaveTextContent('73%');
      expect(screen.getByTestId('delivered-rate-value')).toHaveTextContent('52%');
      expect(screen.getByTestId('ttfc-value')).toHaveTextContent('12 min');

      // Reward card
      expect(screen.getByTestId('reward-tag')).toHaveTextContent('170 more to GH₵300');
      expect(screen.getByTestId('b-conf')).toHaveTextContent('253');
      expect(screen.getByTestId('reward-progress-bar')).toBeInTheDocument();
      expect(screen.getByTestId('reward-progress-fill')).toHaveStyle({ width: '59.8%' });

      // Tiers from API
      expect(screen.getByTestId('tier-100')).toHaveTextContent('GH₵300');
      expect(screen.getByTestId('tier-100')).toHaveTextContent('170 more confirmed orders');
      expect(screen.getByTestId('tier-100')).not.toHaveTextContent('[object Object]');
      expect(screen.getByTestId('tier-120')).toHaveTextContent('GH₵500 + paid day off');

      // No 80% tier mentioned
      expect(screen.queryByText(/80%/)).not.toBeInTheDocument();
    });

    it('displays "Paid after month close" when target is reached', async () => {
      vi.mocked(repService.getToday).mockResolvedValue({
        callsDone: 50,
        confirmed: 25,
        upsellExtra: '500.00',
        timeToFirstCall: { medianMinutes: 10, operatingHoursSet: true, targetMinutes: 15, alertMinutes: 30 },
        targetProgress: {
          hasTarget: true,
          message: 'You reached 100%. Paid after month close.',
          target: '423',
          actual: 430,
          percent: 101.6,
          tier: '100',
        },
        confirmationRate: 80,
        deliveredFromConfirmed: 60,
      });

      vi.mocked(repService.getRewardProgress).mockResolvedValue({
        period: '2026-10',
        currency: 'GHS',
        target: '423',
        actual: 430,
        percent: 101.6,
        tier: '100',
        tiers: {
          tier100: { amount: '300.00', dayOff: false, payout: true },
          tier120: { amount: '500.00', dayOff: true, payout: true },
        },
        reward: { amount: '300.00', dayOff: false },
        distance: { next: '120', amount: 85, unit: 'confirmed orders', message: '85 more confirmed orders that get delivered to reach 120%' },
        message: 'You reached 100%. Paid after month close.',
        note: 'Paid after month close',
        targetReached: true,
        earned: true,
      });

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('reward-tag')).toHaveTextContent('Paid after month close');
      });
      expect(screen.getByTestId('reward-note')).toHaveTextContent('Paid after month close');
    });
  });

  describe('No target set state', () => {
    it('displays "No target set" and hides the progress bar when API says so', async () => {
      vi.mocked(repService.getToday).mockResolvedValue({
        callsDone: 10,
        confirmed: 5,
        upsellExtra: '0.00',
        timeToFirstCall: { medianMinutes: 20, operatingHoursSet: true, targetMinutes: 15, alertMinutes: 30 },
        targetProgress: {
          hasTarget: false,
          message: 'No target set',
          target: null,
          actual: null,
          percent: null,
          tier: 'none',
        },
        confirmationRate: 50,
        deliveredFromConfirmed: null,
      });

      vi.mocked(repService.getRewardProgress).mockResolvedValue({
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
        note: 'The reward is paid after month close.',
        targetReached: false,
        earned: false,
      });

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('no-target-tag')).toHaveTextContent('No target set');
      });

      // Progress bar must be hidden
      expect(screen.queryByTestId('reward-progress-bar')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tier-100')).not.toBeInTheDocument();
    });
  });

  describe('Empty state for a new rep', () => {
    it('shows zeros and dashes without errors when a new rep has no history', async () => {
      vi.mocked(repService.getToday).mockResolvedValue({
        callsDone: 0,
        confirmed: 0,
        upsellExtra: '0.00',
        timeToFirstCall: {
          medianMinutes: null,
          operatingHoursSet: true,
          targetMinutes: 15,
          alertMinutes: 30,
        },
        targetProgress: {
          hasTarget: false,
          message: 'No target set',
          target: null,
          actual: null,
          percent: null,
          tier: 'none',
        },
        confirmationRate: null,
        deliveredFromConfirmed: null,
      });

      vi.mocked(repService.getRewardProgress).mockResolvedValue({
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
        note: 'The reward is paid after month close.',
        targetReached: false,
        earned: false,
      });

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      // Hero shows 0 confirmed
      await waitFor(() => {
        expect(screen.getByTestId('b-today')).toHaveTextContent('0');
      });
      expect(screen.getByTestId('confirmed-hero')).toHaveTextContent('Calls done: 0');

      // KPI tiles show dashes ("—")
      expect(screen.getByTestId('confirmation-rate-value')).toHaveTextContent('—');
      expect(screen.getByTestId('delivered-rate-value')).toHaveTextContent('—');
      expect(screen.getByTestId('ttfc-value')).toHaveTextContent('—');

      // Reward card shows No target set and hides bar
      expect(screen.getByTestId('no-target-tag')).toHaveTextContent('No target set');
      expect(screen.queryByTestId('reward-progress-bar')).not.toBeInTheDocument();
    });
  });

  describe('Tiers null handling (item 4)', () => {
    it('shows no tier row and no fixed amount when tiers is null', async () => {
      vi.mocked(repService.getToday).mockResolvedValue({
        callsDone: 20,
        confirmed: 10,
        upsellExtra: '100.00',
        timeToFirstCall: { medianMinutes: 10, operatingHoursSet: true, targetMinutes: 15, alertMinutes: 30 },
        targetProgress: {
          hasTarget: true,
          message: '170 more',
          target: '400',
          actual: 230,
          percent: 57.5,
          tier: 'none',
        },
        confirmationRate: 75,
        deliveredFromConfirmed: 60,
      });

      vi.mocked(repService.getRewardProgress).mockResolvedValue({
        period: '2026-10',
        currency: 'GHS',
        target: '400',
        actual: 230,
        percent: 57.5,
        tier: 'none',
        tiers: null,
        reward: null,
        distance: { next: '100', amount: 170, unit: 'confirmed orders', message: '170 more confirmed orders that get delivered to reach 100%' },
        message: '170 more',
        note: 'The reward is paid after month close.',
        targetReached: false,
        earned: false,
      });

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('b-conf')).toHaveTextContent('230');
      });

      // When tiers is null, tier row must NOT be shown
      expect(screen.queryByTestId('reward-tiers-row')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tier-100')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tier-120')).not.toBeInTheDocument();

      // No fixed amounts (300 or 500) shown
      expect(screen.queryByText(/GH₵300/)).not.toBeInTheDocument();
      expect(screen.queryByText(/GH₵500/)).not.toBeInTheDocument();
    });
  });

  describe('Error handling (item 6)', () => {
    it('shows error state with "Try again" button, not "No target set" or zeros when load fails', async () => {
      vi.mocked(repService.getToday).mockRejectedValue(new Error('Network error'));
      vi.mocked(repService.getRewardProgress).mockRejectedValue(new Error('Network error'));

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('today-error-state')).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      expect(screen.queryByTestId('no-target-tag')).not.toBeInTheDocument();
      expect(screen.queryByTestId('confirmed-hero')).not.toBeInTheDocument();
    });

    it('recovers when "Try again" is clicked after a failure', async () => {
      const user = userEvent.setup();
      vi.mocked(repService.getToday).mockRejectedValueOnce(new Error('Network error'));
      vi.mocked(repService.getRewardProgress).mockRejectedValueOnce(new Error('Network error'));

      render(
        <MemoryRouter>
          <RepTodayPage />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId('today-error-state')).toBeInTheDocument();
      });

      // Now mock successful response
      vi.mocked(repService.getToday).mockResolvedValue({
        callsDone: 15,
        confirmed: 8,
        upsellExtra: '0.00',
        timeToFirstCall: { medianMinutes: 12, operatingHoursSet: true, targetMinutes: 15, alertMinutes: 30 },
        targetProgress: {
          hasTarget: false,
          message: 'No target set',
          target: null,
          actual: null,
          percent: null,
          tier: 'none',
        },
        confirmationRate: 60,
        deliveredFromConfirmed: null,
      });

      vi.mocked(repService.getRewardProgress).mockResolvedValue({
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
        note: 'The reward is paid after month close.',
        targetReached: false,
        earned: false,
      });

      await user.click(screen.getByRole('button', { name: 'Try again' }));

      await waitFor(() => {
        expect(screen.getByTestId('b-today')).toHaveTextContent('8');
      });
      expect(screen.queryByTestId('today-error-state')).not.toBeInTheDocument();
    });
  });
});
