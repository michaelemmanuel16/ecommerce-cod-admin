/**
 * M9-T23 (COD-81): the "Assign to" action, the Region condition, the regions list and catch-up.
 * Real DB (ecommerce_cod_test_c) and app. The queue's `add` runs run jobs and catch-up batches inline.
 * Each test uses its own region name, so counts never mix.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { workflowQueue, processExecuteWorkflow, CATCH_UP_JOB } from '../../queues/workflowQueue';
import { processCatchUpBatch, CATCH_UP_BATCH } from '../../services/workflowCatchUpService';
import { createTwoTenants, TwoTenants, mkUser } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const PREFIX = `T23 ${SUFFIX}`;
let pair: TwoTenants;
let tenantId: string;
let seq = 0;
let addCalls: Array<{ name: string; data: any }> = [];
let runCatchUpInline = true;

const adminAuth = () => ({ Authorization: `Bearer ${pair.a.users.admin.token}` });
const bAuth = () => ({ Authorization: `Bearer ${pair.b.users.admin.token}` });
const repAuth = () => ({ Authorization: `Bearer ${pair.a.users.salesRep.token}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const agent = (label: string, extra: Record<string, unknown> = {}) => mkUser(tenantId, `${label}${seq++}`, 'delivery_agent', extra);
const region = (value: string, operator = 'is') => ({ id: 'c', logic: 'AND', rules: [{ field: 'region', operator, value }] });
const assignTo = (config: Record<string, unknown>) => ({ type: 'assign_to', config: { role: 'delivery_agent', split: 'even', ...config } });
const mkWorkflow = (triggerType: string, actions: any[], conditions: any, triggerData: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType: triggerType as any, triggerData: triggerData as any, actions, conditions, isActive: true, tenantId, ...extra } as any,
  });
const mkOrder = async (state: string, extra: Record<string, unknown> = {}, side: 'a' | 'b' = 'a') => {
  const t = pair[side];
  return (await prismaBase.order.create({
    data: {
      customerId: t.ids.customer, status: 'pending_confirmation', subtotal: 100, totalAmount: 100, codAmount: 100, tenantId: t.id,
      deliveryAddress: '1 St', deliveryState: state, deliveryArea: 'Town', ...extra,
    } as any,
  })).id;
};
const agentOf = async (orderId: number) => (await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId;
const runs = (workflowId: number) => prismaBase.workflowExecution.findMany({ where: { workflowId }, orderBy: { id: 'asc' } });
/** Place an order through the API: order_created fires the workflows. */
const place = (state: string) =>
  request(app).post('/api/orders').set(adminAuth()).send({
    customerPhone: `+23324${String(Date.now()).slice(-6)}${seq++ % 10}`, customerName: 'Region Buyer',
    orderItems: [{ productId: pair.a.ids.product, quantity: 1, unitPrice: 50 }],
    subtotal: 50, totalAmount: 50, deliveryAddress: '7 Region Rd', deliveryState: state, deliveryArea: 'Town',
  });
const settle = async (orderId: number) => {
  // The listener runs after the response: wait for the run to finish
  for (let i = 0; i < 60; i++) {
    const rows = await prismaBase.workflowExecution.findMany({ where: { orderId, status: { in: ['pending', 'running'] } } });
    if (rows.length === 0 && (await prismaBase.workflowExecution.count({ where: { orderId } })) > 0) return;
    await sleep(100);
  }
};

beforeAll(async () => {
  pair = await createTwoTenants('t23');
  tenantId = pair.a.id;
  await stockUp(tenantId, pair.a.ids.product, 100);
}, 60_000);

