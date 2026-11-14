/**
 * M9-T21 (COD-81): a wait is a Bull delayed job in Redis, so a restart keeps it.
 * Real Postgres (ecommerce_cod_test_*) and the real Redis. The queue has its own name (`wf-test-<time>`), so no other
 * run or lane shares its keys. "Restart" is: close the queue (the worker goes away), build a new one with the same name.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import Bull from 'bull';
import { prismaBase } from '../../utils/prisma';
import {
  createWorkflowQueue, registerWorkflowProcessors, resumeJobId, EXECUTE_JOB,
} from '../../queues/workflowQueue';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.setTimeout(60_000);

const NAME = `wf-test-${Date.now()}`;
const queues: Bull.Queue[] = [];
let tenantId: string;
let customerId: number;
let workflowId: number;

const open = () => {
  const q = createWorkflowQueue(NAME);
  q.on('error', () => undefined);
  registerWorkflowProcessors(q);
  queues.push(q);
  return q;
};
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
const execution = (id: number) => prismaBase.workflowExecution.findUniqueOrThrow({ where: { id } });
const tags = async () => (await prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } })).tags;
// add_tag is the probe: it writes one visible, countable thing per run of the step
const tag = (name: string) => ({ type: 'add_tag', config: { customerId, tag: name } });

beforeAll(async () => {
  tenantId = (await createTenant('WF Restart')).id;
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Restart', phoneNumber: `+2332${String(Date.now()).slice(-8)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  workflowId = (await prismaBase.workflow.create({
    data: { name: `restart ${NAME}`, triggerType: 'manual', triggerData: {}, actions: [], isActive: true, tenantId },
  })).id;
});

afterAll(async () => {
  for (const q of queues) {
    try { await q.close(); } catch { /* already closed */ }
  }
  const cleaner = createWorkflowQueue(NAME);
  cleaner.on('error', () => undefined);
  try { await cleaner.obliterate({ force: true }); } catch { /* nothing to remove */ }
  await cleaner.close();
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('wait survives a restart', () => {
  it('a 2 s wait: the run is saved and waiting, the queue is closed and rebuilt, the run finishes once', async () => {
    const actions = [tag('before'), { type: 'wait', config: { duration: 2 } }, tag('after')];
    const exec = await prismaBase.workflowExecution.create({ data: { tenantId, workflowId, status: 'pending', input: {} } });

    const first = open();
    await first.add(EXECUTE_JOB, { executionId: exec.id, workflowId, actions, conditions: null, input: {}, tenantId });

    // The worker runs step 1 and the wait, then is free: the run is waiting and one delayed job is in Redis.
    await waitFor(async () => (await execution(exec.id)).status === 'waiting', 'the run to wait');
    const waiting = await execution(exec.id);
    expect((waiting.output as any).steps.map((s: any) => s.action)).toEqual(['add_tag', 'wait']);
    expect(new Date((waiting.output as any).resumeAt).getTime()).toBeGreaterThan(Date.now() - 500);
    expect(await tags()).toEqual(['before']);
    const delayed = await first.getDelayed();
    expect(delayed.map((j) => j.id)).toEqual([resumeJobId(exec.id, 2)]);
    expect(await first.getActiveCount()).toBe(0); // no worker is held by the wait

    // Restart: the first queue (and its worker) goes away; the delayed job stays in Redis.
    await first.close();
    expect(await execution(exec.id)).toMatchObject({ status: 'waiting' });
    const second = open();
    expect((await second.getDelayed()).map((j) => j.id)).toEqual([resumeJobId(exec.id, 2)]);

    await waitFor(async () => (await execution(exec.id)).status === 'completed', 'the run to finish');
    const done = await execution(exec.id);
    expect((done.output as any).steps.map((s: any) => s.action)).toEqual(['add_tag', 'wait', 'add_tag']);
    expect(await tags()).toEqual(['before', 'after']); // each step ran once
    await sleep(500);
    expect(await tags()).toEqual(['before', 'after']);
  });

  it('adding the same resume twice makes one job (the deterministic id)', async () => {
    const q = open();
    const data = { executionId: 999_001, workflowId, actions: [], conditions: null, input: {}, tenantId, nextIndex: 1 };
    const opts = { delay: 60_000, jobId: resumeJobId(999_001, 1) };
    await q.add('resume-workflow', data, opts);
    await q.add('resume-workflow', data, opts);
    const delayed = (await q.getDelayed()).filter((j) => j.id === opts.jobId);
    expect(delayed).toHaveLength(1);
    await delayed[0].remove();
  });
});
