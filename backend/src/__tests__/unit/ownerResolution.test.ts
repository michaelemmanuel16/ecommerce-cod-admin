import { describe, it, expect } from '@jest/globals';
import { pickDeterministicOwner, OWNER_TIEBREAK_ORDER_BY } from '../../utils/ownerResolution';

const u = (id: number, createdAt: string) => ({ id, createdAt: new Date(createdAt) });

describe('pickDeterministicOwner (MAN-85 deterministic owner tiebreak)', () => {
  it('returns null when there are no candidates', () => {
    expect(pickDeterministicOwner([])).toBeNull();
  });

  it('picks the earliest createdAt', () => {
    const picked = pickDeterministicOwner([
      u(5, '2024-02-01T00:00:00Z'),
      u(3, '2024-01-01T00:00:00Z'),
      u(9, '2024-03-01T00:00:00Z'),
    ]);
    expect(picked?.id).toBe(3);
  });

  it('breaks createdAt ties by the lowest id', () => {
    const picked = pickDeterministicOwner([
      u(9, '2024-01-01T00:00:00Z'),
      u(2, '2024-01-01T00:00:00Z'),
      u(7, '2024-01-01T00:00:00Z'),
    ]);
    expect(picked?.id).toBe(2);
  });

  it('is stable regardless of input order', () => {
    const a = pickDeterministicOwner([u(2, '2024-01-01T00:00:00Z'), u(1, '2024-01-02T00:00:00Z')]);
    const b = pickDeterministicOwner([u(1, '2024-01-02T00:00:00Z'), u(2, '2024-01-01T00:00:00Z')]);
    expect(a?.id).toBe(2);
    expect(b?.id).toBe(2);
  });

  it('encodes the canonical rule in the Prisma orderBy (createdAt asc, then id asc)', () => {
    expect(OWNER_TIEBREAK_ORDER_BY).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});
