import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { getCounts, listFeed, markAll, repVisibleFilter, roleFilter } from '../../services/inbox/inboxFeedService';
import { repConversationWhere } from '../../services/messaging/conversationScope';
import { visibilityWhere } from '../../services/messaging/conversationService';

const REP = 98;
const pairs = [
  { subjectType: 'order', subjectId: 10 },
  { subjectType: 'order', subjectId: 11 },
  { subjectType: 'conversation', subjectId: 5 },
  { subjectType: 'conversation', subjectId: 6 },
];

beforeEach(() => {
  (prismaMock.notification.groupBy as any).mockResolvedValue(pairs);
  // order 10 is the rep's, order 11 moved to someone else; conversation 5 is theirs, 6 is not
  (prismaMock.order.findMany as any).mockResolvedValue([{ id: 10 }]);
  (prismaMock.conversation.findMany as any).mockResolvedValue([{ id: 5 }]);
  (prismaMock.notification.findMany as any).mockResolvedValue([]);
  (prismaMock.notification.count as any).mockResolvedValue(0);
});

const branch = (f: any, type: string) => f.OR.find((b: any) => b.type === type || (b.type?.in ?? []).includes(type));

describe('repVisibleFilter', () => {
  it('keeps order news only for orders the rep owns now', async () => {
    const f = await repVisibleFilter(REP);
    expect((prismaMock.order.findMany as any).mock.calls[0][0].where).toEqual({ id: { in: [10, 11] }, customerRepId: REP });
    expect(branch(f, 'order_assigned')).toMatchObject({ subjectType: 'order', subjectId: { in: [10] } });
    expect(branch(f, 'late_callback')).toMatchObject({ subjectType: 'order', subjectId: { in: [10] } });
  });

  it('keeps conversation rows only while the rep may open the conversation (A or B)', async () => {
    const f = await repVisibleFilter(REP);
    expect((prismaMock.conversation.findMany as any).mock.calls[0][0].where).toEqual({ id: { in: [5, 6] }, ...repConversationWhere(REP) });
    expect(branch(f, 'customer_reply')).toMatchObject({ subjectType: 'conversation', subjectId: { in: [5] } });
    expect(branch(f, 'conversation_assigned')).toMatchObject({ subjectId: { in: [5] } });
  });

  it('keeps a reminder on a lost order only when the rep created it', async () => {
    const f = await repVisibleFilter(REP);
    const reminder = branch(f, 'reminder_due');
    expect(reminder.OR).toContainEqual({ data: { path: ['createdById'], equals: REP } });
    expect(reminder.OR).toContainEqual({ subjectType: 'order', subjectId: { in: [10] } });
  });

  it('keeps a mention on a customer only while the customer is in the rep scope (customerScope)', async () => {
    (prismaMock.notification.groupBy as any).mockResolvedValue([...pairs, { subjectType: 'customer', subjectId: 7 }, { subjectType: 'customer', subjectId: 8 }]);
    (prismaMock.customer.findMany as any).mockResolvedValue([{ id: 7 }]);
    const f = await repVisibleFilter(REP);
    expect((prismaMock.customer.findMany as any).mock.calls[0][0].where.AND[0]).toEqual({ OR: [{ createdById: REP }, { orders: { some: { customerRepId: REP, deletedAt: null } } }] });
    expect(branch(f, 'mention').OR).toContainEqual({ subjectType: 'customer', subjectId: { in: [7] } });
    expect(branch(f, 'team_note').OR).toContainEqual({ OR: [{ subjectType: null }, { subjectType: { notIn: ['order', 'customer'] } }] });
  });

  it('allows only the rep events: no system, connection, workflow, queue, finding or delivery events', async () => {
    const f = await repVisibleFilter(REP);
    const allowed = f.OR!.flatMap((b: any) => (typeof b.type === 'string' ? [b.type] : b.type.in));
    expect(allowed.sort()).toEqual(['conversation_assigned', 'customer_reply', 'late_callback', 'mention', 'order_assigned', 'payout_paid', 'reminder_due', 'team_note'].sort());
    for (const hidden of ['system_problem', 'connection_error', 'workflow_failed', 'queue_wait', 'delivery_rescheduled', 'finding_assigned', 'overdue_collections', 'target_returned']) {
      expect(allowed).not.toContain(hidden);
    }
  });

  it('skips the order and conversation reads when the rep has no such rows', async () => {
    (prismaMock.notification.groupBy as any).mockResolvedValue([]);
    await repVisibleFilter(REP);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
    expect(prismaMock.conversation.findMany).not.toHaveBeenCalled();
  });
});

