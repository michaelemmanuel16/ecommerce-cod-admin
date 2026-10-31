/**
 * M6-T13 (F-513): the smooth weighted round robin math. Persistence (restart, parallel picks, reset, alert)
 * is covered in the integration test against the real database.
 */
import { describe, it, expect } from '@jest/globals';
import { swrrPick } from '../../services/assignmentCursor';

describe('swrrPick', () => {
  it('gives an exact 3:1 split over one full cycle, in a fixed order', () => {
    const current = {};
    const order = Array.from({ length: 4 }, () => swrrPick(current, [{ id: 1, weight: 3 }, { id: 2, weight: 1 }]));
    expect(order).toEqual([1, 1, 2, 1]);
    // back to zero after one cycle: the next cycle repeats the same order
    expect(current).toEqual({ 1: 0, 2: 0 });
  });

  it('gives a 60:40 split over 100 picks', () => {
    const current = {};
    const counts: Record<number, number> = { 1: 0, 2: 0 };
    for (let i = 0; i < 100; i++) counts[swrrPick(current, [{ id: 1, weight: 600 }, { id: 2, weight: 400 }])!]++;
    expect(counts).toEqual({ 1: 60, 2: 40 });
  });

  it('spreads a heavy weight between the light ones (smooth)', () => {
    const current = {};
    const order = Array.from({ length: 7 }, () => swrrPick(current, [{ id: 1, weight: 5 }, { id: 2, weight: 1 }, { id: 3, weight: 1 }]));
    expect(order).toEqual([1, 1, 2, 1, 3, 1, 1]);
  });
});