beforeEach(() => {
  addCalls = [];
  runCatchUpInline = true;
  jest.spyOn(workflowQueue, 'add').mockImplementation((async (name: string, data: any) => {
    addCalls.push({ name, data });
    if (name === CATCH_UP_JOB) {
      if (runCatchUpInline) await processCatchUpBatch({ id: 'inline-catchup', data } as any);
      return;
    }
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

describe('Region is Ashanti + Assign to Kofi', () => {
  it('assigns an Ashanti order to Kofi (case and spaces do not matter); a Volta order stays unassigned', async () => {
    const kofi = await agent('Kofi');
    const wf = await mkWorkflow('order_created', [assignTo({ userIds: [kofi.id] })], region('Ashanti'));

    const ashanti = await place('  ASHANTI ');
    const volta = await place('Volta');
    expect(ashanti.status).toBe(201);
    await settle(ashanti.body.order.id);
    await settle(volta.body.order.id);

    expect(await agentOf(ashanti.body.order.id)).toBe(kofi.id);
    expect(await agentOf(volta.body.order.id)).toBeNull();
    // through the assignment service: a history row by the system user
    const history = await prismaBase.orderHistory.findMany({ where: { orderId: ashanti.body.order.id, notes: { contains: 'assigned' } } });
    expect(history).toHaveLength(1);
    expect(history[0].actorKind).toBe('system');
    const steps = (await runs(wf.id)).flatMap((r) => r.steps as any[]);
    expect(steps.find((s) => s.result?.reason === 'conditions_not_met')).toBeTruthy(); // the Volta step says why
    expect(steps.find((s) => s.result?.assigned === true)).toBeTruthy();
  });

  it('an order saved through the API with the action saved over the API (assign_to validated at save)', async () => {
    const kofi = await agent('Kofi');
    const ok = await request(app).post('/api/workflows').set(adminAuth()).send({
      name: `${PREFIX} api`, triggerType: 'order_created', triggerData: {}, actions: [assignTo({ userIds: [kofi.id] })], conditions: region('Ashanti'),
    });
    expect(ok.status).toBe(201);
    const bad = await request(app).post('/api/workflows').set(adminAuth()).send({
      name: `${PREFIX} api2`, triggerType: 'order_created', triggerData: {}, actions: [assignTo({ userIds: [] })], conditions: {},
    });
    expect(bad.status).toBe(400);
    const badSplit = await request(app).post('/api/workflows').set(adminAuth()).send({
      name: `${PREFIX} api3`, triggerType: 'order_created', triggerData: {}, actions: [assignTo({ userIds: [kofi.id], split: 'weighted' })], conditions: {},
    });
    expect(badSplit.status).toBe(400);
  });
});

describe('even and weighted splits on the M6 cursor', () => {
  it('two agents on one region split evenly: A, B, A, B', async () => {
    const a = await agent('Ama');
    const b = await agent('Kwesi');
    await mkWorkflow('order_created', [assignTo({ userIds: [a.id, b.id] })], region('Eastern'));
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await place('Eastern');
      await settle(res.body.order.id);
      ids.push(res.body.order.id);
    }
    expect(await Promise.all(ids.map(agentOf))).toEqual([a.id, b.id, a.id, b.id]);
    const cursor = await prismaBase.assignmentCursor.findMany({ where: { tenantId, scope: { startsWith: 'workflow:' } } });
    expect(cursor.length).toBeGreaterThan(0); // the cursor row of this workflow action
  });

  it('weighted 3:1 gives exact shares over one cycle', async () => {
    const a = await agent('Heavy');
    const b = await agent('Light');
    await mkWorkflow('order_created', [assignTo({ userIds: [a.id, b.id], split: 'weighted', weights: { [a.id]: 3, [b.id]: 1 } })], region('Bono'));
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await place('Bono');
      await settle(res.body.order.id);
      ids.push(res.body.order.id);
    }
    const got = await Promise.all(ids.map(agentOf));
    expect(got.filter((x) => x === a.id)).toHaveLength(3);
    expect(got.filter((x) => x === b.id)).toHaveLength(1);
  });

  it('a deactivated user is skipped; when all are skipped the order stays unassigned and the step says why', async () => {
    const live = await agent('Live');
    const gone = await agent('Gone', { isActive: false });
    const wf = await mkWorkflow('order_created', [assignTo({ userIds: [gone.id, live.id] })], region('Central'));
    const r1 = await place('Central');
    await settle(r1.body.order.id);
    expect(await agentOf(r1.body.order.id)).toBe(live.id);

    await prismaBase.user.update({ where: { id: live.id }, data: { isActive: false } });
    const r2 = await place('Central');
    await settle(r2.body.order.id);
    expect(await agentOf(r2.body.order.id)).toBeNull();
    const last = (await runs(wf.id)).find((r) => r.orderId === r2.body.order.id)!;
    expect((last.steps as any[])[0].result).toMatchObject({ assigned: false, reason: 'no_available_user' });
    expect(last.status).toBe('completed');
  });

  it('never swaps an order that already has an agent', async () => {
    const kofi = await agent('Kofi');
    const other = await agent('Other');
    await mkWorkflow('order_created', [assignTo({ userIds: [kofi.id] })], region('Northern'));
    const res = await place('Northern');
    await settle(res.body.order.id);
    expect(await agentOf(res.body.order.id)).toBe(kofi.id);
    // the same order again (a manual run) leaves Kofi
    await prismaBase.order.update({ where: { id: res.body.order.id }, data: { deliveryAgentId: other.id } });
    const wf2 = await mkWorkflow('manual', [assignTo({ userIds: [kofi.id] })], null);
    const run = await request(app).post(`/api/workflows/${wf2.id}/execute`).set(adminAuth()).send({ input: { orderId: res.body.order.id } });
    expect(run.status).toBe(200);
    await settle(res.body.order.id);
    expect(await agentOf(res.body.order.id)).toBe(other.id);
  });
});

describe('regions list', () => {
  it('GET /api/workflows/meta/regions returns the 16 regions of Ghana for a Ghana store', async () => {
    const res = await request(app).get('/api/workflows/meta/regions').set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.countryCode).toBe('GH');
    expect(res.body.regions).toHaveLength(16);
    expect(res.body.regions).toEqual(expect.arrayContaining(['Ashanti', 'Greater Accra', 'Volta']));
  });
});

describe('catch-up', () => {
  const catchUpFlow = async (stateName: string) => {
    const kofi = await agent('Kofi');
    const wf = await mkWorkflow('order_created', [assignTo({ userIds: [kofi.id] })], region(stateName));
    const waiting = [await mkOrder(stateName), await mkOrder(stateName.toUpperCase()), await mkOrder(` ${stateName}`)];
    const elsewhere = await mkOrder('Elsewhere');
    const taken = await mkOrder(stateName, { deliveryAgentId: kofi.id });
    return { kofi, wf, waiting, elsewhere, taken };
  };

  it('preview counts the matching unassigned orders and lists the first ids', async () => {
    const { wf, waiting } = await catchUpFlow('Savannah');
    const res = await request(app).get(`/api/workflows/${wf.id}/catch-up/preview`).set(adminAuth());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.orderIds).toEqual(waiting);
  });

  it('the run needs confirm: 400 without it, 409 when the workflow is off, then it assigns once; a double click does nothing', async () => {
    const { kofi, wf, waiting, elsewhere, taken } = await catchUpFlow('Upper East');

    expect((await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({})).status).toBe(400);
    expect((await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({ confirm: 'yes' })).status).toBe(400);
    expect(await agentOf(waiting[0])).toBeNull();

    await prismaBase.workflow.update({ where: { id: wf.id }, data: { isActive: false } });
    expect((await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({ confirm: true })).status).toBe(409);
    await prismaBase.workflow.update({ where: { id: wf.id }, data: { isActive: true } });
    const stamp = (await prismaBase.workflow.findUniqueOrThrow({ where: { id: wf.id } })).updatedAt;

    const res = await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({ confirm: true });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 3, batches: 1 });
    for (const id of waiting) expect(await agentOf(id)).toBe(kofi.id);
    expect(await agentOf(elsewhere)).toBeNull();
    expect(await agentOf(taken)).toBe(kofi.id);

    const rows = await runs(wf.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.triggerSource === 'catch_up')).toBe(true);
    expect(rows.map((r) => r.idempotencyKey).sort()).toEqual(waiting.map((id) => `catchup:${wf.id}:${id}:${stamp.toISOString()}`).sort());

    // double click: nothing left to match, and the same batch job again adds no execution
    const again = await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({ confirm: true });
    expect(again.body).toEqual({ queued: 0, batches: 0 });
    await processCatchUpBatch({ id: 'replay', data: { workflowId: wf.id, tenantId, orderIds: waiting, stamp: stamp.toISOString() } } as any);
    expect(await runs(wf.id)).toHaveLength(3);
  });

  it('a big catch-up is queued 50 orders a job', async () => {
    runCatchUpInline = false;
    const kofi = await agent('Kofi');
    const wf = await mkWorkflow('order_created', [assignTo({ userIds: [kofi.id] })], region('Western North'));
    const t = pair.a;
    await prismaBase.order.createMany({
      data: Array.from({ length: 120 }, () => ({
        customerId: t.ids.customer, status: 'pending_confirmation', subtotal: 1, totalAmount: 1, codAmount: 1, tenantId: t.id,
        deliveryAddress: '1 St', deliveryState: 'Western North', deliveryArea: 'Town',
      })) as any,
    });
    const res = await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({ confirm: true });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ queued: 120, batches: 3 });
    const jobs = addCalls.filter((c) => c.name === CATCH_UP_JOB);
    expect(jobs.map((j) => j.data.orderIds.length)).toEqual([CATCH_UP_BATCH, CATCH_UP_BATCH, 20]);
    expect(CATCH_UP_BATCH).toBe(50);
  });

  it('a workflow with no Assign to action has nothing to catch up (400)', async () => {
    const wf = await mkWorkflow('order_created', [{ type: 'wait', config: { duration: 0 } }], region('Oti'));
    expect((await request(app).get(`/api/workflows/${wf.id}/catch-up/preview`).set(adminAuth())).status).toBe(400);
  });

  it('only owner, admin and manager: a sales rep gets 403', async () => {
    const { wf } = await catchUpFlow('Ahafo');
    expect((await request(app).get(`/api/workflows/${wf.id}/catch-up/preview`).set(repAuth())).status).toBe(403);
    expect((await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(repAuth()).send({ confirm: true })).status).toBe(403);
  });
});

