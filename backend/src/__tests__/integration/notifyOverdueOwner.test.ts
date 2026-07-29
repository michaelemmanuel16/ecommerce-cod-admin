/**
 * Overdue-collections notify routes to the store OWNER (MAN-95)
 *
 * The aging cron runs cross-tenant. It used to notify every admin/super_admin
 * across every tenant — store A's collections leaked to store B's admins. It now
 * groups overdue agents by store and pages that store's owner resolved by the
 * Tenant.ownerUserId FK. This test proves each owner is notified only about their
 * own store's agents, and a non-owner admin is not notified at all.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { notifyAdminsOverdueCollections } from '../../services/notificationService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));
jest.mock('../../sockets', () => ({ emitNotification: jest.fn() }));

const SUFFIX = Date.now();

let tenantAId: string; let tenantBId: string;
let ownerAId: number; let ownerBId: number; let adminAId: number;

beforeAll(async () => {
  const [ta, tb] = await Promise.all([
    prismaBase.tenant.create({ data: { name: `A ${SUFFIX}`, slug: `a-${SUFFIX}`, subscriptionStatus: 'active' } }),
    prismaBase.tenant.create({ data: { name: `B ${SUFFIX}`, slug: `b-${SUFFIX}`, subscriptionStatus: 'active' } }),
  ]);
  tenantAId = ta.id; tenantBId = tb.id;

  const ownerA = await prismaBase.user.create({ data: { email: `oa-${SUFFIX}@t.com`, password: 'x', role: 'super_admin', firstName: 'OA', lastName: 'X', tenantId: null } });
  const ownerB = await prismaBase.user.create({ data: { email: `ob-${SUFFIX}@t.com`, password: 'x', role: 'super_admin', firstName: 'OB', lastName: 'X', tenantId: null } });
  const adminA = await prismaBase.user.create({ data: { email: `aa-${SUFFIX}@t.com`, password: 'x', role: 'admin', firstName: 'AA', lastName: 'X', tenantId: tenantAId } });
  ownerAId = ownerA.id; ownerBId = ownerB.id; adminAId = adminA.id;

  await prismaBase.tenant.update({ where: { id: tenantAId }, data: { ownerUserId: ownerAId } });
  await prismaBase.tenant.update({ where: { id: tenantBId }, data: { ownerUserId: ownerBId } });
});

afterAll(async () => {
  await prismaBase.notification.deleteMany({ where: { userId: { in: [ownerAId, ownerBId, adminAId] } } });
  // Null owner FK before deleting users (ownerUserId is onDelete: Restrict).
  await prismaBase.tenant.updateMany({ where: { id: { in: [tenantAId, tenantBId] } }, data: { ownerUserId: null } });
  await prismaBase.user.deleteMany({ where: { id: { in: [ownerAId, ownerBId, adminAId] } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prismaBase.$disconnect();
});

describe('notifyAdminsOverdueCollections (owner-scoped)', () => {
  it('pages each store owner about their OWN agents, and not a non-owner admin', async () => {
    await notifyAdminsOverdueCollections([
      { agentId: 1, tenantId: tenantAId, agentName: 'Agent A1', totalBalance: 100, warningAmount: 100, criticalAmount: 0 },
      { agentId: 2, tenantId: tenantBId, agentName: 'Agent B1', totalBalance: 200, warningAmount: 0, criticalAmount: 200 },
    ]);

    const [aNotes, bNotes, adminNotes] = await Promise.all([
      prismaBase.notification.findMany({ where: { userId: ownerAId, type: 'overdue_collections' } }),
      prismaBase.notification.findMany({ where: { userId: ownerBId, type: 'overdue_collections' } }),
      prismaBase.notification.findMany({ where: { userId: adminAId, type: 'overdue_collections' } }),
    ]);

    expect(aNotes).toHaveLength(1);
    expect(aNotes[0].message).toContain('Agent A1');
    expect(aNotes[0].message).not.toContain('Agent B1'); // no cross-store leak
    expect(bNotes).toHaveLength(1);
    expect(bNotes[0].message).toContain('Agent B1');
    expect(adminNotes).toHaveLength(0); // non-owner admin is not paged
  });
});
