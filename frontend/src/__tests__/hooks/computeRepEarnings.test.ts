import { describe, it, expect } from 'vitest';
import { computeRepEarnings } from '../../hooks/useDashboardData';

describe('computeRepEarnings', () => {
  it('multiplies unpaid delivered orders by the rate', () => {
    expect(computeRepEarnings({ unpaidDeliveredOrders: 3 }, { commissionAmount: '5.50' })).toEqual({
      myCommission: '16.50',
      commissionAmount: 5.5,
      unpaidDeliveredCount: 3,
    });
  });

  it('gives 0.00, not nothing, when the rep has no rate', () => {
    expect(computeRepEarnings({ unpaidDeliveredOrders: 3 }, { commissionAmount: 0 }).myCommission).toBe('0.00');
    expect(computeRepEarnings({ unpaidDeliveredOrders: 3 }, {}).myCommission).toBe('0.00');
  });

  it('gives 0.00 when nothing is unpaid', () => {
    expect(computeRepEarnings({}, { commissionAmount: 5 }).myCommission).toBe('0.00');
  });
});
