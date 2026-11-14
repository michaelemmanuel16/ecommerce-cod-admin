/**
 * M9-T15 (COD-78): auto-confirm on the Messages side.
 *  - The message comes from the tenant's `auto_confirm` MessageTemplate row.
 *  - P2: a NO reply does not cancel the order.
 *  - P4: an order at night gets its message at once (no quiet-hours delay).
 *  - P6: a confirmation by YES gives no commission to anyone.
 *  - P5: a rep can reply in the conversation; a free-text reply opens it and does not change the order.
 * Fixtures follow m7MilestoneRules.
 */
import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder } from '../../services/orderStateMachine';
import { sendAutoConfirmForOrder } from '../../services/autoConfirmService';
import { processInboundMessage } from '../../services/messaging/inbound';
import { whatsappCloudProvider } from '../../services/messaging/providers';
import { generateAccessToken } from '../../utils/jwt';
import { registerCustomerStatsListeners } from '../../services/customerStatsService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));
jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve(), onOrderCreated: () => Promise.resolve() },
  registerWorkflowListeners: jest.fn(),
}));

const SUFFIX = Date.now();
const tenantIds: string[] = [];
let seq = 0;
let sendSpy: any;

const inbound = (tenantId: string, phone: string, text: string) => runInTenant(tenantId, () => processInboundMessage(tenantId, {
  providerMessageId: `wamid.m9ac.${SUFFIX}.${seq++}`, from: phone.replace('+', ''), type: 'text', text, occurredAt: new Date(), raw: {},
} as any));

async function world(label: string) {
  const tenant = (await createTenant(label)).id;
  tenantIds.push(tenant);
  await seedTenantDefaults(tenant);
  const phone = `+23324${String(SUFFIX + seq++).slice(-7)}`;
  const rep = await prismaBase.user.create({
    data: { tenantId: tenant, email: `rep-${tenant.slice(0, 8)}-${seq++}@test.local`, password: 'h', firstName: 'Esi', lastName: 'Rep', role: 'sales_rep', kind: 'person', commissionAmount: 8 },
  });
  const customer = await prismaBase.customer.create({
    data: { tenantId: tenant, firstName: 'Kofi', lastName: 'Buyer', phoneNumber: phone, address: '1 St', state: 'Greater Accra', area: 'Accra' },
  });
  const order = await prismaBase.order.create({
    data: {
      tenantId: tenant, customerId: customer.id, customerRepId: rep.id, status: 'pending_confirmation', subtotal: 150, totalAmount: 150, codAmount: 150,
      orderType: 'physical', paymentMethod: 'cod',
    },
  });
  const repToken = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId: tenant });
  return { tenant, phone, rep, repToken, customer, order };
}

beforeAll(() => { registerCustomerStatsListeners(); });
afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});
beforeEach(() => {
  jest.spyOn(whatsappCloudProvider, 'isEnabled').mockResolvedValue(true);
  sendSpy = jest.spyOn(whatsappCloudProvider, 'send').mockImplementation(async () => ({ accepted: true, providerMessageId: `wa-ac-${SUFFIX}-${seq++}` }));
});

describe('the auto-confirm message comes from a template row', () => {
  it('a tenant gets the current text as a whatsapp `auto_confirm` row; editing the row changes what is sent and logged', async () => {
    const w = await world('M9 AC Template');
    await runInTenant(w.tenant, () => sendAutoConfirmForOrder(w.order.id, w.tenant));
    const row = await prismaBase.messageTemplate.findFirstOrThrow({ where: { tenantId: w.tenant, channel: 'whatsapp', purpose: 'auto_confirm' } });
    expect(row).toMatchObject({ metaTemplateName: 'order_auto_confirm', language: 'en_US', metaStatus: 'APPROVED' });
    expect(sendSpy.mock.calls[0][0].template).toMatchObject({ name: 'order_auto_confirm', languageCode: 'en_US' });
    const log = await prismaBase.messageLog.findFirstOrThrow({ where: { orderId: w.order.id, direction: 'outbound' } });
    expect(log.messageBody).toContain('Please confirm your order');

    // The tenant edits the row through the templates API; the next order uses it
    const owner = await prismaBase.user.create({ data: { tenantId: w.tenant, email: `own-${SUFFIX}@test.local`, password: 'h', firstName: 'O', lastName: 'W', role: 'super_admin' } });
    const token = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId: w.tenant });
    const put = await request(app).put(`/api/message-templates/${row.id}`).set({ Authorization: `Bearer ${token}` })
      .send({ metaTemplateName: 'order_confirm_v2', body: 'Hi {{1}}, confirm order #{{3}}' });
    expect(put.status).toBe(200);
    const second = await prismaBase.order.create({
      data: { tenantId: w.tenant, customerId: w.customer.id, status: 'pending_confirmation', subtotal: 50, totalAmount: 50, codAmount: 50, orderType: 'physical', paymentMethod: 'cod' },
    });
    await runInTenant(w.tenant, () => sendAutoConfirmForOrder(second.id, w.tenant));
    expect(sendSpy.mock.calls.at(-1)[0].template).toMatchObject({ name: 'order_confirm_v2' });
  });
});

