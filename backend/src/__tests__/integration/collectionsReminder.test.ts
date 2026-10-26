/**
 * M5-T36 (COD-53): "Send reminder" on the collections screen (F-911): one WhatsApp text to the partner with what it holds.
 * Real database; the WhatsApp send is stubbed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import whatsappService from '../../services/whatsappService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const DAY = 24 * 60 * 60 * 1000;
let tenantId: string;
let otherId: string;
let owner: { id: number; token: string };
let rep: { id: number; token: string };
let customerId: number;
let seq = 0;

let sendText: ReturnType<typeof jest.spyOn<typeof whatsappService, 'sendText'>>;
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
const remind = (id: number | string, who = owner) => request(app).post(`/api/financial/agent-aging/${id}/remind`).set(auth(who));

const mkPartner = async (label: string, opts: { phone?: string | null; tenant?: string; daysToPay?: number } = {}) => {
  const tenant = opts.tenant ?? tenantId;
  const id = (await prismaBase.user.create({
    data: {
      email: `rem-${label}-${SUFFIX}-${seq++}@codadmin.test`, password: 'x', firstName: label, lastName: 'P', role: 'delivery_agent', kind: 'person',
      phoneNumber: opts.phone === undefined ? '+233201234567' : opts.phone, tenantId: tenant,
    },
  })).id;
  if (opts.daysToPay !== undefined) await prismaBase.deliveryPartnerProfile.create({ data: { tenantId: tenant, userId: id, daysToPay: opts.daysToPay } });
  return id;
};
const delivered = async (agentId: number, daysAgo: number, cod = 100) => {
  const at = new Date(Date.now() - daysAgo * DAY);
  const order = await prismaBase.order.create({
    data: { customerId, status: 'delivered', subtotal: cod, totalAmount: cod, codAmount: cod, deliveryAgentId: agentId, deliveryDate: at, deliveryFee: 0, tenantId } as any,
  });
  await prismaBase.agentCollection.create({ data: { tenantId, orderId: order.id, agentId, amount: cod, status: 'draft', collectionDate: at } });
};

beforeAll(async () => {
  tenantId = (await createTenant('Reminder')).id;
  otherId = (await createTenant('Reminder B')).id;
  await seedTenantDefaults(tenantId);
  [owner, rep] = await Promise.all([mkUser(tenantId, 'owner', 'super_admin'), mkUser(tenantId, 'rep', 'sales_rep')]);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-7)}1`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
}, 60000);

// The jest config restores spies before every test, so the stub is made here.
beforeEach(() => {
  sendText = jest.spyOn(whatsappService, 'sendText');
});

afterAll(async () => {
  await deleteTenantRows([tenantId, otherId]);
  await prismaBase.$disconnect();
});

describe('POST /api/financial/agent-aging/:agentId/remind', () => {
  it('sends one WhatsApp text with the unpaid amount and the overdue count against the partner days to pay', async () => {
    const p = await mkPartner('Kofi', { daysToPay: 2 });
    await delivered(p, 1, 100);
    await delivered(p, 5, 50);
    sendText.mockResolvedValueOnce({ messageLogId: 1, providerMessageId: 'wamid.1' });

    const res = await remind(p);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true, unpaidOrders: 2, overdueOrders: 1 });
    expect(sendText).toHaveBeenCalledTimes(1);
    const [{ to, body }] = sendText.mock.calls[0] as [{ to: string; body: string }];
    expect(to).toBe('+233201234567');
    expect(body).toContain('Hello Kofi');
    expect(body).toContain('GHS 150.00');
    expect(body).toContain('1 of them is past your 2-day payment term');
  });

  it('says sent: false when WhatsApp is not connected (the text is only logged)', async () => {
    const p = await mkPartner('Esi');
    await delivered(p, 1);
    sendText.mockResolvedValueOnce({ messageLogId: 2 });
    const res = await remind(p);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
  });

  it('refuses a partner with nothing unpaid, a partner with no phone, and an unknown or other-tenant partner', async () => {
    sendText.mockClear();
    const clear = await mkPartner('Clear');
    expect((await remind(clear)).status).toBe(409);
    const noPhone = await mkPartner('NoPhone', { phone: null });
    await delivered(noPhone, 1);
    const refused = await remind(noPhone);
    expect(refused.status).toBe(400);
    expect(refused.body.error ?? refused.body.message).toMatch(/no phone/i);
    const elsewhere = await mkPartner('Other', { tenant: otherId });
    expect((await remind(elsewhere)).status).toBe(404);
    expect((await remind(99999999)).status).toBe(404);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('is refused for a role without financial:update', async () => {
    const p = await mkPartner('Perm');
    await delivered(p, 1);
    sendText.mockClear();
    expect((await remind(p, rep)).status).toBe(403);
    expect(sendText).not.toHaveBeenCalled();
  });
});
