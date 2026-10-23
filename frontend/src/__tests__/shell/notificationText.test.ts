import { describe, it, expect } from 'vitest';
import { notificationText } from '../../components/shell/notificationText';

const stored = { title: 'Overdue Agent Collections', message: '1 agent(s) have overdue collections totaling GHS 232030.00: Logiswift Delivery: GHS 232030.00 (8+ days)' };

describe('notificationText (QA-05)', () => {
  it('writes one overdue partner as a plain sentence', () => {
    const t = notificationText({ ...stored, type: 'overdue_collections', data: { agents: [{ agentName: 'Logiswift Delivery', totalBalance: '232030.00', criticalAmount: '221780.00' }], totalOverdue: '232030.00' } });
    expect(t.title).toBe('Overdue cash collections');
    expect(t.message).toBe('Logiswift Delivery owes GH₵232,030, unpaid for 8+ days');
  });

  it('uses the 4-7 days band when nothing is critical, and sums several partners', () => {
    const one = notificationText({ ...stored, type: 'overdue_collections', data: { agents: [{ agentName: 'VDL Fulfilment', totalBalance: 1500.5, criticalAmount: 0 }] } });
    expect(one.message).toBe('VDL Fulfilment owes GH₵1,500.50, unpaid for 4-7 days');
    const many = notificationText({ ...stored, type: 'overdue_collections', data: { agents: [{ totalBalance: 100 }, { totalBalance: 50 }] } });
    expect(many.message).toBe('2 delivery partners owe GH₵150 in total');
  });

  it('keeps the stored words for other types and for a row without data', () => {
    expect(notificationText({ type: 'order', title: 'New Order Assigned', message: 'You have been assigned', data: undefined })).toEqual({ title: 'New Order Assigned', message: 'You have been assigned' });
    expect(notificationText({ ...stored, type: 'overdue_collections', data: undefined })).toEqual(stored);
  });
});
