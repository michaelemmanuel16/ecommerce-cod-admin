import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { listFeed, patchRow } from '../../services/inbox/inboxFeedService';

const row = (id: number, subjectType: string | null, subjectId: number | null) => ({
  id, userId: 1, tenantId: 't', kind: 'alert', type: 'late_callback', title: 't', message: 'm', data: {}, isRead: false, readAt: null,
  doneAt: null, snoozedUntil: null, createdAt: new Date(2026, 0, id), actorId: null, subjectType, subjectId,
});

beforeEach(() => {
  (prismaMock.order.findMany as any).mockResolvedValue([{ id: 10 }]);
  (prismaMock.customer.findMany as any).mockResolvedValue([]);
  // the rep Inbox filter (inboxRepFilter.test.ts) finds no own order or conversation rows here, so it adds no reads
  (prismaMock.notification.groupBy as any).mockResolvedValue([]);
});

describe('listFeed subject lookups', () => {
  it('reads each subject type once for the whole page, not once per row', async () => {
    (prismaMock.notification.findMany as any).mockResolvedValue([
      row(5, 'order', 10), row(4, 'order', 11), row(3, 'order', 10), row(2, 'customer', 7), row(1, 'customer', 8),
    ]);
    const res = await listFeed({ id: 1, role: 'sales_rep' }, { view: 'all', status: 'open', scope: 'mine' });
    // one read for "does it exist" and, for a rep, one for "may I still open it" (T20): per page, never per row
    expect(prismaMock.order.findMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.customer.findMany).toHaveBeenCalledTimes(1); // both customers are gone, so no scope read
    expect((prismaMock.order.findMany as any).mock.calls[0][0].where.id.in.sort()).toEqual([10, 11]);
    expect(prismaMock.payout.findMany).not.toHaveBeenCalled();
    expect(res.items.map((i) => i.subjectDeleted)).toEqual([false, true, false, true, true]);
  });

  it('only the owner may ask for scope=all', async () => {
    await expect(listFeed({ id: 1, role: 'manager' }, { view: 'all', status: 'open', scope: 'all' })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('listFeed recipient name (owner Everyone view)', () => {
  const rows = [{ ...row(2, 'order', 10), userId: 7 }, { ...row(1, 'order', 10), userId: 8 }];
  const people = [{ id: 7, firstName: 'Ama', lastName: 'Mensah' }, { id: 8, firstName: 'Kofi', lastName: 'Boateng' }];

  it('names who each row is for when the owner reads everyone', async () => {
    (prismaMock.notification.findMany as any).mockResolvedValue(rows);
    (prismaMock.user.findMany as any).mockResolvedValue(people);
    const res = await listFeed({ id: 1, role: 'super_admin' }, { view: 'all', status: 'open', scope: 'all' });
    expect(res.items.map((i) => i.recipientName)).toEqual(['Ama Mensah', 'Kofi Boateng']);
  });

  it('leaves it empty in the person\'s own view', async () => {
    (prismaMock.notification.findMany as any).mockResolvedValue([{ ...row(1, 'order', 10), userId: 1 }]);
    const res = await listFeed({ id: 1, role: 'super_admin' }, { view: 'all', status: 'open', scope: 'mine' });
    expect(res.items[0].recipientName).toBeNull();
  });
});

describe('patchRow', () => {
  it('refuses a snooze time that is not in the future', async () => {
    (prismaMock.notification.findFirst as any).mockResolvedValue(row(1, null, null));
    await expect(patchRow(1, 1, { snoozedUntil: new Date(Date.now() - 1000) })).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.notification.update).not.toHaveBeenCalled();
  });
  it('404 when the row is not the person\'s', async () => {
    (prismaMock.notification.findFirst as any).mockResolvedValue(null);
    await expect(patchRow(1, 99, { read: true })).rejects.toMatchObject({ statusCode: 404 });
    expect((prismaMock.notification.findFirst as any).mock.calls[0][0].where).toEqual({ id: 99, userId: 1 });
  });
});
