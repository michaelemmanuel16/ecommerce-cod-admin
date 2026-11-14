/**
 * M9-T21 (COD-81): a workflow queue that is down never fails or holds an order write.
 * Real DB and real app. The queue's `add` is replaced by one that fails, one that hangs, and a real Bull queue
 * whose Redis does not answer. The order is saved and answered at once; the run stays `pending` and is retried in the background.
 */
import { jest, describe, it, expect, beforeAll, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import Bull from 'bull';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { workflowQueue, createWorkflowQueue } from '../../queues/workflowQueue';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';

jest.setTimeout(120_000);

const PREFIX = `T21down ${Date.now()}`;
let pair: TwoTenants;
let tenantId: string;
let seq = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const placeOrder = () =>
  request(app).post('/api/orders').set({ Authorization: `Bearer ${pair.a.users.admin.token}` }).send({
    customerPhone: `+23324${String(Date.now()).slice(-6)}${seq++ % 10}`, customerName: 'Queue Down',
    orderItems: [{ productId: pair.a.ids.product, quantity: 1, unitPrice: 50 }],
    subtotal: 50, totalAmount: 50, deliveryAddress: '7 Down Rd', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
  });

const mkWorkflow = () =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType: 'order_created', triggerData: {}, actions: [{ type: 'wait', config: { duration: 0 } }], isActive: true, tenantId },
  });
const executions = (workflowId: number) => prismaBase.workflowExecution.findMany({ where: { workflowId } });
async function waitFor<T>(fn: () => Promise<T>, what: string, timeout = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value as NonNullable<T>;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

beforeAll(async () => {
  pair = await createTwoTenants('t21down');
  tenantId = pair.a.id;
  await stockUp(tenantId, pair.a.ids.product, 100);
}, 60_000);

afterEach(async () => {
  jest.restoreAllMocks();
  await prismaBase.workflow.deleteMany({ where: { tenantId, name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('order creation with the workflow queue down', () => {
  it('an add that fails: the order is saved, answered fast, and the run waits for the retry', async () => {
    const wf = await mkWorkflow();
    const add = jest.spyOn(workflowQueue, 'add').mockRejectedValue(new Error('ECONNREFUSED') as never);

    const started = Date.now();
    const res = await placeOrder();
    const took = Date.now() - started;

    expect(res.status).toBe(201);
    expect(took).toBeLessThan(2500);
    expect(await prismaBase.order.findUnique({ where: { id: res.body.order.id } })).not.toBeNull();
    const rows = await waitFor(async () => { const r = await executions(wf.id); return r.length ? r : null; }, 'the execution row');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending'); // retried in the background, not failed and not lost
    await waitFor(async () => add.mock.calls.length >= 1, 'the add');
  });

  it('an add that never answers (Redis hangs): the order is answered at once, not after 5 s', async () => {
    const wf = await mkWorkflow();
    jest.spyOn(workflowQueue, 'add').mockImplementation((() => new Promise(() => { /* hangs */ })) as never);

    const started = Date.now();
    const res = await placeOrder();
    const took = Date.now() - started;

    expect(res.status).toBe(201);
    expect(took).toBeLessThan(2500);
    await waitFor(async () => (await executions(wf.id)).length === 1, 'the execution row');
  });

  it('a real Bull queue whose Redis does not answer', async () => {
    const wf = await mkWorkflow();
    // Nothing listens on this port
    const dead: Bull.Queue = createWorkflowQueue(`wf-dead-${Date.now()}`, { host: '127.0.0.1', port: 1, password: undefined });
    dead.on('error', () => { /* connection refused, expected */ });
    jest.spyOn(workflowQueue, 'add').mockImplementation(((...args: unknown[]) => (dead.add as any)(...args)) as never);
    try {
      const started = Date.now();
      const res = await placeOrder();
      const took = Date.now() - started;

      expect(res.status).toBe(201);
      expect(took).toBeLessThan(2500);
      await waitFor(async () => (await executions(wf.id)).length === 1, 'the execution row');
    } finally {
      jest.restoreAllMocks();
      void dead.close(true).catch(() => undefined);
    }
  });
});