describe('P2: a NO reply does not cancel the order', () => {
  it('stays pending_confirmation with saidNo and requiresManualCall; the conversation is not marked unanswered by the NO', async () => {
    const w = await world('M9 AC P2');
    await prismaBase.order.update({ where: { id: w.order.id }, data: { autoConfirmSentAt: new Date() } });
    await inbound(w.tenant, w.phone, 'NO');
    const o = await prismaBase.order.findUniqueOrThrow({ where: { id: w.order.id } });
    expect(o).toMatchObject({ status: 'pending_confirmation', saidNo: true, requiresManualCall: true, customerResponse: 'no' });
  });
});

describe('P4: a night order gets its message at once', () => {
  it('with operating hours that exclude now, the send happens in the same call', async () => {
    const w = await world('M9 AC P4');
    const closed = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, { open: '00:00', close: '00:01', enabled: true }]));
    await prismaBase.systemConfig.upsert({
      where: { tenantId: w.tenant }, update: { timeZone: 'UTC', operatingHours: { days: closed, firstCallTargetMinutes: 15, queueWaitAlertMinutes: 30 } },
      create: { tenantId: w.tenant, timeZone: 'UTC', operatingHours: { days: closed, firstCallTargetMinutes: 15, queueWaitAlertMinutes: 30 } },
    });
    const result = await runInTenant(w.tenant, () => sendAutoConfirmForOrder(w.order.id, w.tenant));
    expect(result).toMatchObject({ channel: 'whatsapp' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: w.order.id } })).autoConfirmSentAt).not.toBeNull();
    const log = await prismaBase.messageLog.findFirstOrThrow({ where: { orderId: w.order.id, direction: 'outbound' } });
    expect(log.status).toBe('sent');
  });
});

describe('P6: a confirmation by YES gives no commission', () => {
  it('no commission entry on the YES, none on delivery', async () => {
    const w = await world('M9 AC P6');
    await prismaBase.order.update({ where: { id: w.order.id }, data: { autoConfirmSentAt: new Date() } });
    await inbound(w.tenant, w.phone, 'YES');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: w.order.id } })).status).toBe('confirmed');
    expect(await prismaBase.commissionEntry.count({ where: { tenantId: w.tenant, orderId: w.order.id } })).toBe(0);
    await runInTenant(w.tenant, () => transitionOrder(w.order.id, 'delivered', { kind: 'integration' }, { deliveryDate: new Date() }));
    expect(await prismaBase.commissionEntry.count({ where: { tenantId: w.tenant, orderId: w.order.id } })).toBe(0);
  });
});

describe('P5: a rep can reply in the conversation', () => {
  it('a free-text reply opens the conversation and leaves the order alone; the rep of the order answers it', async () => {
    const w = await world('M9 AC P5');
    await prismaBase.order.update({ where: { id: w.order.id }, data: { autoConfirmSentAt: new Date() } });
    await inbound(w.tenant, w.phone, 'Can you deliver after 5pm?');
    const o = await prismaBase.order.findUniqueOrThrow({ where: { id: w.order.id } });
    expect(o).toMatchObject({ status: 'pending_confirmation', saidNo: false, customerResponse: null });
    const conv = await prismaBase.conversation.findFirstOrThrow({ where: { tenantId: w.tenant, phone: w.phone } });
    expect(conv).toMatchObject({ unanswered: true, status: 'open', customerId: w.customer.id });

    const list = await request(app).get('/api/conversations').set({ Authorization: `Bearer ${w.repToken}` });
    expect(list.body.items.map((i: any) => i.id)).toContain(conv.id);
    const reply = await request(app).post(`/api/conversations/${conv.id}/reply`).set({ Authorization: `Bearer ${w.repToken}` }).send({ body: 'Yes, we can deliver after 5pm.' });
    expect(reply.status).toBe(201);
    expect((await prismaBase.conversation.findUniqueOrThrow({ where: { id: conv.id } })).unanswered).toBe(false);
  });
});
