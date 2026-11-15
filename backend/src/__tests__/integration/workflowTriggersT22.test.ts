/**
 * M9-T22 (COD-81): schedule, payment received and webhook triggers.
 * Real DB (ecommerce_cod_test_c), real Redis for the repeat job, real app. The queue's `add` for run jobs runs them inline.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import Bull from 'bull';

jest.mock('../../services/metaCapiService', () => require('./helpers/paymentTestKit').metaCapiMock());

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import {
  workflowQueue, processExecuteWorkflow, createWorkflowQueue, registerWorkflowProcessors,
} from '../../queues/workflowQueue';
import { syncWorkflowSchedule, fireScheduledRun, catchUpMissedSchedules, scheduleKey } from '../../queues/workflowSchedule';
import workflowService, { hashWebhookToken } from '../../services/workflowService';
import { createTwoTenants, TwoTenants, mkUser } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';
import { registerPaymentProvider, unregisterPaymentProvider, clearPaymentConfigCache } from '../../services/payments';
import { createFakeProvider, FakeProvider } from '../../services/payments/fakeProvider';
import { ip, newRef, seedPending } from './helpers/paymentTestKit';

jest.setTimeout(120_000);
process.env.PROVIDER_ENCRYPTION_KEY = 'cd'.repeat(32);

const SUFFIX = Date.now();
const PREFIX = `T22 ${SUFFIX}`;
const QUEUE_NAME = `wf-t22-${SUFFIX}`;
let pair: TwoTenants;
let tenantId: string;
let fake: FakeProvider;
let manager: { id: number; token: string };
let seq = 0;
const queues: Bull.Queue[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => Promise<T>, what: string, timeout = 15_000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}
const NOOP = [{ type: 'wait', config: { duration: 0 } }];
const adminAuth = () => ({ Authorization: `Bearer ${pair.a.users.admin.token}` });
const bAuth = () => ({ Authorization: `Bearer ${pair.b.users.admin.token}` });
const mgrAuth = () => ({ Authorization: `Bearer ${manager.token}` });
const repAuth = () => ({ Authorization: `Bearer ${pair.a.users.salesRep.token}` });
const runs = (workflowId: number) => prismaBase.workflowExecution.findMany({ where: { workflowId }, orderBy: { id: 'asc' } });
const mkWorkflow = (triggerType: string, triggerData: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType: triggerType as any, triggerData: triggerData as any, actions: NOOP, isActive: true, tenantId, ...extra } as any,
  });
const mkOrder = async (side: 'a' | 'b' = 'a') => {
  const t = pair[side];
  return (await prismaBase.order.create({
    data: {
      customerId: t.ids.customer, status: 'pending_confirmation', subtotal: 100, totalAmount: 100, codAmount: 100, tenantId: t.id,
      deliveryAddress: '1 St', deliveryState: 'Ashanti', deliveryArea: 'Kumasi',
    } as any,
  })).id;
};

beforeAll(async () => {
  pair = await createTwoTenants('t22');
  tenantId = pair.a.id;
  manager = await mkUser(tenantId, 'mgr', 'manager');
  await stockUp(tenantId, pair.a.ids.product, 100);
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
  jest.restoreAllMocks();
  await prismaBase.workflow.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] }, name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  for (const q of queues) { try { await q.close(); } catch { /* closed */ } }
  const cleaner = createWorkflowQueue(QUEUE_NAME);
  cleaner.on('error', () => undefined);
  try { await cleaner.obliterate({ force: true }); } catch { /* nothing */ }
  await cleaner.close();
  unregisterPaymentProvider('fake');
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('schedule trigger', () => {
  it('a double fire for the same planned time starts one run: unique key, lastScheduledRunAt set, no order', async () => {
    const wf = await mkWorkflow('time_based', { cron: '0 9 * * *', timeZone: 'UTC' });
    const planned = new Date(Date.now() - 60_000);
    const first = await runInTenant(tenantId, () => fireScheduledRun(wf.id, planned, 'schedule'));
    const second = await runInTenant(tenantId, () => fireScheduledRun(wf.id, planned, 'schedule'));
    const third = await runInTenant(tenantId, () => fireScheduledRun(wf.id, planned, 'catch_up'));
    expect([first, second, third]).toEqual(['started', 'duplicate', 'duplicate']);
    const rows = await runs(wf.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'completed', orderId: null, triggerSource: 'schedule', idempotencyKey: scheduleKey(wf.id, planned) });
    expect((await prismaBase.workflow.findUniqueOrThrow({ where: { id: wf.id } })).lastScheduledRunAt?.getTime()).toBe(planned.getTime());
  });

  it('a real Bull repeat job fires each planned second once, and stops when the workflow is switched off', async () => {
    const wf = await mkWorkflow('time_based', { cron: '* * * * * *', timeZone: 'UTC' });
    const queue = createWorkflowQueue(QUEUE_NAME);
    queue.on('error', () => undefined);
    registerWorkflowProcessors(queue);
    queues.push(queue);

    await syncWorkflowSchedule(wf, queue);
    expect((await queue.getRepeatableJobs()).filter((r) => r.id === `wf-schedule-${wf.id}`)).toHaveLength(1);
    await syncWorkflowSchedule(wf, queue); // a second sync replaces, never doubles
    expect((await queue.getRepeatableJobs()).filter((r) => r.id === `wf-schedule-${wf.id}`)).toHaveLength(1);

    await waitFor(async () => (await runs(wf.id)).length >= 2, 'two scheduled runs');
    await syncWorkflowSchedule({ ...wf, isActive: false }, queue);
    expect((await queue.getRepeatableJobs()).filter((r) => r.id === `wf-schedule-${wf.id}`)).toHaveLength(0);
    await sleep(2500); // a job already queued may still land
    const settled = (await runs(wf.id)).length;
    await sleep(2500);
    expect((await runs(wf.id)).length).toBe(settled);

    const rows = await runs(wf.id);
    expect(new Set(rows.map((r) => r.idempotencyKey)).size).toBe(rows.length); // one run per planned second
    expect(rows.every((r) => r.triggerSource === 'schedule' && r.orderId === null)).toBe(true);
  });

  it('start-up catch-up: 20 minutes late runs once as catch_up; 2 hours late is skipped with missed_schedule', async () => {
    const at = (minutesAgo: number) => {
      const d = new Date(Date.now() - minutesAgo * 60_000);
      return { cron: `${d.getUTCMinutes()} ${d.getUTCHours()} * * *`, timeZone: 'UTC', planned: d };
    };
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    const late = at(20);
    const veryLate = at(120);
    const wfLate = await mkWorkflow('time_based', { cron: late.cron, timeZone: 'UTC' }, { lastScheduledRunAt: old });
    const wfVeryLate = await mkWorkflow('time_based', { cron: veryLate.cron, timeZone: 'UTC' }, { lastScheduledRunAt: old });

    await catchUpMissedSchedules();
    await catchUpMissedSchedules(); // a second start-up does nothing more

    const lateRows = await runs(wfLate.id);
    expect(lateRows).toHaveLength(1);
    expect(lateRows[0]).toMatchObject({ status: 'completed', triggerSource: 'catch_up' });
    const skipped = await runs(wfVeryLate.id);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ status: 'skipped', error: 'missed_schedule', triggerSource: 'catch_up' });
  });

  it('API: a schedule saves for an admin with the zone defaulted, refuses order conditions with 400, and a sales rep cannot', async () => {
    const ok = await request(app).post('/api/workflows').set(adminAuth()).send({
      name: `${PREFIX} sched`, triggerType: 'schedule', triggerData: { cron: '0 8 * * 1' }, actions: NOOP, conditions: { id: 'c', logic: 'AND', rules: [] },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.workflow).toMatchObject({ triggerType: 'time_based', triggerData: { cron: '0 8 * * 1', timeZone: expect.any(String) } });

    const refused = await request(app).post('/api/workflows').set(adminAuth()).send({
      name: `${PREFIX} sched2`, triggerType: 'schedule', triggerData: { cron: '0 8 * * 1' }, actions: NOOP,
      conditions: { id: 'c', logic: 'AND', rules: [{ field: 'region', operator: 'is', value: 'Ashanti' }] },
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message ?? refused.body.error).toMatch(/no order/);

    const rep = await request(app).post('/api/workflows').set(repAuth()).send({
      name: `${PREFIX} sched3`, triggerType: 'schedule', triggerData: { cron: '0 8 * * 1' }, actions: NOOP,
    });
    expect(rep.status).toBe(403);
    expect(await prismaBase.workflow.count({ where: { tenantId, name: `${PREFIX} sched3` } })).toBe(0);
  });
});

