import { describe, it, expect } from 'vitest';
import { shortDate } from '../../pages/orders/model';
import { accraTime } from '../../pages/orders/drawer/model';

describe('order time (T2)', () => {
  it('the list and the drawer write the same time for one order, in store time whatever the browser zone', () => {
    for (const iso of ['2026-10-22T18:56:00Z', '2026-10-17T23:30:00Z', '2026-12-31T23:59:00Z']) {
      expect(shortDate(iso)).toBe(accraTime(iso));
    }
    expect(shortDate('2026-10-22T18:56:00Z')).toBe('22 Oct, 18:56');
    // an hour before midnight UTC stays on its UTC day, also for a browser one hour ahead
    expect(shortDate('2026-10-17T23:30:00Z')).toBe('17 Oct, 23:30');
  });
});
