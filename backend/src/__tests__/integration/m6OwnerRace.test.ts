/** COD-56 T03 follow-up: two unassigns at once cannot remove the last Owner (the holders are locked inside the transaction). */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { unassign } from '../../services/roleAssignmentService';

jest.setTimeout(90_000);

let pair: TwoTenants;
let ownerRoleId: number;
let actor: number;
let assignments: number[] = [];
const userIds: number[] = [];

beforeAll(async () => {
  pair = await createTwoTenants('m6ownerrace');
  const tenantId = pair.a.id;
  ownerRoleId = pair.a.ids.role;
  // Start from exactly two active holders.
  await prismaBase.roleAssignment.updateMany({ where: { roleId: ownerRoleId, toDate: null }, data: { toDate: new Date('2026-01-01') } });
  for (const n of ['One', 'Two']) {
    const u = await prismaBase.user.create({ data: { email: `${n}-ownerrace@codadmin.test`, password: 'x', firstName: n, lastName: 'O', role: 'super_admin', tenantId } });
    userIds.push(u.id);
    assignments.push((await prismaBase.roleAssignment.create({ data: { tenantId, roleId: ownerRoleId, holderId: u.id, fromDate: new Date('2026-01-01') } })).id);
  }
  actor = userIds[0];
});

afterAll(async () => {
  await prismaBase.roleAssignment.deleteMany({ where: { holderId: { in: userIds } } });
  await prismaBase.user.deleteMany({ where: { id: { in: userIds } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('last Owner race', () => {
  it('two unassigns at the same time: one succeeds, the other gets LAST_OWNER, one Owner is left', async () => {
    const results = await Promise.allSettled(assignments.map((id) =>
      runInTenant(pair.a.id, () => unassign({ id: actor, role: 'super_admin' }, ownerRoleId, id))));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ statusCode: 409, errorCode: 'LAST_OWNER' });
    expect(await prismaBase.roleAssignment.count({ where: { roleId: ownerRoleId, toDate: null } })).toBe(1);
  });
});
