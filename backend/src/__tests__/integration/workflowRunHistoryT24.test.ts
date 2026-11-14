/**
 * M9-T24 (COD-81): run history, retry, manual run and test run.
 * Real DB (ecommerce_cod_test_c) and app. The queue's `add` runs the job inline.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { workflowQueue, processExecuteWorkflow, MANUAL_RUN_JOB } from '../../queues/workflowQueue';
import { processManualRunBatch } from '../../services/workflowRunService';
import { smsService } from '../../services/smsService';
import assignmentService from '../../services/assignmentService';
import * as emailService from '../../services/emailService';
import * as whatsappService from '../../services/whatsappService';
import * as workflowActions from '../../services/workflowActions';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.setTimeout(120_000);

const PREFIX = `T24 ${Date.now()}`;
let pair: TwoTenants;
let tenantId: string;
let seq = 0;
let sendSms: jest.SpiedFunction<typeof smsService.sendSms>;
let addCalls: Array<{ name: string; data: any }> = [];

const adminAuth = () => ({ Authorization: `Bearer ${pair.a.users.admin.token}` });
const bAuth = () => ({ Authorization: `Bearer ${pair.b.users.admin.token}` });
const repAuth = () => ({ Authorization: `Bearer ${pair.a.users.salesRep.token}` });
const sms = (message: string) => ({ type: 'send_sms', config: { phoneNumber: '+233241112222', message } });
const mkWorkflow = (actions: any[], extra: Record<string, unknown> = {}) =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType: 'manual', triggerData: {}, actions, conditions: {}, isActive: true, tenantId, ...extra } as any,
  });
const mkOrder = async (state = 'Ashanti') => (await prismaBase.order.create({
  data: {
    customerId: pair.a.ids.customer, status: 'pending_confirmation', subtotal: 100, totalAmount: 100, codAmount: 100, tenantId,
    deliveryAddress: '1 St', deliveryState: state, deliveryArea: 'Town',
  } as any,
})).id;
const runs = (workflowId: number) => prismaBase.workflowExecution.findMany({ where: { workflowId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  pair = await createTwoTenants('t24');
  tenantId = pair.a.id;
}, 60_000);

beforeEach(() => {
  addCalls = [];
  sendSms = jest.spyOn(smsService, 'sendSms').mockResolvedValue({ sent: true, messageLogId: 1 } as any);
  jest.spyOn(workflowQueue, 'add').mockImplementation((async (name: string, data: any) => {
    addCalls.push({ name, data });
    if (name === MANUAL_RUN_JOB) {
      await processManualRunBatch({ id: 'inline-manual', data } as any);
      return;
    }
    try { await processExecuteWorkflow({ id: 'inline', data } as any); } catch { /* a failed step is final; Bull would retry */ }
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

