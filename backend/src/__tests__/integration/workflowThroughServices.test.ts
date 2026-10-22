/**
 * M2-T16 / M2-T17: workflow actions go through the services (state machine, assignmentService), and
 * workflow triggers come from the state machine's events (`order.created`, `order.status_changed`).
 * The workflow queue is a no-op in tests, so `add` is replaced with an inline run of the real job.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { toolActorContext } from './helpers/callTool';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { getSystemUserId } from '../../services/systemUserService';
import { generateAccessToken } from '../../utils/jwt';
import workflowService, { LOOP_GUARD_MESSAGE, workflowSkipReason } from '../../services/workflowService';
import { workflowQueue, processExecuteWorkflow, executeAction } from '../../queues/workflowQueue';
import orderService from '../../services/orderService';
import { runTool } from '../../tools/registry';
import '../../tools';
import appEvents, { AppEvent } from '../../utils/appEvents';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let tenantId: string;
let customerId: number;
let productId: number;
let agentId: number;
let admin: any;
let systemUserId: number;

const auth = () => ({
  Authorization: `Bearer ${generateAccessToken({ id: admin.id, email: admin.email, role: admin.role, tenantId })}`,
});
const mkOrder = async (status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: {
      customerId, status, subtotal: 100, totalAmount: 100, codAmount: 100, tenantId, deliveryAgentId: agentId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      orderItems: { create: { productId, quantity: 2, unitPrice: 50, totalPrice: 100 } },
      ...extra,
    } as any,
  })).id;
const patchStatus = (id: number, body: Record<string, unknown>) =>
  request(app).patch(`/api/orders/${id}/status`).set(auth()).send(body);
const statusOf = async (id: number) => (await prismaBase.order.findUniqueOrThrow({ where: { id } })).status;
const stock = async () => (await prismaBase.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `fn` returns a truthy value (the events run after the response). */
async function waitFor<T>(fn: () => Promise<T>, what: string, timeout = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

/** An active workflow. `http_request` is a harmless action: the test counts executions. */
const mkWorkflow = (
  name: string,
  triggerType: 'status_change' | 'order_created',
  triggerData: Record<string, unknown>,
  actions: any[] = [{ type: 'http_request', config: { url: 'https://example.test' } }],
) =>
  prismaBase.workflow.create({
    data: { name: `${name} ${SUFFIX}`, triggerType, triggerData: triggerData as any, actions, isActive: true, tenantId },
  });
const setStatus = (to: string) => ({ type: 'update_order', config: { status: to } });
const executions = (workflowId: number) =>
  prismaBase.workflowExecution.findMany({ where: { workflowId }, orderBy: { id: 'asc' } });
const live = async (workflowId: number) => (await executions(workflowId)).filter((e) => e.status !== 'skipped');
/** Time for an event that should NOT fire anything to have fired it, if it were going to. */
const quiet = () => sleep(500);

beforeAll(async () => {
  tenantId = (await createTenant('WTS Tenant')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  productId = (await prismaBase.product.create({
    data: { sku: `WTS-${SUFFIX}`, name: 'WTS Product', category: 'test', price: 50, cogs: 20, stockQuantity: 50, tenantId },
  })).id;
  agentId = (await prismaBase.user.create({
    data: { email: `wts-agent-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Kofi', lastName: 'Agent', role: 'delivery_agent', tenantId },
  })).id;
  admin = await prismaBase.user.create({
    data: { email: `wts-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'admin', tenantId },
  });
  systemUserId = await runInTenant(tenantId, () => getSystemUserId());
}, 30000);

beforeEach(() => {
  // Run the job at once, the way the Bull worker would later
  jest.spyOn(workflowQueue, 'add').mockImplementation((async (_name: string, data: any) => {
    await processExecuteWorkflow({ id: 'inline', data } as any);
  }) as any);
});

afterEach(async () => {
  await prismaBase.workflow.deleteMany({ where: { tenantId } }); // executions go with them
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('M2-T16 workflow actions go through the services', () => {
  it('a chain of workflows moves an order to delivered: one system history row per move, stock and ledger once', async () => {
    const toOut = await mkWorkflow('confirmed->out', 'status_change', { status: 'confirmed' }, [setStatus('out_for_delivery')]);
    const toDelivered = await mkWorkflow('out->delivered', 'status_change', { status: 'out_for_delivery' }, [setStatus('delivered')]);
    const id = await mkOrder('pending_confirmation');
    const stockBefore = await stock();

    expect((await patchStatus(id, { status: 'confirmed' })).status).toBe(200);
    await waitFor(async () => (await statusOf(id)) === 'delivered', 'order delivered');
    await waitFor(async () => (await live(toDelivered.id)).every((e) => e.status === 'completed') && (await live(toDelivered.id)).length === 1, 'chain end');

    for (const status of ['out_for_delivery', 'delivered']) {
      const rows = await prismaBase.orderHistory.findMany({ where: { orderId: id, status: status as any } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actorKind: 'system', changedBy: systemUserId });
    }
    expect(await live(toOut.id)).toHaveLength(1);
    // warehouse stock leaves once (entering out_for_delivery); delivering confirms, it does not deduct again
    expect(await stock()).toBe(stockBefore - 2);
    expect(await prismaBase.journalEntry.count({ where: { tenantId, sourceType: 'order_delivery', sourceId: id } })).toBe(1);
  });

  it('assign_agent writes the order, an OrderHistory row with the system actor and the audit log', async () => {
    const other = await prismaBase.user.create({
      data: { email: `wts-agent2-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Yaw', lastName: 'Agent', role: 'delivery_agent', tenantId },
    });
    const id = await mkOrder('confirmed');

    const result = await runInTenant(tenantId, () =>
      executeAction({ type: 'assign_agent', config: { agentId: other.id } }, { orderId: id }));

    expect(result).toEqual({ assigned: true });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deliveryAgentId).toBe(other.id);
    const history = await prismaBase.orderHistory.findMany({ where: { orderId: id, notes: { contains: 'Delivery agent assigned' } } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actorKind: 'system', changedBy: systemUserId, metadata: { assignedAgentId: other.id } });
    const audit = await prismaBase.auditLog.findMany({ where: { tenantId, action: 'assign_agent', resourceId: String(id) } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorKind: 'system', channel: 'system', userId: systemUserId });
  });

  it('the manual assignment path uses the same function and records a user actor', async () => {
    const id = await mkOrder('confirmed');
    await runInTenant(tenantId, () => orderService.assignDeliveryAgent(id, agentId, { id: admin.id, role: 'admin' } as any));
    const history = await prismaBase.orderHistory.findMany({ where: { orderId: id, notes: { contains: 'Delivery agent assigned' } } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actorKind: 'user', changedBy: admin.id });
  });

  it('the assign endpoints refuse an empty body, a non-numeric body id and a non-numeric route id with 400', async () => {
    const id = await mkOrder('confirmed');
    for (const [route, field] of [['assign-agent', 'deliveryAgentId'], ['assign-rep', 'customerRepId']]) {
      const patch = (orderId: string | number, body: Record<string, unknown>) =>
        request(app).patch(`/api/orders/${orderId}/${route}`).set(auth()).send(body);
      expect((await patch(id, {})).status).toBe(400);
      expect((await patch(id, { [field]: 'abc' })).status).toBe(400);
      expect((await patch('abc', { [field]: agentId })).status).toBe(400);
    }
  });

  it('assign-agent over HTTP writes an audit row with actorKind person and channel app, found by ?channel=app', async () => {
    const id = await mkOrder('confirmed');
    const res = await request(app).patch(`/api/orders/${id}/assign-agent`).set(auth()).send({ deliveryAgentId: agentId });
    expect(res.status).toBe(200);
    const row = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId, action: 'assign_agent', resourceId: String(id) } });
    expect(row).toMatchObject({ actorKind: 'person', channel: 'app', userId: admin.id });
    const list = await request(app).get('/api/audit-log?channel=app&limit=100').set(auth());
    expect(list.status).toBe(200);
    expect(list.body.logs.map((r: any) => r.id)).toContain(row.id);
  });

  it('assign_agent refuses a user that does not exist (404) or has the wrong role (400), and writes nothing', async () => {
    const id = await mkOrder('confirmed');
    const run = (userId: number) => runInTenant(tenantId, () =>
      executeAction({ type: 'assign_agent', config: { agentId: userId } }, { orderId: id }));
    await expect(run(999999999)).rejects.toMatchObject({ statusCode: 404 });
    await expect(run(admin.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(await prismaBase.orderHistory.count({ where: { orderId: id, notes: { contains: 'assigned' } } })).toBe(0);
  });

  describe('update_order sets status, priority and notes (and nothing else)', () => {
    const viaQueue = (action: any, id: number) => runInTenant(tenantId, () => executeAction(action, { orderId: id }));
    const viaService = (action: any, id: number) =>
      runInTenant(tenantId, () => (workflowService as any).executeAction(action, { orderId: id }));
    const row = (id: number) => prismaBase.order.findUniqueOrThrow({ where: { id } });
    const history = (id: number) => prismaBase.orderHistory.count({ where: { orderId: id } });

    it('an empty action fails with the three-field message', async () => {
      const id = await mkOrder('confirmed');
      await expect(viaQueue({ type: 'update_order', config: {} }, id)).rejects.toThrow('update_order needs a status, priority or notes');
      await expect(viaService({ type: 'update_order' }, id)).rejects.toThrow('update_order needs a status, priority or notes');
    });

    it.each([['queue', viaQueue], ['service', viaService]])('priority only (%s): word and integer set priority, no history row, status unchanged', async (_n, run) => {
      const id = await mkOrder('confirmed');
      const before = await history(id);
      await run({ type: 'update_order', config: { priority: 'high' } }, id);
      expect((await row(id)).priority).toBe(10);
      await run({ type: 'update_order', priority: 7 }, id);
      expect((await row(id)).priority).toBe(7);
      await run({ type: 'update_order', config: { priority: '3' } }, id);
      const after = await row(id);
      expect(after.priority).toBe(3);
      expect(after.status).toBe('confirmed');
      expect(await history(id)).toBe(before);
    });

    it('a priority-only update fires no status_change workflow', async () => {
      const wf = await mkWorkflow('priority quiet', 'status_change', {});
      const id = await mkOrder('confirmed');
      await viaQueue({ type: 'update_order', config: { priority: 'urgent' } }, id);
      await quiet();
      expect(await live(wf.id)).toHaveLength(0);
    });

    it('notes are appended to the staff notes, trimmed', async () => {
      const id = await mkOrder('confirmed', { notes: 'Call before 5pm' });
      await viaQueue({ type: 'update_order', config: { notes: '  VIP customer  ' } }, id);
      expect((await row(id)).notes).toBe('Call before 5pm\nVIP customer');
      const bare = await mkOrder('confirmed');
      await viaService({ type: 'update_order', notes: 'first note' }, bare);
      expect((await row(bare)).notes).toBe('first note');
    });

    it('status + priority + notes in one action: one history row, all three set', async () => {
      const id = await mkOrder('pending_confirmation');
      const before = await history(id);
      const out = await viaService({ type: 'update_order', config: { status: 'confirmed', priority: 'low', notes: 'checked' } }, id);
      const after = await row(id);
      expect([after.status, after.priority, after.notes]).toEqual(['confirmed', 1, 'checked']);
      expect(await history(id)).toBe(before + 1);
      expect(out.updates).toEqual({ status: 'confirmed', priority: 1, notes: 'checked' });
    });

    it('rejects a bad priority or notes and writes nothing, not even the status', async () => {
      const id = await mkOrder('pending_confirmation', { notes: 'keep' });
      for (const bad of ['abc', 1.5, '2.5', true, {}, -1, '-5']) {
        await expect(viaQueue({ type: 'update_order', config: { status: 'confirmed', priority: bad } }, id)).rejects.toThrow('priority');
      }
      await expect(viaQueue({ type: 'update_order', config: { notes: '   ' } }, id)).rejects.toThrow('notes');
      await expect(viaQueue({ type: 'update_order', config: { notes: 'x'.repeat(1001) } }, id)).rejects.toThrow('notes');
      const after = await row(id);
      expect([after.status, after.priority, after.notes]).toEqual(['pending_confirmation', 0, 'keep']);
    });

    it('a missing order is a 404 for a priority write', async () => {
      await expect(viaQueue({ type: 'update_order', config: { priority: 'high' } }, 2147483000)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('config.updates is never spread into the write: only its status is read', async () => {
      const id = await mkOrder('pending_confirmation');
      await viaQueue({ type: 'update_order', config: { updates: { deliveryAddress: 'x', priority: 3, status: 'confirmed' } } }, id);
      const after = await row(id);
      expect([after.status, after.deliveryAddress, after.priority]).toEqual(['confirmed', '1 St', 0]);
    });
  });

  it('update_order refuses a move the state machine refuses (no direct write)', async () => {
    const id = await mkOrder('delivered');
    await expect(runInTenant(tenantId, () =>
      executeAction({ type: 'update_order', config: { status: 'confirmed' } }, { orderId: id }))).rejects.toThrow();
    expect(await statusOf(id)).toBe('delivered');
  });
});

describe('M2-T17 triggers come from the state machine', () => {
  describe('skip rules (pure)', () => {
    const base = { orderId: 1, tenantId: 't' };
    const move = { ...base, from: 'confirmed' as const, to: 'delivered' as const };
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);

    it('fires for a person, even with an old delivery date', () => {
      expect(workflowSkipReason({ ...move, actor: { kind: 'user' }, depth: 0, deliveryDate: old })).toBeNull();
    });
    it('skips an integration move with a delivery date older than 1 day, unless runWorkflows', () => {
      expect(workflowSkipReason({ ...move, actor: { kind: 'integration' }, depth: 0, deliveryDate: old })).not.toBeNull();
      expect(workflowSkipReason({ ...move, actor: { kind: 'integration' }, depth: 0, deliveryDate: new Date() })).toBeNull();
      expect(workflowSkipReason({ ...move, actor: { kind: 'integration' }, depth: 0, deliveryDate: old, runWorkflows: true })).toBeNull();
    });
    it('skips an imported order that is not pending_confirmation, unless runWorkflows', () => {
      expect(workflowSkipReason({ ...base, status: 'confirmed', imported: true })).not.toBeNull();
      expect(workflowSkipReason({ ...base, status: 'pending_confirmation', imported: true })).toBeNull();
      expect(workflowSkipReason({ ...base, status: 'confirmed', imported: true, runWorkflows: true })).toBeNull();
      expect(workflowSkipReason({ ...base, status: 'confirmed' })).toBeNull();
    });
  });

  it('a status change from the app (API) fires the status_change workflow once', async () => {
    const wf = await mkWorkflow('on confirmed', 'status_change', { status: 'confirmed' });
    const id = await mkOrder('pending_confirmation');
    expect((await patchStatus(id, { status: 'confirmed' })).status).toBe(200);
    await waitFor(async () => (await live(wf.id)).length === 1, 'execution');
    await quiet();
    expect(await live(wf.id)).toHaveLength(1);
    expect((await live(wf.id))[0].input).toMatchObject({ orderId: id, oldStatus: 'pending_confirmation', newStatus: 'confirmed' });
  });

  describe('from MCP (orders_update_status, integration actor)', () => {
    const call = async (args: Record<string, unknown>) =>
      runTool('orders_update_status', args, await toolActorContext(tenantId, 'mcp'));
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString().slice(0, 10);

    it('a live change fires', async () => {
      const wf = await mkWorkflow('on delivered', 'status_change', { status: 'delivered' });
      const id = await mkOrder('out_for_delivery');
      expect(await call({ orderId: id, status: 'delivered' })).toMatchObject({ status: 'ok' });
      await waitFor(async () => (await live(wf.id)).length === 1, 'execution');
    });

    it('a change with a delivery date more than 1 day in the past fires nothing', async () => {
      const wf = await mkWorkflow('on delivered', 'status_change', { status: 'delivered' });
      const id = await mkOrder('out_for_delivery');
      expect(await call({ orderId: id, status: 'delivered', deliveryDate: daysAgo(5) })).toMatchObject({ status: 'ok' });
      expect(await statusOf(id)).toBe('delivered');
      await quiet();
      expect(await executions(wf.id)).toHaveLength(0);
    });

    it('runWorkflows: true overrides the skip', async () => {
      const wf = await mkWorkflow('on delivered', 'status_change', { status: 'delivered' });
      const id = await mkOrder('out_for_delivery');
      expect(await call({ orderId: id, status: 'delivered', deliveryDate: daysAgo(5), runWorkflows: true })).toMatchObject({ status: 'ok' });
      await waitFor(async () => (await live(wf.id)).length === 1, 'execution');
    });
  });

  describe('from import (bulkImportOrders)', () => {
    let phoneSeq = 0;
    const row = (status?: string) => ({
      customerPhone: `+23324${String(SUFFIX).slice(-5)}${String(phoneSeq++).padStart(2, '0')}0`,
      customerFirstName: 'Imp', customerLastName: 'Ort', subtotal: 40, totalAmount: 40,
      deliveryAddress: `${phoneSeq} Import Rd`, deliveryState: 'Greater Accra', deliveryArea: 'Accra', status,
    }) as any;
    const importOrders = (orders: any[], options: { runWorkflows?: boolean } = {}) =>
      runInTenant(tenantId, () => orderService.bulkImportOrders(orders, admin.id, undefined, undefined, true, options));

    it('a pending_confirmation order fires order_created', async () => {
      const wf = await mkWorkflow('on created', 'order_created', {});
      expect((await importOrders([row()])).success).toBe(1);
      await waitFor(async () => (await live(wf.id)).length === 1, 'execution');
    });

    it('an order imported with another status fires nothing', async () => {
      const wf = await mkWorkflow('on created', 'order_created', {});
      expect((await importOrders([row('delivered')])).success).toBe(1);
      await quiet();
      expect(await executions(wf.id)).toHaveLength(0);
    });

    it('runWorkflows: true overrides the skip', async () => {
      const wf = await mkWorkflow('on created', 'order_created', {});
      expect((await importOrders([row('delivered')], { runWorkflows: true })).success).toBe(1);
      await waitFor(async () => (await live(wf.id)).length === 1, 'execution');
    });
  });

  describe('from the spreadsheet upload (POST /api/orders/upload)', () => {
    let seq = 0;
    const upload = (runWorkflows?: string) => {
      const phone = `+23325${String(SUFFIX).slice(-5)}${String(seq++).padStart(2, '0')}1`;
      const csv = `Phone,Customer Name,Address,Region,Product,Quantity,Price,Status\n${phone},Up Load,${seq} Upload Road Accra,Ashanti,WTS Product,1,40,pending_confirmation\n`;
      const req = request(app).post('/api/orders/upload').set(auth()).attach('file', Buffer.from(csv), 'orders.csv');
      return runWorkflows === undefined ? req : req.field('runWorkflows', runWorkflows);
    };

    it('fires no workflow when the flag is missing or not "true"', async () => {
      const wf = await mkWorkflow('on created', 'order_created', {});
      for (const flag of [undefined, 'false', '1']) {
        const res = await upload(flag);
        expect(res.status).toBe(200);
        expect(res.body.results.success).toBe(1);
      }
      await quiet();
      expect(await executions(wf.id)).toHaveLength(0);
    });

    it('fires the workflow when runWorkflows is "true"', async () => {
      const wf = await mkWorkflow('on created', 'order_created', {});
      const res = await upload('true');
      expect(res.status).toBe(200);
      expect(res.body.results.success).toBe(1);
      await waitFor(async () => (await live(wf.id)).length === 1, 'execution');
    });

    it('a service import with runWorkflows: false skips even a pending_confirmation order; unset keeps the old rule', () => {
      const base = { orderId: 1, tenantId, status: 'pending_confirmation' as const, imported: true };
      expect(workflowSkipReason({ ...base, runWorkflows: false })).not.toBeNull();
      expect(workflowSkipReason({ ...base })).toBeNull();
      expect(workflowSkipReason({ ...base, runWorkflows: true })).toBeNull();
    });
  });

  describe('loop guard', () => {
    it('stops a chain of workflow-caused moves at depth 3 and records "Skipped: loop guard"', async () => {
      const a = await mkWorkflow('A', 'status_change', { status: 'confirmed' }, [setStatus('preparing')]);
      const b = await mkWorkflow('B', 'status_change', { status: 'preparing' }, [setStatus('ready_for_pickup')]);
      const c = await mkWorkflow('C', 'status_change', { status: 'ready_for_pickup' }, [setStatus('out_for_delivery')]);
      // D would run on depth 3; it must not
      const d = await mkWorkflow('D', 'status_change', { status: 'out_for_delivery' }, [setStatus('failed_delivery')]);
      const id = await mkOrder('pending_confirmation');

      expect((await patchStatus(id, { status: 'confirmed' })).status).toBe(200);
      const skipped = await waitFor(async () => (await executions(d.id)).find((e) => e.status === 'skipped'), 'loop guard skip');
      await quiet();

      expect(skipped.error).toBe(LOOP_GUARD_MESSAGE);
      expect((await live(a.id)).length + (await live(b.id)).length + (await live(c.id)).length).toBe(3);
      expect(await live(d.id)).toHaveLength(0);
      expect(await statusOf(id)).toBe('out_for_delivery');
      expect(await prismaBase.orderHistory.count({ where: { orderId: id, status: 'failed_delivery' } })).toBe(0);
    });

    it('runs a workflow at most once per order per minute', async () => {
      const wf = await mkWorkflow('on preparing', 'status_change', { status: 'preparing' });
      const id = await mkOrder('confirmed');

      await patchStatus(id, { status: 'preparing' });
      await waitFor(async () => (await live(wf.id)).length === 1, 'first run');
      await patchStatus(id, { status: 'confirmed' });
      await patchStatus(id, { status: 'preparing' });
      const skipped = await waitFor(async () => (await executions(wf.id)).find((e) => e.status === 'skipped'), 'minute skip');

      expect(skipped.error).toBe(LOOP_GUARD_MESSAGE);
      expect(await live(wf.id)).toHaveLength(1);
    });
  });

  describe('a trigger error never fails the status change', () => {
    it('a workflow service that rejects leaves the committed status in place', async () => {
      const spy = jest.spyOn(workflowService, 'triggerStatusChangeWorkflows').mockRejectedValue(new Error('boom') as never);
      const id = await mkOrder('pending_confirmation');
      expect((await patchStatus(id, { status: 'confirmed' })).status).toBe(200);
      await waitFor(async () => spy.mock.calls.length > 0, 'trigger call');
      expect(await statusOf(id)).toBe('confirmed');
      expect(await prismaBase.orderHistory.count({ where: { orderId: id, status: 'confirmed' } })).toBe(1);
    });

    it('a workflow that throws mid-run leaves the status it moved to', async () => {
      const wf = await mkWorkflow('bad', 'status_change', { status: 'confirmed' }, [{ type: 'no_such_action' }]);
      const id = await mkOrder('pending_confirmation');
      expect((await patchStatus(id, { status: 'confirmed' })).status).toBe(200);
      await waitFor(async () => (await executions(wf.id)).find((e) => e.status === 'failed'), 'failed execution');
      expect(await statusOf(id)).toBe('confirmed');
    });

    it('a listener that throws is caught: the move still commits', async () => {
      const boom = () => { throw new Error('listener down'); };
      appEvents.on(AppEvent.ORDER_STATUS_CHANGED, boom);
      try {
        const id = await mkOrder('pending_confirmation');
        expect((await patchStatus(id, { status: 'confirmed' })).status).toBe(200);
        await quiet();
        expect(await statusOf(id)).toBe('confirmed');
      } finally {
        appEvents.off(AppEvent.ORDER_STATUS_CHANGED, boom);
      }
    });
  });
});
