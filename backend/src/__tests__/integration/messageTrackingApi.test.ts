/** M9-T14 (COD-78): order and customer message tracking. */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let tenantA: string;
let tenantB: string;
let owner: { id: number; token: string };
let rep: { id: number; token: string };
let otherRep: { id: number; token: string };
let ownerB: { id: number; token: string };
let customerId: number;
let orderId: number;
let otherOrderId: number;
let outboundId: number;
let seq = 0;

const mkMsg = (data: Record<string, unknown>) => prismaBase.messageLog.create({
  data: { tenantId: tenantA, channel: 'whatsapp', direction: 'outbound', messageBody: 'x', status: 'delivered', providerMessageId: `trk-${SUFFIX}-${seq++}`, ...data } as any,
});
const mkOrder = (data: Record<string, unknown>) => prismaBase.order.create({
  data: { customerId, subtotal: 10, shippingCost: 0, totalAmount: 10, deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: tenantA, ...data } as any,
});

beforeAll(async () => {
  tenantA = (await createTenant('Trk A')).id;
  tenantB = (await createTenant('Trk B')).id;
  owner = await mkUser(tenantA, 'owner', 'super_admin');
  rep = await mkUser(tenantA, 'rep', 'sales_rep');
  otherRep = await mkUser(tenantA, 'rep2', 'sales_rep');
  ownerB = await mkUser(tenantB, 'ownerb', 'super_admin');
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+23355${String(SUFFIX).slice(-7)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: tenantA, smsOptOut: true },
  })).id;
  orderId = (await mkOrder({ customerRepId: rep.id })).id;
  otherOrderId = (await mkOrder({ customerRepId: otherRep.id })).id;
  outboundId = (await mkMsg({ orderId, customerId, messageBody: 'y'.repeat(300), status: 'replied' })).id;
  await mkMsg({ customerId, direction: 'inbound', inReplyToId: outboundId, messageBody: 'Yes, bring it' });
  await mkMsg({ orderId: otherOrderId, customerId, messageBody: 'other order' });
});

afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

describe('GET /api/orders/:id/messages', () => {
  it('returns the order messages and the inbound replies with preview and inReplyToId', async () => {
    const res = await request(app).get(`/api/orders/${orderId}/messages`).set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const sent = res.body.items.find((i: any) => i.id === outboundId);
    expect(sent).toMatchObject({ channel: 'whatsapp', direction: 'outbound', status: 'replied', inReplyToId: null });
    expect(sent.bodyPreview.length).toBeLessThan(160);
    expect(res.body.items.find((i: any) => i.direction === 'inbound')).toMatchObject({ inReplyToId: outboundId, bodyPreview: 'Yes, bring it' });
    expect(res.body.optOut).toBeUndefined();
  });

  it('a rep sees their own order (200), another rep order (403), a missing or other-tenant order (404)', async () => {
    expect((await request(app).get(`/api/orders/${orderId}/messages`).set(bearer(rep.token))).status).toBe(200);
    expect((await request(app).get(`/api/orders/${otherOrderId}/messages`).set(bearer(rep.token))).status).toBe(403);
    expect((await request(app).get('/api/orders/99999999/messages').set(bearer(owner.token))).status).toBe(404);
    expect((await request(app).get(`/api/orders/${orderId}/messages`).set(bearer(ownerB.token))).status).toBe(404);
  });
});

describe('GET /api/customers/:id/messages', () => {
  it('a rep who cannot see the customer (no order, no conversation assigned) gets 403', async () => {
    const outsider = await mkUser(tenantA, 'outsider', 'sales_rep');
    const hidden = await prismaBase.customer.create({
      data: { firstName: 'Hidden', lastName: 'Buyer', phoneNumber: `+23357${String(SUFFIX).slice(-7)}`, address: '3 St', state: 'Greater Accra', area: 'Accra', tenantId: tenantA },
    });
    await mkMsg({ customerId: hidden.id, messageBody: 'private' });
    expect((await request(app).get(`/api/customers/${hidden.id}/messages`).set(bearer(outsider.token))).status).toBe(403);
    // Another rep's order does not give a rep this customer
    await mkOrder({ customerId: hidden.id, customerRepId: otherRep.id });
    expect((await request(app).get(`/api/customers/${hidden.id}/messages`).set(bearer(outsider.token))).status).toBe(403);
  });

  it('returns all messages of the customer and the opt-out flags', async () => {
    const res = await request(app).get(`/api/customers/${customerId}/messages`).set(bearer(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.optOut).toEqual({ whatsapp: false, sms: true, email: false });
  });

  it('403 for a rep with no link to the customer, 404 for another tenant', async () => {
    const lonely = await mkUser(tenantA, 'rep3', 'sales_rep');
    expect((await request(app).get(`/api/customers/${customerId}/messages`).set(bearer(lonely.token))).status).toBe(403);
    expect((await request(app).get(`/api/customers/${customerId}/messages`).set(bearer(rep.token))).status).toBe(200);
    expect((await request(app).get(`/api/customers/${customerId}/messages`).set(bearer(ownerB.token))).status).toBe(404);
  });
});
