/** M5 UI fix V2: the Finance range is always store days, so no card shows "1–NaN Oct 2026" when the store holds an end-of-day instant. */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFinanceRange } from '../../pages/financial/profit/range';
import { rangeLabel } from '../../pages/reports/format';
import { useFinancialStore } from '../../stores/financialStore';

beforeEach(() => useFinancialStore.setState({ dateRange: {} }));

describe('useFinanceRange', () => {
  it('turns an end-of-day instant into the store day, so the card title reads as a range', () => {
    useFinancialStore.setState({ dateRange: { startDate: '2026-10-01', endDate: '2026-10-17T12:00:00.000Z' } });
    const { result } = renderHook(() => useFinanceRange());
    expect(result.current).toEqual({ from: '2026-10-01', to: '2026-10-17' });
    expect(rangeLabel(result.current.from, result.current.to)).toBe('1–17 Oct 2026');
  });

  it('keeps plain days as they are, and falls back to this month to today with no choice', () => {
    useFinancialStore.setState({ dateRange: { startDate: '2026-09-03', endDate: '2026-09-09' } });
    expect(renderHook(() => useFinanceRange()).result.current).toEqual({ from: '2026-09-03', to: '2026-09-09' });
    useFinancialStore.setState({ dateRange: {} });
    const { from, to } = renderHook(() => useFinanceRange()).result.current;
    expect(from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
