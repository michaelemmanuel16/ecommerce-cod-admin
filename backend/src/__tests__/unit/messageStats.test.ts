/** M9-T08: one definition per Messages figure. */
import { describe, it, expect } from '@jest/globals';
import '../mocks/prisma.mock';
import '../mocks/logger.mock';
import { computeFigures, FIGURE_STATUSES, statusesFor } from '../../services/messaging/messageStats';

describe('computeFigures', () => {
  it('counts each status in the right tiles', () => {
    const f = computeFigures({ pending: 3, sent: 4, delivered: 3, read: 2, replied: 1, failed: 2, skipped: 5 });
    expect(f).toMatchObject({ sent: 12, delivered: 6, read: 3, replied: 1, failed: 2, skipped: 5 });
  });

  it('a read message is delivered and sent; a replied message is read, delivered and sent', () => {
    expect(computeFigures({ read: 1 })).toMatchObject({ sent: 1, delivered: 1, read: 1, replied: 0 });
    expect(computeFigures({ replied: 1 })).toMatchObject({ sent: 1, delivered: 1, read: 1, replied: 1 });
  });

  it('pending and skipped are not sent', () => {
    expect(computeFigures({ pending: 2, skipped: 2 })).toMatchObject({ sent: 0, skipped: 2 });
  });

  it('rates divide by sent, one decimal', () => {
    const f = computeFigures({ sent: 1, delivered: 1, read: 1, failed: 0 });
    expect(f).toMatchObject({ sent: 3, deliveredRate: 66.7, readRate: 33.3, failedRate: 0, replyRate: 0 });
  });

  it('a zero denominator gives null, not 0 or NaN', () => {
    expect(computeFigures({})).toMatchObject({ sent: 0, deliveredRate: null, readRate: null, failedRate: null, replyRate: null });
    expect(computeFigures({ skipped: 4 }).deliveredRate).toBeNull();
  });
});

describe('log status filters use the same sets', () => {
  it('each figure name maps to its set; pending is its own', () => {
    for (const [figure, statuses] of Object.entries(FIGURE_STATUSES)) expect(statusesFor(figure as any)).toEqual(statuses);
    expect(statusesFor('pending')).toEqual(['pending']);
  });
});
