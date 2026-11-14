/**
 * M9-T21 (COD-81): every path that creates an order or moves its status fires the matching workflow ONCE.
 * Created: screen (POST /api/orders), rep app (same route, rep token), spreadsheet upload, webhook import, online payment
 * settlement, public checkout form. Status: screen, MCP, rep call outcome, agent app (delivery complete), digital delivery.
 * The events come from the services (orderService, orderSideEffects, webhookService, paymentSettlementService,
 * publicOrderService for the public checkout form).
 * Real DB, real app; the queue's `add` runs the job inline, so an execution row is one fire.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';

jest.mock('../../services/metaCapiService', () => require('./helpers/paymentTestKit').metaCapiMock());
jest.mock('../../services/digitalDeliveryService', () => ({
  digitalDeliveryService: {
    generateDownloadToken: async () => 'tok-digital',
    sendDownloadLinks: async () => undefined,
  },
}));

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { workflowQueue, processExecuteWorkflow } from '../../queues/workflowQueue';
import { runTool } from '../../tools/registry';
import '../../tools';
import { toolActorContext } from './helpers/callTool';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';
import { registerPaymentProvider, unregisterPaymentProvider, clearPaymentConfigCache } from '../../services/payments';
import { createFakeProvider, FakeProvider } from '../../services/payments/fakeProvider';
import { ip, newRef, seedPending } from './helpers/paymentTestKit';

jest.setTimeout(120_000);
process.env.PROVIDER_ENCRYPTION_KEY = 'cd'.repeat(32);

const SUFFIX = Date.now();
const PREFIX = `T21 ${SUFFIX}`;
let pair: TwoTenants;
let tenantId: string;
let fake: FakeProvider;
let seq = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T>, what: string, timeout = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** A harmless action: a wait with no time set completes at once. The test counts executions. */
const NOOP = [{ type: 'wait', config: { duration: 0 } }];
const mkWorkflow = (triggerType: 'status_change' | 'order_created', triggerData: Record<string, unknown>) =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType, triggerData: triggerData as any, actions: NOOP, isActive: true, tenantId },
  });
const live = async (workflowId: number) =>
  (await prismaBase.workflowExecution.findMany({ where: { workflowId }, orderBy: { id: 'asc' } })).filter((e) => e.status !== 'skipped');

/** The workflow fired exactly once for the order: waits for the first fire, then gives a second fire time to show up. */
async function expectFiredOnce(workflowId: number, orderId?: number) {
  await waitFor(async () => (await live(workflowId)).length >= 1, 'a workflow execution');
  await sleep(700);
  const runs = await live(workflowId);
  expect(runs).toHaveLength(1);
  expect(runs[0].status).toBe('completed');
  if (orderId !== undefined) expect((runs[0].input as any).orderId).toBe(orderId);
  return runs[0];
}