describe('roleFilter', () => {
  it('filters a call rep and nobody else', async () => {
    expect(await roleFilter(1, 'manager')).toBeNull();
    expect(await roleFilter(1, 'admin')).toBeNull();
    expect(await roleFilter(1, 'delivery_agent')).toBeNull();
    expect(await roleFilter(REP, 'sales_rep')).not.toBeNull();
  });
  it('looks the role up when the caller does not know it', async () => {
    (prismaMock.user.findFirst as any).mockResolvedValue({ role: 'sales_rep' });
    expect(await roleFilter(REP)).not.toBeNull();
    (prismaMock.user.findFirst as any).mockResolvedValue({ role: 'manager' });
    expect(await roleFilter(1)).toBeNull();
  });
});

describe('the list, the counts and mark all use the same rep filter', () => {
  it('listFeed adds the filter for a rep, not for a manager', async () => {
    await listFeed({ id: REP, role: 'sales_rep' }, { view: 'all', status: 'open', scope: 'mine' });
    const repWhere = JSON.stringify((prismaMock.notification.findMany as any).mock.calls[0][0].where);
    expect(repWhere).toContain('order_assigned');
    (prismaMock.notification.findMany as any).mockClear();
    (prismaMock.notification.groupBy as any).mockClear();
    await listFeed({ id: 1, role: 'manager' }, { view: 'all', status: 'open', scope: 'mine' });
    expect(JSON.stringify((prismaMock.notification.findMany as any).mock.calls[0][0].where)).not.toContain('order_assigned');
  });

  it('getCounts counts only the rows the list shows', async () => {
    (prismaMock.user.findFirst as any).mockResolvedValue({ role: 'sales_rep' });
    (prismaMock.notification.groupBy as any).mockImplementation(async (a: any) => (a.by.includes('kind') ? [{ kind: 'reply', _count: { _all: 2 } }] : pairs));
    const counts = await getCounts(REP);
    expect(counts.all).toBe(2);
    const where = JSON.stringify((prismaMock.notification.groupBy as any).mock.calls.find((c: any) => c[0].by.includes('kind'))[0].where);
    expect(where).toContain('customer_reply');
    expect(where).not.toContain('system_problem');
  });

  it('markAll only touches rows the rep can see', async () => {
    (prismaMock.user.findFirst as any).mockResolvedValue({ role: 'sales_rep' });
    (prismaMock.notification.updateMany as any).mockResolvedValue({ count: 1 });
    await markAll(REP, 'all');
    expect(JSON.stringify((prismaMock.notification.updateMany as any).mock.calls[0][0].where)).toContain('order_assigned');
  });
});

describe('conversation scope for a rep: A (customer has their order) or B (assigned to them)', () => {
  it('visibilityWhere gives exactly A or B inside the tenant, and the manager gets the whole tenant', () => {
    expect(visibilityWhere({ id: 98, role: 'sales_rep', tenantId: 't' })).toEqual({
      tenantId: 't',
      OR: [{ assignedToId: 98 }, { customer: { orders: { some: { customerRepId: 98, deletedAt: null } } } }],
    });
    expect(visibilityWhere({ id: 1, role: 'manager', tenantId: 't' })).toEqual({ tenantId: 't' });
  });
});
