import { describe, it, expect } from '@jest/globals';
import { OrderStatus } from '@prisma/client';
import { REP_ORDER_GROUPS } from '../../services/repService';

describe('REP_ORDER_GROUPS', () => {
  it('puts every OrderStatus in exactly one bucket', () => {
    const all: string[] = [
      ...REP_ORDER_GROUPS.pending,
      ...REP_ORDER_GROUPS.in_progress,
      ...REP_ORDER_GROUPS.finished,
    ];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.values(OrderStatus).sort());
  });
});