describe('two tenants', () => {
  it('tenant B cannot see, preview, catch up or change tenant A\'s workflow: 404', async () => {
    const { wf } = await (async () => {
      const kofi = await agent('Kofi');
      return { wf: await mkWorkflow('order_created', [assignTo({ userIds: [kofi.id] })], region('Savannah')) };
    })();
    expect((await request(app).get(`/api/workflows/${wf.id}`).set(bAuth())).status).toBe(404);
    expect((await request(app).get(`/api/workflows/${wf.id}/catch-up/preview`).set(bAuth())).status).toBe(404);
    expect((await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(bAuth()).send({ confirm: true })).status).toBe(404);
    expect((await request(app).put(`/api/workflows/${wf.id}`).set(bAuth()).send({ name: 'taken' })).status).toBe(404);
    const list = await request(app).get('/api/workflows').set(bAuth());
    expect(list.body.workflows.map((w: any) => w.id)).not.toContain(wf.id);
  });

  it('catch-up in tenant A never counts or touches tenant B orders', async () => {
    const kofi = await agent('Kofi');
    const wf = await mkWorkflow('order_created', [assignTo({ userIds: [kofi.id] })], region('Volta'));
    const mine = await mkOrder('Volta');
    const theirs = await mkOrder('Volta', {}, 'b');
    const preview = await request(app).get(`/api/workflows/${wf.id}/catch-up/preview`).set(adminAuth());
    expect(preview.body.orderIds).toContain(mine);
    expect(preview.body.orderIds).not.toContain(theirs);
    await request(app).post(`/api/workflows/${wf.id}/catch-up`).set(adminAuth()).send({ confirm: true });
    expect(await agentOf(mine)).toBe(kofi.id);
    expect(await agentOf(theirs)).toBeNull();
  });
});