describe('run history', () => {
  it('lists runs with status, source, order, times and each step result and error; one run by id', async () => {
    const orderId = await mkOrder();
    sendSms.mockResolvedValueOnce({ sent: true, messageLogId: 7 } as any).mockResolvedValueOnce({ sent: false } as any);
    const wf = await mkWorkflow([sms('one'), sms('two')]);
    const start = await request(app).post(`/api/workflows/${wf.id}/execute`).set(adminAuth()).send({ input: { orderId } });
    expect(start.status).toBe(200);

    const list = await request(app).get(`/api/workflows/${wf.id}/executions`).set(adminAuth());
    expect(list.status).toBe(200);
    const row = list.body.executions[0];
    expect(row).toMatchObject({ status: 'failed', triggerSource: 'manual', orderId, failedStepIndex: 1, mode: 'live' });
    expect(row.startedAt).toBeTruthy();
    expect(row.finishedAt).toBeTruthy();
    expect(row.steps).toHaveLength(2);
    expect(row.steps[0]).toMatchObject({ index: 0, type: 'send_sms', status: 'completed', result: { sent: true, messageLogId: 7 } });
    expect(row.steps[1]).toMatchObject({ index: 1, type: 'send_sms', status: 'failed', error: 'SMS is not set up: message not sent' });

    const one = await request(app).get(`/api/workflows/executions/${row.id}`).set(adminAuth());
    expect(one.status).toBe(200);
    expect(one.body.execution.steps).toEqual(row.steps);
  });

  it('another tenant gets 404 for the list and for one run', async () => {
    const wf = await mkWorkflow([sms('x')]);
    await request(app).post(`/api/workflows/${wf.id}/execute`).set(adminAuth()).send({ input: { orderId: await mkOrder() } });
    const [row] = await runs(wf.id);
    expect((await request(app).get(`/api/workflows/${wf.id}/executions`).set(bAuth())).status).toBe(404);
    expect((await request(app).get(`/api/workflows/executions/${row.id}`).set(bAuth())).status).toBe(404);
    expect((await request(app).post(`/api/workflows/executions/${row.id}/retry`).set(bAuth())).status).toBe(404);
    expect((await request(app).post(`/api/workflows/${wf.id}/run`).set(bAuth()).send({ orderIds: [1] })).status).toBe(404);
    expect((await request(app).post(`/api/workflows/${wf.id}/test`).set(bAuth()).send({})).status).toBe(404);
  });
});

describe('retry', () => {
  it('runs again from the failed step only; a second retry is 409; a finished run cannot be retried', async () => {
    const orderId = await mkOrder();
    sendSms.mockResolvedValueOnce({ sent: true, messageLogId: 1 } as any).mockResolvedValueOnce({ sent: false } as any);
    const wf = await mkWorkflow([sms('one'), sms('two')]);
    await request(app).post(`/api/workflows/${wf.id}/execute`).set(adminAuth()).send({ input: { orderId } });
    const [failed] = await runs(wf.id);
    expect(failed.status).toBe('failed');
    expect(sendSms).toHaveBeenCalledTimes(2);

    const retry = await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth());
    expect(retry.status).toBe(202);
    // step one is not sent again; step two is
    expect(sendSms).toHaveBeenCalledTimes(3);
    expect(sendSms.mock.calls[2][0]).toMatchObject({ body: 'two' });

    const [, second] = await runs(wf.id);
    expect(second).toMatchObject({ status: 'completed', triggerSource: 'retry', orderId, idempotencyKey: `retry:${failed.id}` });
    expect((second.output as any).retryOf).toBe(failed.id);
    expect((second.steps as any[]).map((s) => s.success)).toEqual([true, true]); // the step before the failure is kept
    const view = await request(app).get(`/api/workflows/executions/${second.id}`).set(adminAuth());
    expect(view.body.execution.retryOf).toBe(failed.id);

    // the old run is still failed: a second retry is refused
    const again = await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth());
    expect(again.status).toBe(409);
    // a completed run is not retried
    const notFailed = await request(app).post(`/api/workflows/executions/${second.id}/retry`).set(adminAuth());
    expect(notFailed.status).toBe(409);
    expect(sendSms).toHaveBeenCalledTimes(3);
  });

  it('a retry that is still pending blocks a second one', async () => {
    const wf = await mkWorkflow([sms('one')]);
    const failed = await prismaBase.workflowExecution.create({
      data: { tenantId, workflowId: wf.id, status: 'failed', input: {}, steps: [], failedStepIndex: 0, error: 'x' } as any,
    });
    jest.spyOn(workflowQueue, 'add').mockImplementation((async () => undefined) as any); // never processed: stays pending
    const first = await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth());
    expect(first.status).toBe(202);
    expect((await runs(wf.id))[1].status).toBe('pending');
    const second = await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth());
    expect(second.status).toBe(409);
  });

  it('is refused (409) when the workflow is off or was edited since the run; skipped when the conditions no longer match', async () => {
    const orderId = await mkOrder('Ashanti');
    sendSms.mockResolvedValueOnce({ sent: false } as any);
    const wf = await mkWorkflow([sms('one')]);
    await request(app).post(`/api/workflows/${wf.id}/execute`).set(adminAuth()).send({ input: { orderId } });
    const [failed] = await runs(wf.id);
    expect(failed.status).toBe('failed');
    expect((failed.output as any).actionsHash).toBeTruthy();

    await prismaBase.workflow.update({ where: { id: wf.id }, data: { isActive: false } });
    expect((await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth())).status).toBe(409);
    await prismaBase.workflow.update({ where: { id: wf.id }, data: { isActive: true, actions: [sms('one'), sms('new step')] } });
    const edited = await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth());
    expect(edited.status).toBe(409);
    expect(edited.body.error ?? edited.body.message).toContain('The workflow changed since this run. Run it again instead.');
    expect(await runs(wf.id)).toHaveLength(1);

    // back to the same actions, but the order no longer matches the conditions
    await prismaBase.workflow.update({
      where: { id: wf.id },
      data: { actions: [sms('one')], conditions: { id: 'c', logic: 'AND', rules: [{ field: 'region', operator: 'is', value: 'Volta' }] } },
    });
    const calls = sendSms.mock.calls.length;
    const gated = await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(adminAuth());
    expect(gated.status).toBe(202);
    expect(gated.body.execution).toMatchObject({ status: 'skipped', error: 'conditions_not_met' });
    expect(sendSms.mock.calls.length).toBe(calls);
  });

  it('needs workflows:execute', async () => {
    const wf = await mkWorkflow([sms('one')]);
    const failed = await prismaBase.workflowExecution.create({
      data: { tenantId, workflowId: wf.id, status: 'failed', input: {}, steps: [], failedStepIndex: 0 } as any,
    });
    expect((await request(app).post(`/api/workflows/executions/${failed.id}/retry`).set(repAuth())).status).toBe(403);
    expect((await request(app).post(`/api/workflows/${wf.id}/run`).set(repAuth()).send({ orderIds: [1] })).status).toBe(403);
    expect((await request(app).post(`/api/workflows/${wf.id}/test`).set(repAuth()).send({})).status).toBe(403);
  });
});

