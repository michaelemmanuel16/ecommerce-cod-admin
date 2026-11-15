/**
 * M9 wave 3 (COD-81): every trigger checks the workflow's conditions once before the first step.
 * A run that does not match writes a `skipped` execution with `conditions_not_met` and runs no step.
 * Real DB (ecommerce_cod_test_c) and app. The queue's `add` runs the job inline.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { workflowQueue, processExecuteWorkflow } from '../../queues/workflowQueue';
import { smsService } from '../../services/smsService';
import workflowService from '../../services/workflowService';
import { runInTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';

jest.setTimeout(120_000);

const PREFIX = `GATE ${Date.now()}`;
let pair: TwoTenants;
let tenantId: string;
let seq = 0;
let sendSms: jest.SpiedFunction<typeof smsService.sendSms>;

const adminAuth = () => ({ Authorization: `Bearer ${pair.a.users.admin.token}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const region = (value: string) => ({ id: 'c', logic: 'AND', rules: [{ field: 'region', operator: 'is', value }] });
const sms = { type: 'send_sms', config: { phoneNumber: '+233241112222', message: 'Hello' } };
const mkWorkflow = (triggerType: string, conditions: any, triggerData: Record<string, unknown> = {}) =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType: triggerType as any, triggerData: triggerData as any, actions: [sms], conditions, isActive: true, tenantId } as any,
  });
const mkOrder = async (state: string) => (await prismaBase.order.create({
  data: {
    customerId: pair.a.ids.customer, status: 'pending_confirmation', subtotal: 100, totalAmount: 100, codAmount: 100, tenantId,
    deliveryAddress: '1 St', deliveryState: state, deliveryArea: 'Town',
  } as any,
})).id;
const runs = (workflowId: number) => prismaBase.workflowExecution.findMany({ where: { workflowId }, orderBy: { id: 'asc' } });
const place = (state: string) =>
  request(app).post('/api/orders').set(adminAuth()).send({
    customerPhone: `+23324${String(Date.now()).slice(-6)}${seq++ % 10}`, customerName: 'Gate Buyer',
    orderItems: [{ productId: pair.a.ids.product, quantity: 1, unitPrice: 50 }],
    subtotal: 50, totalAmount: 50, deliveryAddress: '7 Gate Rd', deliveryState: state, deliveryArea: 'Town',
  });
const settle = async (workflowId: number, count: number) => {
  for (let i = 0; i < 60; i++) {
    const rows = await runs(workflowId);
    if (rows.length >= count && rows.every((r) => !['pending', 'running'].includes(r.status))) return rows;
    await sleep(100);
  }
  return runs(workflowId);
};

beforeAll(async () => {
  pair = await createTwoTenants('gate');
  tenantId = pair.a.id;
  await stockUp(tenantId, pair.a.ids.product, 100);
}, 60_000);

beforeEach(() => {
  sendSms = jest.spyOn(smsService, 'sendSms').mockResolvedValue({ sent: true, messageLogId: 1 } as any);
  jest.spyOn(workflowQueue, 'add').mockImplementation((async (_name: string, data: any) => {
    await processExecuteWorkflow({ id: 'inline', data } as any);
  }) as any);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await prismaBase.workflow.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] }, name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('order_created: Region is Ashanti + send_sms', () => {
  it('sends for an Ashanti order; a Volta order writes a skipped run and sends nothing', async () => {
    const wf = await mkWorkflow('order_created', region('Ashanti'));
    const ashanti = await place('Ashanti');
    const volta = await place('Volta');
    expect(ashanti.status).toBe(201);
    const rows = await settle(wf.id, 2);

    expect(sendSms).toHaveBeenCalledTimes(1);
    const forAshanti = rows.find((r) => r.orderId === ashanti.body.order.id)!;
    const forVolta = rows.find((r) => r.orderId === volta.body.order.id)!;
    expect(forAshanti.status).toBe('completed');
    expect(forVolta).toMatchObject({ status: 'skipped', error: 'conditions_not_met', triggerSource: 'screen' });
    expect(forVolta.steps).toEqual([]);
  });

  it('a workflow with no conditions still runs for every order', async () => {
    const wf = await mkWorkflow('order_created', {});
    await place('Volta');
    const rows = await settle(wf.id, 1);
    expect(rows[0].status).toBe('completed');
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});

describe('the other triggers', () => {
  it('status_change: a Volta order is skipped, an Ashanti one runs', async () => {
    const wf = await mkWorkflow('status_change', region('Ashanti'), { status: 'confirmed' });
    const ashanti = await mkOrder('Ashanti');
    const volta = await mkOrder('Volta');
    await runInTenant(tenantId, async () => {
      await workflowService.triggerStatusChangeWorkflows(ashanti, 'pending_confirmation', 'confirmed');
      await workflowService.triggerStatusChangeWorkflows(volta, 'pending_confirmation', 'confirmed');
    });
    const rows = await settle(wf.id, 2);
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(rows.find((r) => r.orderId === volta)).toMatchObject({ status: 'skipped', error: 'conditions_not_met' });
    expect(rows.find((r) => r.orderId === ashanti)!.status).toBe('completed');
  });

  it('payment_received: a Volta order is skipped', async () => {
    const wf = await mkWorkflow('payment_received', region('Ashanti'));
    const volta = await mkOrder('Volta');
    await workflowService.onPaymentSettled({ tenantId, orderId: volta, reference: `ref-${seq++}`, provider: 'paystack', amount: 100 } as any);
    const rows = await settle(wf.id, 1);
    expect(sendSms).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'skipped', error: 'conditions_not_met', triggerSource: 'payment' });
  });

  it('manual run with no input has no order to read: it runs as before', async () => {
    const wf = await mkWorkflow('manual', region('Ashanti'));
    const res = await request(app).post(`/api/workflows/${wf.id}/execute`).set(adminAuth()).send({});
    expect(res.status).toBe(200);
    const rows = await settle(wf.id, 1);
    expect(rows[0].status).toBe('completed');
  });
});
