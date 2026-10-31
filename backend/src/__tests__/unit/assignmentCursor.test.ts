/**
 * M6-T13 (F-513): smooth weighted round robin and the cursor behind it. The cursor lives in Redis with the
 * AssignmentCursor table as fallback; here Redis is an in-memory fake and the table is a Map behind the Prisma mock.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';
import { fakeRedis } from '../mocks/redis.mock';
import { useTestTenant } from '../mocks/tenant.mock';
import logger from '../../utils/logger';
import { swrrPick, cursorRedisKey, pickWithCursor } from '../../services/assignmentCursor';
import { AssignmentService } from '../../services/assignmentService';

const user = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, firstName: `U${id}`, lastName: 'T', role: 'sales_rep', isActive: true, isAvailable: true, ...extra }) as any;

describe('swrrPick', () => {
  it('gives an exact 3:1 split over one full cycle, in a fixed order', () => {
    const current = {};
    const order = Array.from({ length: 4 }, () => swrrPick(current, [{ id: 1, weight: 3 }, { id: 2, weight: 1 }]));
    expect(order).toEqual([1, 1, 2, 1]);
    // back to zero after one cycle: the next cycle repeats the same order
    expect(current).toEqual({ 1: 0, 2: 0 });
  });

  it('holds the 3:1 split over many cycles and a 60:40 split over 100 picks', () => {
    const current = {};
    const counts: Record<number, number> = { 1: 0, 2: 0 };
    for (let i = 0; i < 100; i++) counts[swrrPick(current, [{ id: 1, weight: 600 }, { id: 2, weight: 400 }])!]++;
    expect(counts).toEqual({ 1: 60, 2: 40 });
  });

  it('spreads a heavy weight between the light ones (smooth)', () => {
    const current = {};
    const order = Array.from({ length: 7 }, () => swrrPick(current, [{ id: 1, weight: 5 }, { id: 2, weight: 1 }, { id: 3, weight: 1 }]));
    expect(order).toEqual([1, 1, 2, 1, 3, 1, 1]);
  });

  it('returns null with no candidate', () => {
    expect(swrrPick({}, [])).toBeNull();
  });
});

describe('assignment cursor', () => {
  useTestTenant();
  const db = new Map<string, any>();
  let service: AssignmentService;

  beforeEach(() => {
    fakeRedis.reset();
    db.clear();
    service = new AssignmentService();
    const k = (a: any) => JSON.stringify(a.where.tenantId_scope_role);
    (prismaMock.assignmentCursor.findUnique as any).mockImplementation(async (a: any) => db.get(k(a)) ?? null);
    (prismaMock.assignmentCursor.upsert as any).mockImplementation(async (a: any) => {
      const row = { ...(db.get(k(a)) ?? {}), ...(db.has(k(a)) ? a.update : a.create) };
      db.set(k(a), row);
      return row;
    });
    (prismaMock.assignmentCursor.update as any).mockImplementation(async (a: any) => {
      const row = { ...db.get(k(a)), ...a.data };
      db.set(k(a), row);
      return row;
    });
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
    (prismaMock.$queryRaw as any).mockResolvedValue([]);
    (prismaMock.user.findMany as any).mockResolvedValue([]);
    (prismaMock.notification.findFirst as any).mockResolvedValue(null);
  });

  const seq = async (users: any[], n: number, weights?: Record<number, number>, key = 'k') => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = weights ? await service.selectUserWeighted(users, weights, key) : await service.selectUserRoundRobin(users, key);
      out.push(u!.id);
    }
    return out;
  };

  it('weights 3:1 give the exact split and order through the service', async () => {
    const users = [user(1), user(2)];
    expect(await seq(users, 8, { 1: 0.75, 2: 0.25 })).toEqual([1, 1, 2, 1, 1, 1, 2, 1]);
  });

  it('continues the sequence after a restart (new service, memory empty)', async () => {
    const users = [user(1), user(2), user(3)];
    expect(await seq(users, 2)).toEqual([1, 2]);
    service = new AssignmentService();
    expect(await seq(users, 2)).toEqual([3, 1]);
  });

  it('continues from the database when the Redis key is gone', async () => {
    const users = [user(1), user(2), user(3)];
    expect(await seq(users, 2)).toEqual([1, 2]);
    fakeRedis.store.delete(cursorRedisKey('tenant-test', 'k', 'sales_rep'));
    service = new AssignmentService();
    expect(await seq(users, 2)).toEqual([3, 1]);
  });

  it('continues from the database when Redis is down, and Redis reloads it afterwards', async () => {
    const users = [user(1), user(2), user(3)];
    expect(await seq(users, 1)).toEqual([1]);
    fakeRedis.down = true;
    expect(await seq(users, 1)).toEqual([2]);
    fakeRedis.down = false;
    expect(await seq(users, 2)).toEqual([3, 1]);
  });

  it('skips an unavailable user without resetting the cursor', async () => {
    const away = [user(1), user(2, { isAvailable: false }), user(3)];
    expect(await seq(away, 4)).toEqual([1, 3, 1, 3]);
    expect(logger.info).not.toHaveBeenCalledWith('Assignment cursor reset: the candidate list changed', expect.anything());
  });

  it('resets the cursor, with one log line, when a user leaves the list', async () => {
    expect(await seq([user(1), user(2), user(3)], 2)).toEqual([1, 2]);
    expect(await seq([user(1), user(2)], 1)).toEqual([1]);
    const resets = (logger.info as any).mock.calls.filter((c: any[]) => c[0] === 'Assignment cursor reset: the candidate list changed');
    expect(resets).toHaveLength(1);
  });

  it('leaves orders waiting and alerts the owners once an hour when nobody is available', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([{ id: 99 }]);
    (prismaMock.notification.create as any).mockResolvedValue({ id: 1 });
    const none = [user(1, { isAvailable: false }), user(2, { isActive: false })];
    expect(await service.selectUserRoundRobin(none, 'k')).toBeNull();
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect((prismaMock.notification.create as any).mock.calls[0][0].data).toMatchObject({ userId: 99, type: 'no_assignee_available' });

    // a second try inside the window finds the first alert and sends nothing
    (prismaMock.notification.findFirst as any).mockResolvedValue({ id: 1 });
    expect(await service.selectUserRoundRobin(none, 'k')).toBeNull();
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.assignmentCursor.upsert).not.toHaveBeenCalled();
  });

  it('does not crash when the alert itself fails', async () => {
    (prismaMock.user.findMany as any).mockRejectedValue(new Error('db down'));
    expect(await service.selectUserRoundRobin([user(1, { isAvailable: false })], 'k')).toBeNull();
  });

  it('two picks at once never take the same turn', async () => {
    const all = [{ id: 1, weight: 1 }, { id: 2, weight: 1 }];
    const ids = await Promise.all(Array.from({ length: 6 }, () => pickWithCursor('par', 'sales_rep', all, all)));
    expect(ids.filter((id) => id === 1)).toHaveLength(3);
    expect(ids.filter((id) => id === 2)).toHaveLength(3);
  });
});