describe('manual run', () => {
  it('warns when an order already ran, runs nothing; confirm runs them all; 50 orders a job', async () => {
    const wf = await mkWorkflow([sms('hi')]);
    const o1 = await mkOrder();
    const o2 = await mkOrder();
    const first = await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: [o1] });
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ queued: 1, batches: 1 });
    expect((await runs(wf.id))[0]).toMatchObject({ orderId: o1, triggerSource: 'manual', status: 'completed' });

    const warn = await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: [o1, o2] });
    expect(warn.status).toBe(200);
    expect(warn.body).toEqual({ warning: 'already_ran', orderIds: [o1] });
    expect(await runs(wf.id)).toHaveLength(1); // nothing ran
    expect(sendSms).toHaveBeenCalledTimes(1);

    const confirmed = await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: [o1, o2], confirm: true });
    expect(confirmed.status).toBe(202);
    expect(await runs(wf.id)).toHaveLength(3);
    expect(sendSms).toHaveBeenCalledTimes(3);
  });

  it('refuses 0 and more than 500 ids, a missing order and an off workflow', async () => {
    const wf = await mkWorkflow([sms('hi')]);
    expect((await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: [] })).status).toBe(400);
    expect((await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: Array.from({ length: 501 }, (_, i) => i + 1) })).status).toBe(400);
    expect((await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: [2_000_000_000] })).status).toBe(404);
    await prismaBase.workflow.update({ where: { id: wf.id }, data: { isActive: false } });
    expect((await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: [await mkOrder()] })).status).toBe(409);
  });

  it('splits the order list into jobs of 50', async () => {
    const wf = await mkWorkflow([sms('hi')]);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(await mkOrder());
    // one statement for the many orders
    const rows = await prismaBase.order.createManyAndReturn({
      data: Array.from({ length: 98 }, () => ({
        customerId: pair.a.ids.customer, status: 'pending_confirmation', subtotal: 1, totalAmount: 1, codAmount: 1, tenantId,
        deliveryAddress: '1 St', deliveryState: 'Volta', deliveryArea: 'Town',
      })) as any,
      select: { id: true },
    });
    const all = [...ids, ...rows.map((r) => r.id)]; // 101 orders
    const res = await request(app).post(`/api/workflows/${wf.id}/run`).set(adminAuth()).send({ orderIds: all });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ queued: 101, batches: 3 });
    expect(addCalls.filter((c) => c.name === MANUAL_RUN_JOB).map((c) => c.data.orderIds.length)).toEqual([50, 50, 1]);
  });
});