/** Fails with the response body in the message, so a 4xx or 5xx says why. */
const expectStatus = (res: { status: number; body: unknown }, status: number) => {
  if (res.status !== status) throw new Error(`expected HTTP ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
};
const adminAuth = () => ({ Authorization: `Bearer ${pair.a.users.admin.token}` });
const repAuth = () => ({ Authorization: `Bearer ${pair.a.users.salesRep.token}` });
const agentAuth = () => ({ Authorization: `Bearer ${pair.a.users.deliveryAgent.token}` });
const phone = () => `+23324${String(Date.now()).slice(-6)}${seq++ % 10}`;

const mkOrder = async (status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: {
      customerId: pair.a.ids.customer, status, subtotal: 100, totalAmount: 100, codAmount: 100, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      orderItems: { create: { productId: pair.a.ids.product, quantity: 1, unitPrice: 100, totalPrice: 100 } },
      ...extra,
    } as any,
  })).id;

beforeAll(async () => {
  pair = await createTwoTenants('t21paths');
  tenantId = pair.a.id;
  await stockUp(tenantId, pair.a.ids.product, 100);
  const agentUserId = pair.a.users.deliveryAgent.id;
  const van = await prismaBase.stockLocation.findFirst({ where: { tenantId, userId: agentUserId } });
  await stockUp(tenantId, pair.a.ids.product, 20, { locationId: van?.id, name: 'Agent van', type: 'agent', userId: agentUserId });
  fake = createFakeProvider('fake');
  registerPaymentProvider(fake);
  clearPaymentConfigCache(tenantId);
}, 60_000);

beforeEach(() => {
  // Run the job at once, the way the Bull worker would later
  jest.spyOn(workflowQueue, 'add').mockImplementation((async (_name: string, data: any) => {
    await processExecuteWorkflow({ id: 'inline', data } as any);
  }) as any);
});

afterEach(async () => {
  await prismaBase.workflow.deleteMany({ where: { tenantId, name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  unregisterPaymentProvider('fake');
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('order created fires once, from every path', () => {
  const body = () => ({
    customerPhone: phone(), customerName: 'Kwame Path', orderItems: [{ productId: pair.a.ids.product, quantity: 1, unitPrice: 50 }],
    subtotal: 50, totalAmount: 50, deliveryAddress: '7 Path Rd', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
  });

  it('screen: POST /api/orders as an admin', async () => {
    const wf = await mkWorkflow('order_created', {});
    const res = await request(app).post('/api/orders').set(adminAuth()).send(body());
    expectStatus(res, 201);
    await expectFiredOnce(wf.id, res.body.order.id);
  });

  it('rep app: POST /api/orders as a sales rep', async () => {
    const wf = await mkWorkflow('order_created', {});
    const res = await request(app).post('/api/orders').set(repAuth()).send(body());
    expectStatus(res, 201);
    await expectFiredOnce(wf.id, res.body.order.id);
  });

  it('spreadsheet upload with runWorkflows true', async () => {
    const wf = await mkWorkflow('order_created', {});
    const csv = `Phone,Customer Name,Address,Region,Product,Quantity,Price,Status\n${phone()},Up Load,9 Upload Road Accra,Ashanti,Prod ${pair.a.marker},1,40,pending_confirmation\n`;
    const res = await request(app).post('/api/orders/upload').set(adminAuth()).field('runWorkflows', 'true').attach('file', Buffer.from(csv), 'orders.csv');
    expect(res.status).toBe(200);
    expect(res.body.results.success).toBe(1);
    await expectFiredOnce(wf.id);
  });

  it('webhook import: POST /api/webhooks/import/:uniqueUrl', async () => {
    const wf = await mkWorkflow('order_created', {});
    const hook = await prismaBase.webhookConfig.create({
      data: { name: `${PREFIX} hook`, url: 'x', secret: 's', requireSignature: false, fieldMapping: {}, tenantId },
    });
    const res = await request(app).post(`/api/webhooks/import/${hook.uniqueUrl}`).set('X-Forwarded-For', ip()).send({
      orders: [{ id: `ext-${SUFFIX}-${seq++}`, phone: phone(), customer_name: 'Web Hook', price: 40, address: '2 Hook St', state: 'Greater Accra', area: 'Accra' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.results?.success ?? res.body.success).toBeTruthy();
    await expectFiredOnce(wf.id);
  });

  it('online payment settlement: the order made by the payment webhook', async () => {
    const wf = await mkWorkflow('order_created', {});
    const ref = newRef('t21');
    await seedPending(pair, 'a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50', fee: '0.75', channel: 'card' });
    const res = await request(app).post(`/api/payments/webhook/fake/${pair.a.slug}`).set('X-Forwarded-For', ip()).set('x-fake-signature', 'valid')
      .send({ type: 'payment.success', reference: ref });
    expect(res.status).toBe(200);
    const order = await prismaBase.order.findFirstOrThrow({ where: { paymentReference: ref } });
    await expectFiredOnce(wf.id, order.id);
  });

  it('public checkout form (emitted from publicOrderService)', async () => {
    const wf = await mkWorkflow('order_created', {});
    const slug = `t21-form-${SUFFIX}`;
    const form = await prismaBase.checkoutForm.create({
      data: { name: slug, slug, productId: pair.a.ids.product, fields: [], styling: {}, regions: { available: ['Greater Accra'] }, tenantId } as never,
    });
    await prismaBase.formPackage.create({ data: { formId: form.id, name: 'One', price: 10, quantity: 1 } });
    const res = await request(app).post(`/api/public/forms/${slug}/orders`).set('X-Forwarded-For', ip()).send({
      totalAmount: 1, formData: { name: 'Ama Public', phoneNumber: phone(), state: 'Greater Accra', town: 'Osu', landmark: 'Near the Total station' },
      selectedPackage: { name: 'One', price: 1, quantity: 1 },
    });
    expectStatus(res, 201);
    await expectFiredOnce(wf.id, res.body.orderId);
  });
});

describe('status changed fires once, from every path', () => {
  it('screen: PATCH /api/orders/:id/status', async () => {
    const wf = await mkWorkflow('status_change', { status: 'confirmed' });
    const id = await mkOrder('pending_confirmation');
    const res = await request(app).patch(`/api/orders/${id}/status`).set(adminAuth()).send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    await expectFiredOnce(wf.id, id);
  });

  it('MCP: orders_update_status', async () => {
    const wf = await mkWorkflow('status_change', { status: 'confirmed' });
    const id = await mkOrder('pending_confirmation');
    const res = await runTool('orders_update_status', { orderId: id, status: 'confirmed' }, await toolActorContext(tenantId, 'mcp'));
    expect(res).toMatchObject({ status: 'ok' });
    await expectFiredOnce(wf.id, id);
  });

  it('rep app: a confirmed call outcome', async () => {
    const wf = await mkWorkflow('status_change', { status: 'confirmed' });
    const id = await mkOrder('pending_confirmation', { customerRepId: pair.a.users.salesRep.id });
    const res = await request(app).post('/api/calls').set(repAuth()).send({ customerId: pair.a.ids.customer, orderId: id, outcome: 'confirmed', duration: 30 });
    expect(res.status).toBeLessThan(300);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('confirmed');
    await expectFiredOnce(wf.id, id);
  });

  it('agent app: PATCH /api/deliveries/:id/complete', async () => {
    const wf = await mkWorkflow('status_change', { status: 'delivered' });
    const id = await mkOrder('out_for_delivery', { deliveryAgentId: pair.a.users.deliveryAgent.id });
    const delivery = await prismaBase.delivery.create({ data: { orderId: id, agentId: pair.a.users.deliveryAgent.id, tenantId } });
    const res = await request(app).patch(`/api/deliveries/${delivery.id}/complete`).set(agentAuth()).send({ codAmount: 100, proofType: 'signature', proofData: 'x', recipientName: 'Ama' });
    expect(res.status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('delivered');
    await expectFiredOnce(wf.id, id);
  });

  it('online payment settlement: a digital order moves to digital_delivered', async () => {
    const wf = await mkWorkflow('status_change', { status: 'digital_delivered' });
    const ref = newRef('t21d');
    await seedPending(pair, 'a', ref, { orderType: 'digital' });
    fake.setPayment(ref, { status: 'success', amount: '50', fee: '0.75', channel: 'card' });
    const res = await request(app).post(`/api/payments/webhook/fake/${pair.a.slug}`).set('X-Forwarded-For', ip()).set('x-fake-signature', 'valid')
      .send({ type: 'payment.success', reference: ref });
    expect(res.status).toBe(200);
    const order = await prismaBase.order.findFirstOrThrow({ where: { paymentReference: ref } });
    expect(order.status).toBe('digital_delivered');
    await expectFiredOnce(wf.id, order.id);
  });
});
