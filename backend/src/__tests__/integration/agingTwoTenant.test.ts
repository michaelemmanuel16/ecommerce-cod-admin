/**
 * M0-T14 (COD-4): the aging report, the cash held Findings sync and the overdue notifications are per tenant.
 * Tenant B's partners never show in tenant A's report; syncing B leaves A's Findings alone; admins of tenant A are
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

  await prismaBase.agentBalance.createMany({
    data: [
      { tenantId: tenantAId, agentId: agentAId, currentBalance: -500 },
      { tenantId: tenantBId, agentId: agentBId, currentBalance: -700 },
    ],
  });
});

afterAll(async () => {
  await prismaBase.notification.deleteMany({ where: { userId: { in: [adminAId, adminBId, platformAdminId] } } });
  await prismaBase.user.deleteMany({ where: { id: platformAdminId } });
  await deleteTenantRows([tenantAId, tenantBId]);
  await prismaBase.$disconnect();
});

const findingsOf = (tenantId: string) => prismaBase.finding.findMany({ where: { tenantId, type: 'negative_cash_held' } });

describe('cash held sync and report are per tenant', () => {
  it('the sync with no context throws instead of touching every tenant', async () => {
    await expect(agingService.syncNegativeCashFindings()).rejects.toThrow();
    expect(await findingsOf(tenantAId)).toHaveLength(0);
    expect(await findingsOf(tenantBId)).toHaveLength(0);
  });

  it('syncing tenant B opens B Findings only; syncing A afterwards leaves B alone', async () => {
    await runInTenant(tenantBId, () => agingService.syncNegativeCashFindings());
    expect((await findingsOf(tenantBId)).map((f) => f.subjectId)).toEqual([String(agentBId)]);
    expect(await findingsOf(tenantAId)).toHaveLength(0);

    await runInTenant(tenantAId, () => agingService.syncNegativeCashFindings());
    expect((await findingsOf(tenantAId)).map((f) => f.subjectId)).toEqual([String(agentAId)]);
    const b = await findingsOf(tenantBId);
    expect(b.map((f) => [f.subjectId, f.status, Number(f.amount)])).toEqual([[String(agentBId), 'open', 700]]);
  });

  it('the report of tenant A lists its own partner and never tenant B\'s', async () => {
    const report = await runInTenant(tenantAId, () => agingService.getAgingReport());
    expect(report.partners.map((p) => p.agentId)).toEqual([agentAId]);
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

  it('a second run refreshes the unread alert; after it is read, the next run adds a new one (COD-148)', async () => {
    const notify = (amount: number) =>
      runInTenant(tenantAId, () =>
        notifyAdminsOverdueCollections([
          { agentId: agentAId, agentName: 'Agent A', totalBalance: Money.parse(amount), warningAmount: Money.ZERO, criticalAmount: Money.parse(amount) },
        ])
      );
    const rowsOfA = () =>
      withoutTenant('test', () =>
        prisma.notification.findMany({ where: { userId: adminAId, type: 'overdue_collections' }, orderBy: { id: 'asc' } })
      );

    await notify(700);
    let rows = await rowsOfA();
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain('GHS 700');

    await withoutTenant('test', () => prisma.notification.update({ where: { id: rows[0].id }, data: { isRead: true } }));
    await notify(800);
    rows = await rowsOfA();
    expect(rows).toHaveLength(2);
    expect(rows[1].isRead).toBe(false);
  });
});