describe('test run', () => {
  it('returns the plan, writes mode=test and calls no sender, no assignment, no queue, no HTTP', async () => {
    const orderId = await mkOrder('Ashanti');
    const assign = jest.spyOn(assignmentService, 'assignByRole');
    const email = jest.spyOn(emailService, 'sendWorkflowEmail');
    const whatsapp = jest.spyOn(whatsappService, 'sendWhatsAppForOrder');
    const http = jest.spyOn(workflowActions, 'runHttpRequestAction');
    const updateOrder = jest.spyOn(workflowActions, 'updateOrderByWorkflow');
    const wf = await mkWorkflow([
      sms('hi'),
      { type: 'send_email', config: { to: 'a@b.test', subject: 'S', body: 'B' } },
      { type: 'send_whatsapp', config: { templateKey: 'confirm' } },
      { type: 'update_order', config: { updates: { status: 'confirmed' } } },
      { type: 'assign_to', config: { role: 'delivery_agent', userIds: [pair.a.users.deliveryAgent.id], split: 'even' } },
      { type: 'http_request', config: { method: 'POST', url: 'https://example.test/hook' } },
      { type: 'wait', config: { duration: 60 } },
    ], { isActive: false }); // a draft

    const res = await request(app).post(`/api/workflows/${wf.id}/test`).set(adminAuth()).send({ orderId });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('test');
    expect(res.body.sent).toBe(false);
    expect(res.body.conditions).toMatchObject({ evaluated: true, matches: true });
    expect(res.body.plan.map((p: any) => p.type)).toEqual(['send_sms', 'send_email', 'send_whatsapp', 'update_order', 'assign_to', 'http_request', 'wait']);
    expect(res.body.plan[0].willDo).toContain('hi');

    expect(sendSms).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
    expect(whatsapp).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(updateOrder).not.toHaveBeenCalled();
    expect(addCalls).toHaveLength(0);

    const [row] = await runs(wf.id);
    expect(row).toMatchObject({ mode: 'test', status: 'completed', orderId });
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending_confirmation');
    expect(order.deliveryAgentId).toBeNull();
    expect(await prismaBase.messageLog.count({ where: { orderId } })).toBe(0);
  });

  it('reports conditions that do not match and an empty plan; without an order it says so', async () => {
    const orderId = await mkOrder('Volta');
    const wf = await mkWorkflow([sms('hi')], { conditions: { id: 'c', logic: 'AND', rules: [{ field: 'region', operator: 'is', value: 'Ashanti' }] } });
    const miss = await request(app).post(`/api/workflows/${wf.id}/test`).set(adminAuth()).send({ orderId });
    expect(miss.body.conditions).toMatchObject({ evaluated: true, matches: false, reason: 'conditions_not_met' });
    expect(miss.body.plan).toEqual([]);
    expect((await runs(wf.id))[0]).toMatchObject({ mode: 'test', status: 'skipped', error: 'conditions_not_met' });

    const none = await request(app).post(`/api/workflows/${wf.id}/test`).set(adminAuth()).send({});
    expect(none.body.conditions).toMatchObject({ evaluated: false, matches: null, reason: 'no_order' });
    expect(none.body.plan).toHaveLength(1);
    expect(sendSms).not.toHaveBeenCalled();
  });
});
