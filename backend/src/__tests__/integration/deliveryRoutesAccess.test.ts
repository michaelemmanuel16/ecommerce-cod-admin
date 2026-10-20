/**
 * M0-T17 (COD-3): role and ownership checks on delivery routes.
 * An agent sees only their own deliveries, call reps are refused, another tenant's delivery is 404,
 * and an admin completing for the agent writes an audit row.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { GLAutomationService } from '../../services/glAutomationService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
const tenantIds: string[] = [];
const userIds: number[] = [];
const T: Record<string, any> = {};

const mkUser = async (label: string, role: any, tenantId: string) => {
  const u = await prismaBase.user.create({
    data: { email: `dlv-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId },
  });
  userIds.push(u.id);
  return u;
};
const tokenOf = (u: { id: number; email: string; role: any; tenantId: string | null }) =>
  generateAccessToken({ id: u.id, email: u.email, role: u.role, tenantId: u.tenantId });
const auth = (u: any) => ({ Authorization: `Bearer ${tokenOf(u)}` });

const mkDelivery = async (label: string, tenantId: string, agentId: number) => {
  const customer = await prismaBase.customer.create({
    data: { firstName: label, lastName: 'T', phoneNumber: `+23354${label}${String(SUFFIX).slice(-6)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId },
  });
  const order = await prismaBase.order.create({
    data: {
      customerId: customer.id, subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10, deliveryAddress: '1 St',
      deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId, status: 'out_for_delivery',
    } as any,
  });
  return prismaBase.delivery.create({ data: { orderId: order.id, agentId, scheduledTime: new Date(), tenantId } });
};

beforeAll(async () => {
  const a = await prismaBase.tenant.create({ data: { name: `Dlv A ${SUFFIX}`, slug: `dlv-a-${SUFFIX}` } });
  const b = await prismaBase.tenant.create({ data: { name: `Dlv B ${SUFFIX}`, slug: `dlv-b-${SUFFIX}` } });
  tenantIds.push(a.id, b.id);
  T.admin = await mkUser('admin', 'admin', a.id);
  T.manager = await mkUser('manager', 'manager', a.id);
  T.accountant = await mkUser('acct', 'accountant', a.id);
  T.rep = await mkUser('rep', 'sales_rep', a.id);
  T.agentA = await mkUser('agenta', 'delivery_agent', a.id);
  T.agentB = await mkUser('agentb', 'delivery_agent', a.id);
  T.otherAgent = await mkUser('other', 'delivery_agent', b.id);
  T.otherAdmin = await mkUser('otheradm', 'admin', b.id);
  T.dA = await mkDelivery('1', a.id, T.agentA.id);
  T.dB = await mkDelivery('2', a.id, T.agentB.id);
  T.dOther = await mkDelivery('3', b.id, T.otherAgent.id);
});

afterAll(async () => {
  await prismaBase.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.delivery.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.user.deleteMany({ where: { id: { in: userIds } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prismaBase.$disconnect();
});

describe('delivery route access', () => {
  it('agent A reading agent B delivery is 403, own delivery is 200', async () => {
    expect((await request(app).get(`/api/deliveries/${T.dB.id}`).set(auth(T.agentA))).status).toBe(403);
    expect((await request(app).get(`/api/deliveries/${T.dA.id}`).set(auth(T.agentA))).status).toBe(200);
  });

  it('agent list holds only their own deliveries, whatever agentId is asked', async () => {
    const res = await request(app).get(`/api/deliveries?agentId=${T.agentB.id}`).set(auth(T.agentA));
    expect(res.status).toBe(200);
    expect(res.body.deliveries.map((d: any) => d.id)).toEqual([T.dA.id]);
  });

  it('agent route of another agent is 403, own route is 200', async () => {
    expect((await request(app).get(`/api/deliveries/routes/${T.agentB.id}`).set(auth(T.agentA))).status).toBe(403);
    expect((await request(app).get(`/api/deliveries/routes/${T.agentA.id}`).set(auth(T.agentA))).status).toBe(200);
  });

  it('agent A cannot upload proof for or complete agent B delivery', async () => {
    const proof = await request(app).patch(`/api/deliveries/${T.dB.id}/proof`).set(auth(T.agentA)).send({ proofType: 'signature', recipientName: 'X' });
    expect(proof.status).toBe(403);
    const done = await request(app).patch(`/api/deliveries/${T.dB.id}/complete`).set(auth(T.agentA)).send({ proofType: 'signature', recipientName: 'X' });
    expect(done.status).toBe(403);
  });

  it('owner-side roles and the accountant read all deliveries of the tenant', async () => {
    for (const u of [T.admin, T.manager, T.accountant]) {
      const res = await request(app).get('/api/deliveries').set(auth(u));
      expect(res.status).toBe(200);
      expect(res.body.deliveries.map((d: any) => d.id).sort()).toEqual([T.dA.id, T.dB.id].sort());
    }
  });

  it('accountant cannot write', async () => {
    const res = await request(app).patch(`/api/deliveries/${T.dA.id}/proof`).set(auth(T.accountant)).send({ proofType: 'signature' });
    expect(res.status).toBe(403);
  });

  it('call rep gets 403 on every delivery route', async () => {
    const h = auth(T.rep);
    expect((await request(app).get('/api/deliveries').set(h)).status).toBe(403);
    expect((await request(app).get(`/api/deliveries/${T.dA.id}`).set(h)).status).toBe(403);
    expect((await request(app).get(`/api/deliveries/routes/${T.agentA.id}`).set(h)).status).toBe(403);
    expect((await request(app).patch(`/api/deliveries/${T.dA.id}/proof`).set(h).send({})).status).toBe(403);
    expect((await request(app).patch(`/api/deliveries/${T.dA.id}/complete`).set(h).send({})).status).toBe(403);
  });

  it('another tenant delivery is 404 for read, proof and complete, even for an admin', async () => {
    const h = auth(T.admin);
    expect((await request(app).get(`/api/deliveries/${T.dOther.id}`).set(h)).status).toBe(404);
    expect((await request(app).patch(`/api/deliveries/${T.dOther.id}/proof`).set(h).send({ proofType: 'signature' })).status).toBe(404);
    expect((await request(app).patch(`/api/deliveries/${T.dOther.id}/complete`).set(h).send({ proofType: 'signature', recipientName: 'X' })).status).toBe(404);
    const list = await request(app).get('/api/deliveries').set(auth(T.otherAdmin));
    expect(list.body.deliveries.map((d: any) => d.id)).toEqual([T.dOther.id]);
  });

  it('admin completing for the agent writes an audit row; the agent completing does not', async () => {
    // The GL posting inside completeDelivery needs a chart of accounts and has its own tests;
    // this test is about who may call it and the audit row, so skip the posting.
    const skipGL = jest.spyOn(GLAutomationService, 'isRevenueAlreadyRecognized').mockReturnValue(true);
    const body = { proofType: 'signature', proofData: 'sig', recipientName: 'Recipient', codAmount: 10 };
    const res = await request(app).patch(`/api/deliveries/${T.dA.id}/complete`).set(auth(T.admin)).send(body);
    expect(res.status).toBe(200);
    const rows = await prismaBase.auditLog.findMany({ where: { resource: 'delivery', resourceId: String(T.dA.id) } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(T.admin.id);
    expect(rows[0].tenantId).toBe(T.admin.tenantId);
    expect((rows[0].metadata as any).agentId).toBe(T.agentA.id);

    const own = await request(app).patch(`/api/deliveries/${T.dB.id}/complete`).set(auth(T.agentB)).send(body);
    expect(own.status).toBe(200);
    expect(await prismaBase.auditLog.count({ where: { resource: 'delivery', resourceId: String(T.dB.id) } })).toBe(0);
    skipGL.mockRestore();
  });
});
