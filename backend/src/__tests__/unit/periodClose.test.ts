import { describe, it, expect } from '@jest/globals';
import { previousMonth } from '../../services/periodCloseService';

describe('month close: which month the job closes', () => {
  it('is the month before now in the store zone (Africa/Accra, UTC+0)', () => {
    expect(previousMonth(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09');
    expect(previousMonth(new Date('2026-10-31T23:59:00Z'))).toBe('2026-09');
    expect(previousMonth(new Date('2026-01-01T03:00:00Z'))).toBe('2025-12');
    expect(previousMonth(new Date('2026-03-01T03:00:00Z'))).toBe('2026-02');
  });
});
