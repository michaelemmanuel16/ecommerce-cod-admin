/** M9-T07 (COD-78): the 24 hour window and the rep visibility rule. */
import { describe, it, expect } from '@jest/globals';
import { windowOpen, visibilityWhere, WINDOW_MS } from '../../services/messaging/conversationService';
import { conversationPhone } from '../../utils/phone';

describe('windowOpen', () => {
  const now = Date.now();
  it('is closed with no inbound message', () => expect(windowOpen(null, now)).toBe(false));
  it('is open inside 24 hours', () => expect(windowOpen(new Date(now - WINDOW_MS + 60_000), now)).toBe(true));
  it('is closed at 24 hours', () => expect(windowOpen(new Date(now - WINDOW_MS), now)).toBe(false));
});

describe('visibilityWhere', () => {
  it('owner, admin and manager see the whole tenant', () => {
    for (const role of ['super_admin', 'admin', 'manager'] as const) {
      expect(visibilityWhere({ id: 1, role, tenantId: 't' })).toEqual({ tenantId: 't' });
    }
  });
  it('a rep sees conversations assigned to them or of a customer with their order', () => {
    const where = visibilityWhere({ id: 7, role: 'sales_rep', tenantId: 't' }) as any;
    expect(where.tenantId).toBe('t');
    expect(where.OR).toEqual([
      { assignedToId: 7 },
      { customer: { orders: { some: { customerRepId: 7, deletedAt: null } } } },
    ]);
  });
});

describe('conversationPhone', () => {
  it('gives E.164 as stored on Customer', () => {
    expect(conversationPhone('233241110000')).toBe('+233241110000');
    expect(conversationPhone('+233241110000')).toBe('+233241110000');
  });
});
