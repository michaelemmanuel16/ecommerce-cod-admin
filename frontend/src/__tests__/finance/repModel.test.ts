import { describe, it, expect } from 'vitest';
import { repTiles } from '../../pages/financial/repModel';
import type { RepOwedRow } from '../../services/payouts.service';

const rep = (over: Partial<RepOwedRow>): RepOwedRow => ({ id: 1, firstName: 'A', lastName: 'B', delivered: 0, commission: '0.00', upsellReward: '0.00', earned: '0.00', paidInMonth: '0.00', owed: '0.00', targetReward: '0.00', lastPayout: null, ...over } as RepOwedRow);

describe('repTiles (M5 UI fix 26)', () => {
  it('averages the commission over the delivered orders, adds the target rewards and counts the reps paid this month', () => {
    const t = repTiles([
      rep({ id: 1, delivered: 253, commission: '2024.00', paidInMonth: '600.00', targetReward: '10.10' }),
      rep({ id: 2, delivered: 13, commission: '104.00', targetReward: '0.20' }),
    ]);
    expect(t.perOrder).toBeCloseTo(8, 5);
    expect(t.targetRewards).toBeCloseTo(10.3, 5);
    expect(t.repsPaid).toBe(1);
  });

  it('has no per-order figure before anything is delivered', () => {
    expect(repTiles([rep({})]).perOrder).toBeNull();
    expect(repTiles([])).toEqual({ perOrder: null, targetRewards: 0, repsPaid: 0 });
  });
});