describe('payment received trigger', () => {
  it('a duplicate settlement webhook fires it once', async () => {
    const wf = await mkWorkflow('payment_received', {});
    const ref = newRef('t22');
    await seedPending(pair, 'a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50', fee: '0.75', channel: 'card' });
    const hit = () => request(app).post(`/api/payments/webhook/fake/${pair.a.slug}`).set('X-Forwarded-For', ip()).set('x-fake-signature', 'valid')
      .send({ type: 'payment.success', reference: ref });
    expect((await hit()).status).toBe(200);
    expect((await hit()).status).toBe(200); // the provider retries
    const order = await prismaBase.order.findFirstOrThrow({ where: { paymentReference: ref } });

    await waitFor(async () => (await runs(wf.id)).length >= 1, 'the payment run');
    await sleep(700);
    const rows = await runs(wf.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'completed', orderId: order.id, triggerSource: 'payment', idempotencyKey: `payment:${order.id}:${ref}` });
  });

  it('the idempotency key alone stops a second event for the same payment', async () => {
    const wf = await mkWorkflow('payment_received', {});
    const orderId = await mkOrder();
    const evt: any = { tenantId, orderId, provider: 'fake', reference: 'dup-ref', currency: 'GHS', amount: '10', fee: '0', feeUnknown: false, channel: null, paidAt: new Date(), orderType: 'physical', method: 'online_full' };
    await workflowService.onPaymentSettled(evt);
    await workflowService.onPaymentSettled(evt);
    expect(await runs(wf.id)).toHaveLength(1);
  });

  it('only the payer tenant fires: tenant B workflows hear nothing', async () => {
    const wfB = await prismaBase.workflow.create({
      data: { name: `${PREFIX} b`, triggerType: 'payment_received', triggerData: {}, actions: NOOP, isActive: true, tenantId: pair.b.id },
    });
    const orderId = await mkOrder();
    await workflowService.onPaymentSettled({ tenantId, orderId, provider: 'fake', reference: 'only-a', amount: '10' } as any);
    expect(await runs(wfB.id)).toHaveLength(0);
  });
});

