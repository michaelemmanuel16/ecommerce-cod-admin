/**
 * M6-T13 (F-513, F-1162): the assignment cursor against the real database and Redis. Restart, Redis key gone,
 * Redis down, 20 parallel picks, a user leaving, and the owner alert when no rep is available.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { redis } from '../../middleware/cache.middleware';
import { runInTenant } from '../../utils/tenantContext';
import { AssignmentService } from '../../services/assignmentService';
import { cursorRedisKey, pickWithCursor } from '../../services/assignmentCursor';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';

jest.setTimeout(60_000);

let tenantId: string;
let ownerId: number;
let reps: any[];
const all = (rows: any[], weight = 1) => rows.map((u) => ({ id: u.id, weight }));

const run = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const fresh = () => prismaBase.user.findMany({ where: { tenantId, role: 'sales_rep' }, orderBy: { id: 'asc' } });
const pickIds = async (service: AssignmentService, users: any[], n: number, key: string) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await service.selectUserRoundRobin(users, key))!.id);
  return out;
};

beforeAll(async () => {
  tenantId = (await createTenant('Cursor T13')).id;
  ownerId = (await mkUser(tenantId, 'owner', 'admin')).id;
  for (const label of ['a', 'b', 'c']) await mkUser(tenantId, `rep-${label}`, 'sales_rep');
  reps = await fresh();
});

afterAll(async () => {
  const keys = await redis.keys(`assignment-cursor:${tenantId}:*`);
  if (keys.length) await redis.del(...keys);
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('assignment cursor (integration)', () => {
  it('continues after a restart, and after the Redis key is removed (database fallback)', async () => {
    const ids = reps.map((u) => u.id);
    const first = await run(() => pickIds(new AssignmentService(), reps, 2, 'restart'));
    expect(first).toEqual([ids[0], ids[1]]);

    // a new service instance: nothing in memory
    expect(await run(() => pickIds(new AssignmentService(), reps, 1, 'restart'))).toEqual([ids[2]]);

    // Redis key removed: the DB copy carries the sequence
    await redis.del(cursorRedisKey(tenantId, 'restart', 'sales_rep'));
    expect(await run(() => pickIds(new AssignmentService(), reps, 2, 'restart'))).toEqual([ids[0], ids[1]]);

    const row = await prismaBase.assignmentCursor.findUnique({ where: { tenantId_scope_role: { tenantId, scope: 'restart', role: 'sales_rep' } } });
    expect(row?.position).toBe(5);
  });

  it('continues from the database while Redis is down', async () => {
    const ids = reps.map((u) => u.id);
    expect(await run(() => pickIds(new AssignmentService(), reps, 1, 'down'))).toEqual([ids[0]]);
    const spy = jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis down'));
    const get = jest.spyOn(redis, 'get').mockRejectedValue(new Error('redis down'));
    try {
      expect(await run(() => pickIds(new AssignmentService(), reps, 1, 'down'))).toEqual([ids[1]]);
    } finally {
      spy.mockRestore();
      get.mockRestore();
    }
    expect(await run(() => pickIds(new AssignmentService(), reps, 1, 'down'))).toEqual([ids[2]]);
  });

  it('20 parallel picks give an exact 10/10 split', async () => {
    const two = reps.slice(0, 2);
    const picked = await run(() => Promise.all(Array.from({ length: 20 }, () => pickWithCursor('parallel', 'sales_rep', all(two), all(two)))));
    expect(picked.filter((id) => id === two[0].id)).toHaveLength(10);
    expect(picked.filter((id) => id === two[1].id)).toHaveLength(10);
  });

  it('20 parallel picks through the database path also split exactly', async () => {
    const two = reps.slice(0, 2);
    const set = jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis down'));
    try {
      const picked = await run(() => Promise.all(Array.from({ length: 20 }, () => pickWithCursor('parallel-db', 'sales_rep', all(two), all(two)))));
      expect(picked.filter((id) => id === two[0].id)).toHaveLength(10);
    } finally {
      set.mockRestore();
    }
  });

  it('weights 3:1 split exactly over a cycle, with an unavailable rep skipped', async () => {
    const service = new AssignmentService();
    const [a, b] = reps;
    const weights = { [a.id]: 0.75, [b.id]: 0.25 };
    const picks = await run(async () => {
      const out: number[] = [];
      for (let i = 0; i < 8; i++) out.push((await service.selectUserWeighted(reps.slice(0, 2), weights, 'w'))!.id);
      return out;
    });
    expect(picks.filter((id) => id === a.id)).toHaveLength(6);
    const away = [{ ...a, isAvailable: false }, b];
    expect(await run(() => service.selectUserWeighted(away, weights, 'w-away'))).toMatchObject({ id: b.id });
  });

  it('a user leaving resets the cursor for the scope', async () => {
    const service = new AssignmentService();
    await run(() => pickIds(service, reps, 2, 'leave'));
    await run(() => pickIds(service, reps.slice(0, 2), 1, 'leave'));
    const row = await prismaBase.assignmentCursor.findUnique({ where: { tenantId_scope_role: { tenantId, scope: 'leave', role: 'sales_rep' } } });
    expect(row?.position).toBe(1);
  });

  it('all reps unavailable: no pick, one owner alert per hour', async () => {
    const service = new AssignmentService();
    const away = reps.map((u) => ({ ...u, isAvailable: false }));
    for (let i = 0; i < 3; i++) expect(await run(() => service.selectUserRoundRobin(away, 'none'))).toBeNull();
    const alerts = await prismaBase.notification.findMany({ where: { tenantId, userId: ownerId, type: 'no_assignee_available' } });
    expect(alerts).toHaveLength(1);
    expect(await prismaBase.assignmentCursor.count({ where: { tenantId, scope: 'none' } })).toBe(0);
  });
});
