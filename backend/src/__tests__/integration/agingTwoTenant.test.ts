/**
 * M0-T14 (COD-4): aging refresh and overdue notifications are per tenant.
 * Refreshing tenant B leaves tenant A buckets unchanged; admins of tenant A are
 * never notified about tenant B agents.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import prisma, { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { runInTenant, withoutTenant } from '../../utils/tenantContext';
import agingService from '../../services/agingService';
import { notifyAdminsOverdueCollections } from '../../services/notificationService';
import * as Money from '../../utils/money';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => null),
  hasSocketInstance: jest.fn(() => false),
}));

const SUFFIX = Date.now();
let tenantAId: string;
let tenantBId: string;
let agentAId: number;
let agentBId: number;
let adminAId: number;
let adminBId: number;
let platformAdminId: number;

const makeUser = (tenantId: string | null, label: string, role: string, extra: any = {}) =>
  prismaBase.user.create({
    data: {
      email: `aging-${label}-${SUFFIX}@codadmin.test`,
      password: 'x',
      firstName: label,
      lastName: 'T',
      role: role as any,
      tenantId,
      ...extra,
    },
  });

const bucketRows = (tenantId: string) =>
  prismaBase.agentAgingBucket.findMany({ where: { tenantId } });

beforeAll(async () => {
  const [a, b] = await Promise.all([
    createTenant('Aging A'),
    createTenant('Aging B'),
  ]);
  tenantAId = a.id;
  tenantBId = b.id;
  agentAId = (await makeUser(tenantAId, 'agent-a', 'delivery_agent')).id;
  agentBId = (await makeUser(tenantBId, 'agent-b', 'delivery_agent')).id;
  adminAId = (await makeUser(tenantAId, 'admin-a', 'admin')).id;
  adminBId = (await makeUser(tenantBId, 'admin-b', 'admin')).id;
  platformAdminId = (await makeUser(null, 'platform', 'super_admin', { isPlatformAdmin: true })).id;

  await prismaBase.agentAgingBucket.createMany({
    data: [
      { tenantId: tenantAId, agentId: agentAId, totalBalance: 500, bucket_8_plus: 500 },
      { tenantId: tenantBId, agentId: agentBId, totalBalance: 700, bucket_8_plus: 700 },
    ],
  });
});

afterAll(async () => {
  await prismaBase.notification.deleteMany({ where: { userId: { in: [adminAId, adminBId, platformAdminId] } } });
  await prismaBase.user.deleteMany({ where: { id: platformAdminId } });
  await deleteTenantRows([tenantAId, tenantBId]);
  await prismaBase.$disconnect();
});

describe('aging refresh is per tenant', () => {
  it('refreshAll with no context throws instead of touching every tenant', async () => {
    await expect(agingService.refreshAll()).rejects.toThrow();
    expect(await bucketRows(tenantAId)).toHaveLength(1);
    expect(await bucketRows(tenantBId)).toHaveLength(1);
  });

  it('refreshing tenant B (no outstanding collections) deletes B buckets only', async () => {
    await runInTenant(tenantBId, () => agingService.refreshAll());

    expect(await bucketRows(tenantBId)).toHaveLength(0);
    const a = await bucketRows(tenantAId);
    expect(a).toHaveLength(1);
    expect(a[0].agentId).toBe(agentAId);
    expect(Number(a[0].totalBalance)).toBe(500);
  });
});

describe('overdue notifications are per tenant', () => {
  it('notifies only the admins of the current tenant, never the platform admin', async () => {
    await runInTenant(tenantAId, () =>
      notifyAdminsOverdueCollections([
        { agentId: agentAId, agentName: 'Agent A', totalBalance: Money.parse(500), warningAmount: Money.ZERO, criticalAmount: Money.parse(500) },
      ])
    );

    const rows = await withoutTenant('test', () =>
      prisma.notification.findMany({
        where: { userId: { in: [adminAId, adminBId, platformAdminId] }, type: 'overdue_collections' },
      })
    );
    expect(rows.map((r) => r.userId)).toEqual([adminAId]);
    expect(rows[0].tenantId).toBe(tenantAId);
  });
});