describe('webhook trigger', () => {
  const create = async (name = 'hook') => {
    const res = await request(app).post('/api/workflows').set(adminAuth()).send({ name: `${PREFIX} ${name}`, triggerType: 'webhook', triggerData: {}, actions: NOOP });
    expect(res.status).toBe(201);
    return res.body as { workflow: any; webhookToken: string };
  };
  const hit = (token: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    request(app).post(`/api/workflows/hooks/${token}`).set(headers).send(body as object);

  it('save returns the token once; only its sha256 hash is stored; list and get never show it', async () => {
    const { workflow, webhookToken } = await create();
    expect(webhookToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(workflow)).not.toContain(webhookToken);
    expect(workflow.webhookTokenHash).toBeUndefined();
    expect(workflow.hasWebhookToken).toBe(true);

    const row = await prismaBase.workflow.findUniqueOrThrow({ where: { id: workflow.id } });
    expect(row.webhookTokenHash).toBe(hashWebhookToken(webhookToken));
    expect(row.webhookTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(webhookToken);

    const list = await request(app).get('/api/workflows').set(adminAuth());
    const get = await request(app).get(`/api/workflows/${workflow.id}`).set(adminAuth());
    const put = await request(app).put(`/api/workflows/${workflow.id}`).set(adminAuth()).send({ name: `${PREFIX} renamed`, webhookTokenHash: 'evil' });
    for (const res of [list, get, put]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(webhookToken);
      expect(JSON.stringify(res.body)).not.toContain(row.webhookTokenHash!);
    }
    expect((await prismaBase.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).webhookTokenHash).toBe(row.webhookTokenHash); // the body could not replace it
  });

  it('a valid token with an order of the tenant runs the workflow with that order (no login)', async () => {
    const { workflow, webhookToken } = await create();
    const orderId = await mkOrder('a');
    const res = await hit(webhookToken, { orderId, data: { note: 'from the courier app' } });
    expect(res.status).toBe(202);
    const rows = await runs(workflow.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'completed', orderId, triggerSource: 'webhook' });
    expect((rows[0].input as any).data).toEqual({ note: 'from the courier app' });
  });

  it('no order is fine; another tenant\'s order and an unknown order are 404; an unknown token is 404', async () => {
    const { workflow, webhookToken } = await create();
    expect((await hit(webhookToken, { data: { a: 1 } })).status).toBe(202);
    const orderOfB = await mkOrder('b');
    expect((await hit(webhookToken, { orderId: orderOfB })).status).toBe(404);
    expect((await hit(webhookToken, { orderId: 2147483000 })).status).toBe(404);
    expect((await hit(webhookToken, { orderId: 'abc' })).status).toBe(400);
    expect((await hit('x'.repeat(43), {})).status).toBe(404);
    expect(await runs(workflow.id)).toHaveLength(1); // only the first call ran
  });

  it('a workflow that is off answers 409 and runs nothing', async () => {
    const { workflow, webhookToken } = await create();
    expect((await request(app).put(`/api/workflows/${workflow.id}`).set(adminAuth()).send({ isActive: false })).status).toBe(200);
    expect((await hit(webhookToken, {})).status).toBe(409);
    expect(await runs(workflow.id)).toHaveLength(0);
  });

  it('Idempotency-Key makes the run webhook:<workflowId>:<key>; the same key twice runs once', async () => {
    const { workflow, webhookToken } = await create();
    expect((await hit(webhookToken, {}, { 'Idempotency-Key': 'evt-1' })).status).toBe(202);
    expect((await hit(webhookToken, {}, { 'Idempotency-Key': 'evt-1' })).status).toBe(202);
    expect((await hit(webhookToken, {}, { 'Idempotency-Key': 'evt-2' })).status).toBe(202);
    const rows = await runs(workflow.id);
    expect(rows.map((r) => r.idempotencyKey).sort()).toEqual([`webhook:${workflow.id}:evt-1`, `webhook:${workflow.id}:evt-2`]);
  });

  it('regenerate: the old token stops working, the new one works; a sales rep and another tenant cannot', async () => {
    const { workflow, webhookToken } = await create();
    expect((await request(app).post(`/api/workflows/${workflow.id}/webhook-token/regenerate`).set(repAuth())).status).toBe(403);
    expect((await request(app).post(`/api/workflows/${workflow.id}/webhook-token/regenerate`).set(bAuth())).status).toBe(404);
    const res = await request(app).post(`/api/workflows/${workflow.id}/webhook-token/regenerate`).set(mgrAuth()); // a manager may
    expect(res.status).toBe(200);
    const fresh = res.body.webhookToken as string;
    expect(fresh).not.toBe(webhookToken);
    expect((await hit(webhookToken, {})).status).toBe(404);
    expect((await hit(fresh, {})).status).toBe(202);
    expect((await prismaBase.workflow.findUniqueOrThrow({ where: { id: workflow.id } })).webhookTokenHash).toBe(hashWebhookToken(fresh));
  });

  it('rate limit: 60 calls a minute per token, the 61st is 429, another token is not affected', async () => {
    const { webhookToken } = await create('limit a');
    const other = await create('limit b');
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await hit(webhookToken, {}, { 'X-Forwarded-For': ip() })).status);
    expect(codes.slice(0, 60).every((c) => c === 202)).toBe(true);
    expect(codes[60]).toBe(429);
    expect((await hit(other.webhookToken, {})).status).toBe(202);
  });
});
