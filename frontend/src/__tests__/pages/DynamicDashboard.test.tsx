import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DynamicDashboard } from '../../pages/DynamicDashboard';

const useDashboardData = vi.fn();

vi.mock('../../hooks/useDashboardData', () => ({
  useDashboardData: (...args: unknown[]) => {
    useDashboardData(...args);
    return { data: null, loading: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock('../../components/dashboard/DashboardLayout', () => ({ DashboardLayout: () => null }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: () => ({ user: { role: 'admin' } }) }));

describe('DynamicDashboard initial range', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Local noon on 17 Oct: the same calendar day in any time zone.
    vi.setSystemTime(new Date(2026, 9, 17, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('sends month-start and today as yyyy-MM-dd days, not instants', () => {
    render(<DynamicDashboard />);
    const range = useDashboardData.mock.calls[0][1];
    expect(range).toEqual({ preset: 'this_month', startDate: '2026-10-01', endDate: '2026-10-17' });
  });
});
