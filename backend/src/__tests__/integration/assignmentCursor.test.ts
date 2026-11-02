/**
 * M6-T13 (F-513, F-1162): the assignment cursor against the real database. Restart, 20 parallel picks, weights,
 * an away rep skipped without a reset, a user leaving, and the owner alert when no rep is available.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import logger from '../../utils/logger';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { AssignmentService } from '../../services/assignmentService';
import { pickWithCursor } from '../../services/assignmentCursor';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';

jest.setTimeout(20_000);

const RESET_LOG = 'Assignment cursor reset: the candidate list changed';
let tenantId: string;
let ownerId: number;
let reps: any[];
const all = (rows: any[]) => rows.map((u) => ({ id: u.id, weight: 1 }));
const cursorRow = (scope: string) => prismaBase.assignmentCursor.findUnique({ where: { tenantId_scope_role: { tenantId, scope, role: 'sales_rep' } } });

const run = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const rotation = () => prismaBase.user.findMany({ where: { tenantId, role: 'sales_rep', isActive: true }, orderBy: { id: 'asc' } });
const pickIds = async (users: any[], n: number, key: string, service = new AssignmentService()) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await service.selectUserRoundRobin(users, 'sales_rep', key))!.id);
  return out;
};

beforeAll(async () => {
  tenantId = (await createTenant('Cursor T13')).id;
  ownerId = (await mkUser(tenantId, 'owner', 'admin')).id;
  for (const label of ['a', 'b', 'c']) await mkUser(tenantId, `rep-${label}`, 'sales_rep');
  reps = await rotation();
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('assignment cursor (integration)', () => {
  it('continues the sequence after a restart (new service instance)', async () => {
    const ids = reps.map((u) => u.id);
    expect(await run(() => pickIds(reps, 2, 'restart'))).toEqual([ids[0], ids[1]]);
    expect(await run(() => pickIds(reps, 2, 'restart'))).toEqual([ids[2], ids[0]]);
    expect((await cursorRow('restart'))?.position).toBe(4);
  });

  it('20 parallel picks give an exact 10/10 split', async () => {
    const two = reps.slice(0, 2);
    const picked = await run(() => Promise.all(Array.from({ length: 20 }, () => pickWithCursor('parallel', 'sales_rep', all(two), all(two)))));
    expect(picked.filter((id) => id === two[0].id)).toHaveLength(10);
    expect(picked.filter((id) => id === two[1].id)).toHaveLength(10);
  });

  it('weights 3:1 split exactly over a cycle', async () => {
    const service = new AssignmentService();
    const [a, b] = reps;
    const picks = await run(async () => {
      const out: number[] = [];
      for (let i = 0; i < 8; i++) out.push((await service.selectUserWeighted(reps.slice(0, 2), { [a.id]: 0.75, [b.id]: 0.25 }, 'sales_rep', 'w'))!.id);
      return out;
    });
    expect(picks).toEqual([a.id, a.id, b.id, a.id, a.id, a.id, b.id, a.id]);
  });

  it('a rep who toggles away and back is skipped, and the sequence continues with no reset', async () => {
    const [a, b, c] = reps.map((u) => u.id);
    (logger.info as jest.Mock).mockClear();
    expect(await run(() => pickIds(reps, 1, 'toggle'))).toEqual([a]);
    await prismaBase.user.update({ where: { id: b }, data: { isAvailable: false } });
    expect(await run(async () => pickIds(await rotation(), 2, 'toggle'))).toEqual([c, c]);
    await prismaBase.user.update({ where: { id: b }, data: { isAvailable: true } });
    expect(await run(async () => pickIds(await rotation(), 2, 'toggle'))).toEqual([b, a]);
    expect((logger.info as jest.Mock).mock.calls.filter((c) => c[0] === RESET_LOG)).toHaveLength(0);
  });

  it('a user leaving resets the cursor for the scope, with one log line', async () => {
    (logger.info as jest.Mock).mockClear();
    await run(() => pickIds(reps, 2, 'leave'));
    await run(() => pickIds(reps.slice(0, 2), 1, 'leave'));
    expect((await cursorRow('leave'))?.position).toBe(1);
    expect((logger.info as jest.Mock).mock.calls.filter((c) => c[0] === RESET_LOG)).toHaveLength(1);
  });

  it('all reps unavailable: no pick, no cursor row, one owner alert per hour', async () => {
    const service = new AssignmentService();
    const away = reps.map((u) => ({ ...u, isAvailable: false }));
    for (let i = 0; i < 3; i++) expect(await run(() => service.selectUserRoundRobin(away, 'sales_rep', 'none'))).toBeNull();
    const alerts = await prismaBase.notification.findMany({ where: { tenantId, userId: ownerId, type: 'no_assignee_available' } });
    expect(alerts).toHaveLength(1);
    expect(await cursorRow('none')).toBeNull();
  });
});
