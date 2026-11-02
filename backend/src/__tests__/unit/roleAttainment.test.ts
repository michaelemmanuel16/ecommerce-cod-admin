/** M6-T25: the role progress rule (was in the frontend's buildGroups / roleProgress): sum for counts, average for a rate, "behind" wins. */
import { describe, it, expect } from '@jest/globals';
import { roleAttainmentOf, type AttainmentLine } from '../../services/roleAttainment';

const behind = { key: 'behind' as const, label: 'Behind' };
const ahead = { key: 'ahead' as const, label: 'Ahead' };
const line = (userId: number, over: Partial<AttainmentLine> = {}): AttainmentLine =>
  ({ userId, target: '100.00', unit: 'count', actual: 0, status: null, ...over });
const rows = (...lines: AttainmentLine[]) => new Map(lines.map((l) => [l.userId, l]));

describe('roleAttainmentOf', () => {
  it('adds up the holders against a count target', () => {
    const r = roleAttainmentOf({ unit: 'count', value: 723 }, [1, 2], rows(line(1, { actual: 200, status: ahead }), line(2, { actual: 176, status: ahead })));
    expect(r).toEqual({ done: 376, target: 723, percent: 52, rate: false, status: ahead });
  });

  it('is the average rate of the holders against a rate target', () => {
    const r = roleAttainmentOf({ unit: 'percent', value: 80 }, [1, 2], rows(
      line(1, { unit: 'percent', target: '80.00', actual: 40, status: behind }), line(2, { unit: 'percent', target: '80.00', actual: 56, status: ahead }),
    ));
    expect(r).toMatchObject({ done: 48, target: 80, percent: 60, rate: true });
  });

  it('"behind" wins over the first holder\'s word', () => {
    const r = roleAttainmentOf({ unit: 'count', value: 100 }, [1, 2], rows(line(1, { actual: 50, status: ahead }), line(2, { actual: 10, status: behind })));
    expect(r?.status).toEqual(behind);
  });

  it('leaves out a holder with no target, no actual, or a target of another kind; null when none counts or the role has no target', () => {
    const r = roleAttainmentOf({ unit: 'count', value: 100 }, [1, 2, 3, 4], rows(
      line(1, { actual: 30 }), line(2, { target: null, actual: 99 }), line(3, { actual: null }), line(4, { unit: 'percent', actual: 90 }),
    ));
    expect(r).toMatchObject({ done: 30, percent: 30 });
    expect(roleAttainmentOf({ unit: 'count', value: 100 }, [2, 3], rows(line(2, { target: null }), line(3, { actual: null })))).toBeNull();
    expect(roleAttainmentOf(null, [1], rows(line(1, { actual: 5 })))).toBeNull();
  });

  it('does not cap the percent', () => {
    expect(roleAttainmentOf({ unit: 'count', value: 100 }, [1], rows(line(1, { actual: 130 })))?.percent).toBe(130);
  });
});
