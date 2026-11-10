import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RepNumbersPage } from '../../pages/rep/RepNumbersPage';
import { repService, type RepNumbersResult } from '../../services/rep.service';
import { useAuthStore } from '../../stores/authStore';
import { useConfigStore } from '../../stores/configStore';

vi.mock('../../services/rep.service', () => ({
  repService: {
    getNumbers: vi.fn(),
  },
}));

const mockNumbersResult: RepNumbersResult = {
  repId: 42,
  period: '1–17 Oct',
  confirmed: 640,
  confirmationRate: 73,
  confirmationRateDetail: { confirmed: 640, placed: 876, autoConfirmed: 0 },
  deliveredFromConfirmedRate: 52,
  deliveredFromConfirmedDetail: { delivered: 253, failed: 120, returned: 113, closed: 486 },
  upsellRate: 24,
  extraValueAdded: '6100.00',
  timeToFirstCall: 12,
  targetHit: {
    target: 423,
    actual: 253,
    percent: 60,
  },
  ranks: {
    callRep: { rank: 1, total: 3 },
    upsell: { rank: 1, total: 3 },
  },
  orderBreakdown: {
    confirmed: 640,
    delivered: 253,
    failedOrReturned: 233,
    stillOpen: 154,
  },
  calls: {
    today: 41,
    thisWeek: 480,
    thisMonth: 1360,
    averagePerDay: 80,
  },
  callOutcomes: {
    confirmed: 640,
    not_reachable: 300,
    declined: 190,
    call_back_later: 150,
    wrong_number: 80,
  },
  callsPerDay: [
    { date: '2026-10-04', count: 74, isToday: false },
    { date: '2026-10-05', count: 81, isToday: false },
    { date: '2026-10-06', count: 88, isToday: false },
    { date: '2026-10-07', count: 69, isToday: false },
    { date: '2026-10-08', count: 92, isToday: false },
    { date: '2026-10-09', count: 85, isToday: false },
    { date: '2026-10-10', count: 78, isToday: false },
    { date: '2026-10-11', count: 71, isToday: false },
    { date: '2026-10-12', count: 83, isToday: false },
    { date: '2026-10-13', count: 90, isToday: false },
    { date: '2026-10-14', count: 76, isToday: false },
    { date: '2026-10-15', count: 84, isToday: false },
    { date: '2026-10-16', count: 79, isToday: false },
    { date: '2026-10-17', count: 41, isToday: true },
  ],
};

describe('M7-T19: Rep Numbers page (F-762)', () => {
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
    vi.mocked(repService.getNumbers).mockResolvedValue(mockNumbersResult);
  });

  it('uses wording "Delivery success" and NEVER "delivery rate"', async () => {
    render(
      <MemoryRouter>
        <RepNumbersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-delivery-success')).toBeInTheDocument();
    });

    const deliveryKpi = screen.getByTestId('kpi-delivery-success');
    expect(deliveryKpi).toHaveTextContent('Delivery success');
    expect(deliveryKpi).toHaveTextContent('52%');
    expect(deliveryKpi).toHaveTextContent('253 delivered');

    // Strict rule check: "never delivery rate" anywhere on the page
    const textContent = document.body.textContent || '';
    expect(textContent.toLowerCase()).not.toContain('delivery rate');
  });

  it('renders rank and rates exactly as API returns them', async () => {
    render(
      <MemoryRouter>
        <RepNumbersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-confirmed')).toHaveTextContent('640');
    });

    expect(screen.getByTestId('kpi-confirmation-rate')).toHaveTextContent('73%');
    expect(screen.getByTestId('kpi-upsell-rate')).toHaveTextContent('24%');
    expect(screen.getByTestId('kpi-extra-value')).toHaveTextContent('GH₵6,100');
    expect(screen.getByTestId('kpi-time-to-first-call')).toHaveTextContent('12 min');

    const callRepsRank = screen.getByTestId('rank-call-reps');
    expect(callRepsRank).toHaveTextContent('1st of 3');

    const upsellRank = screen.getByTestId('rank-upsell');
    expect(upsellRank).toHaveTextContent('1st of 3');
  });

  it('renders breakdown stacked bar and call outcome statistics', async () => {
    render(
      <MemoryRouter>
        <RepNumbersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('orders-stack-legend')).toBeInTheDocument();
    });

    const breakdownLegend = screen.getByTestId('orders-stack-legend');
    expect(breakdownLegend).toHaveTextContent('Delivered 253');
    expect(breakdownLegend).toHaveTextContent('Failed or returned 233');
    expect(breakdownLegend).toHaveTextContent('Still open 154');

    const callsRow = screen.getByTestId('calls-row');
    expect(callsRow).toHaveTextContent('41');
    expect(callsRow).toHaveTextContent('480');
    expect(callsRow).toHaveTextContent('1360');
    expect(callsRow).toHaveTextContent('80');

    const outcomesLegend = screen.getByTestId('outcomes-stack-legend');
    expect(outcomesLegend).toHaveTextContent('Confirmed 640');
    expect(outcomesLegend).toHaveTextContent('Not reachable 300');
    expect(outcomesLegend).toHaveTextContent('Declined 190');
    expect(outcomesLegend).toHaveTextContent('Call back 150');
    expect(outcomesLegend).toHaveTextContent('Wrong number or other 80');
  });

  it('a new rep sees zeros and dashes, no errors', async () => {
    vi.mocked(repService.getNumbers).mockResolvedValueOnce({
      repId: 42,
      period: '1–10 Nov',
      confirmed: 0,
      confirmationRate: null,
      confirmationRateDetail: { confirmed: 0, placed: 0, autoConfirmed: 0 },
      deliveredFromConfirmedRate: null,
      deliveredFromConfirmedDetail: { delivered: 0, failed: 0, returned: 0, closed: 0 },
      upsellRate: 0,
      extraValueAdded: '0.00',
      timeToFirstCall: null,
      targetHit: null,
      ranks: {
        callRep: null,
        upsell: null,
      },
      orderBreakdown: {
        confirmed: 0,
        delivered: 0,
        failedOrReturned: 0,
        stillOpen: 0,
      },
      calls: {
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        averagePerDay: 0,
      },
      callOutcomes: {},
      callsPerDay: [],
    });

    render(
      <MemoryRouter>
        <RepNumbersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-confirmed')).toHaveTextContent('0');
    });

    // Null rates display as dashes "—"
    expect(screen.getByTestId('kpi-confirmation-rate')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-delivery-success')).toHaveTextContent('—');
    expect(screen.getByTestId('kpi-time-to-first-call')).toHaveTextContent('—');

    // Ranks display as dashes "—"
    expect(screen.getByTestId('rank-call-reps')).toHaveTextContent('—');
    expect(screen.getByTestId('rank-upsell')).toHaveTextContent('—');

    // 0 extra value
    expect(screen.getByTestId('kpi-extra-value')).toHaveTextContent('GH₵0');

    // Breakdown and calls show 0
    expect(screen.getByTestId('orders-stack-legend')).toHaveTextContent('Delivered 0');
    expect(screen.getByTestId('calls-row')).toHaveTextContent('0');
  });

  it('confirmation rate shows "Confirmed ÷ finished this month" and no "target 70%"', async () => {
    render(
      <MemoryRouter>
        <RepNumbersPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-confirmation-rate')).toBeInTheDocument();
    });

    const kpi = screen.getByTestId('kpi-confirmation-rate');
    expect(kpi).toHaveTextContent('Confirmed ÷ finished this month');
    expect(kpi).not.toHaveTextContent('target 70%');
    expect(document.body.textContent).not.toContain('target 70%');
  });
});
