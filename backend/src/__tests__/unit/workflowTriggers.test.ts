import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('../../queues/workflowQueue', () => ({ workflowQueue: { add: jest.fn() }, SCHEDULE_JOB: 'run-scheduled-workflow' }));
jest.mock('../../queues/workflowEnqueue', () => ({ enqueueWorkflowRun: jest.fn().mockResolvedValue(true) }));
const mockSync = jest.fn<(...a: any[]) => Promise<void>>().mockResolvedValue(undefined);
jest.mock('../../queues/workflowSchedule', () => ({
  syncWorkflowSchedule: (...a: any[]) => (mockSync as any)(...a),
  validateSchedule: jest.requireActual<any>('../../queues/workflowSchedule').validateSchedule,
}));

import workflowService, {
  WorkflowService, hashWebhookToken, newWebhookToken, publicWorkflow, hasConditionRules, normalizeTriggerType,
} from '../../services/workflowService';

/** M9-T22: save checks for schedule workflows, the webhook token (hash only), schedule sync on every change. */

const NOOP = [{ type: 'wait', config: { duration: 0 } }];
const sched = { cron: '0 9 * * *', timeZone: 'Africa/Accra' };
let service: WorkflowService;
beforeEach(() => {
  service = new WorkflowService();
  mockSync.mockClear();
  (prismaMock.systemConfig.findFirst as any).mockResolvedValue({ timeZone: 'Africa/Lagos' });
});

describe('schedule workflows at save', () => {
  it('accepts the word "schedule" and stores time_based', () => {
    expect(normalizeTriggerType('schedule')).toBe('time_based');
    expect(normalizeTriggerType('order_created')).toBe('order_created');
  });

  it('refuses a condition rule (a schedule run has no order) with 400', async () => {
    const conditions = { id: 'c', logic: 'AND', rules: [{ field: 'region', operator: 'is', value: 'Ashanti' }] };
    await expect(service.createWorkflow({ name: 'x', triggerType: 'schedule' as any, triggerData: sched, actions: NOOP, conditions }))
      .rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('no order') });
    expect(prismaMock.workflow.create).not.toHaveBeenCalled();
  });

  it('accepts empty conditions, defaults the zone to the store zone and keeps the cron', async () => {
    (prismaMock.workflow.create as any).mockImplementation(async ({ data }: any) => ({ id: 1, tenantId: 't', isActive: true, ...data }));
    const out: any = await service.createWorkflow({ name: 'x', triggerType: 'schedule' as any, triggerData: { cron: '0 9 * * *' }, actions: NOOP, conditions: { id: 'c', logic: 'AND', rules: [] } });
    expect(prismaMock.workflow.create).toHaveBeenCalledWith({ data: expect.objectContaining({ triggerType: 'time_based', triggerData: { cron: '0 9 * * *', timeZone: 'Africa/Lagos' } }) });
    expect(out.triggerType).toBe('time_based');
  });

  it('refuses a bad cron with 400', async () => {
    await expect(service.createWorkflow({ name: 'x', triggerType: 'schedule' as any, triggerData: { cron: 'nope' }, actions: NOOP }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('editing an existing schedule workflow to add a rule is refused', async () => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue({ id: 1, triggerType: 'time_based', triggerData: sched, conditions: {}, isActive: true });
    await expect(service.updateWorkflow(1, { conditions: { id: 'c', logic: 'AND', rules: [{ field: 'status', operator: 'equals', value: 'x' }] } } as any))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('hasConditionRules reads groups, nested groups and the old key-value shape', () => {
    expect(hasConditionRules(null)).toBe(false);
    expect(hasConditionRules({})).toBe(false);
    expect(hasConditionRules({ id: 'a', logic: 'AND', rules: [] })).toBe(false);
    expect(hasConditionRules({ logic: 'AND', rules: [{ logic: 'OR', rules: [] }] })).toBe(false);
    expect(hasConditionRules({ logic: 'AND', rules: [{ logic: 'OR', rules: [{ field: 'a', operator: 'equals', value: 1 }] }] })).toBe(true);
    expect(hasConditionRules({ status: 'confirmed' })).toBe(true);
  });
});

describe('cron sync on every change', () => {
  const row = (over: any = {}) => ({ id: 1, tenantId: 't', isActive: true, triggerType: 'time_based', triggerData: sched, conditions: {}, actions: NOOP, name: 'x', ...over });

  it('create syncs the new workflow', async () => {
    (prismaMock.workflow.create as any).mockResolvedValue(row());
    await service.createWorkflow({ name: 'x', triggerType: 'schedule' as any, triggerData: sched, actions: NOOP });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1, triggerType: 'time_based' }));
  });

  it('edit syncs the saved workflow, and only whitelisted fields are written', async () => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue(row());
    (prismaMock.workflow.update as any).mockResolvedValue(row({ triggerData: { cron: '0 10 * * *', timeZone: 'Africa/Accra' } }));
    await service.updateWorkflow(1, { triggerData: { cron: '0 10 * * *', timeZone: 'Africa/Accra' }, webhookTokenHash: 'evil', tenantId: 'other', id: 99 } as any);
    const data = (prismaMock.workflow.update as any).mock.calls[0][0].data;
    expect(data).toEqual({ triggerData: { cron: '0 10 * * *', timeZone: 'Africa/Accra' } });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('switching on or off syncs (isActive is an editable field)', async () => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue(row());
    (prismaMock.workflow.update as any).mockResolvedValue(row({ isActive: false }));
    await service.updateWorkflow(1, { isActive: false } as any);
    expect((prismaMock.workflow.update as any).mock.calls[0][0].data).toEqual({ isActive: false });
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    await service.toggleWorkflowStatus(1, false);
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('delete syncs with the workflow switched off, so its repeat job goes', async () => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue(row());
    (prismaMock.workflow.delete as any).mockResolvedValue(row());
    await service.deleteWorkflow(1);
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: 1, isActive: false }));
  });
});

describe('webhook token', () => {
  it('is 32 random bytes in base64url and different every time', () => {
    const a = newWebhookToken();
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newWebhookToken()).not.toBe(a);
  });

  it('create returns the raw token once and stores only its sha256 hex', async () => {
    (prismaMock.workflow.create as any).mockImplementation(async ({ data }: any) => ({ id: 1, isActive: true, ...data }));
    const out: any = await service.createWorkflow({ name: 'hook', triggerType: 'webhook', triggerData: {}, actions: NOOP });
    const stored = (prismaMock.workflow.create as any).mock.calls[0][0].data;
    expect(out.webhookToken).toEqual(expect.any(String));
    expect(stored.webhookTokenHash).toBe(hashWebhookToken(out.webhookToken));
    expect(stored.webhookTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(out.webhookToken); // the raw token is not written anywhere
    expect(out.webhookTokenHash).toBeUndefined();
    expect(out.hasWebhookToken).toBe(true);
  });

  it('list and get never return the token or its hash', async () => {
    const row = { id: 1, triggerType: 'webhook', webhookTokenHash: 'abc', name: 'x' };
    (prismaMock.workflow.findMany as any).mockResolvedValue([row]);
    (prismaMock.workflow.findUnique as any).mockResolvedValue(row);
    const list: any = await service.getAllWorkflows({});
    const one: any = await service.getWorkflowById(1);
    for (const w of [list[0], one]) {
      expect(JSON.stringify(w)).not.toContain('abc');
      expect(w).not.toHaveProperty('webhookTokenHash');
      expect(w).not.toHaveProperty('webhookToken');
      expect(w.hasWebhookToken).toBe(true);
    }
    expect(publicWorkflow({ id: 2, triggerType: 'order_created', webhookTokenHash: null })).toEqual({ id: 2, triggerType: 'order_created' });
  });

  it('regenerate replaces the hash, returns the new token once, and refuses a non-webhook workflow', async () => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue({ id: 1, triggerType: 'webhook', webhookTokenHash: 'old' });
    (prismaMock.workflow.update as any).mockResolvedValue({});
    const { webhookToken } = await service.regenerateWebhookToken(1);
    expect((prismaMock.workflow.update as any).mock.calls[0][0].data).toEqual({ webhookTokenHash: hashWebhookToken(webhookToken) });
    (prismaMock.workflow.findUnique as any).mockResolvedValue({ id: 2, triggerType: 'order_created' });
    await expect(service.regenerateWebhookToken(2)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('webhook lookup is by hash: an unknown token is 404, a workflow that is off is 409', async () => {
    (prismaMock.workflow.findFirst as any).mockResolvedValue(null);
    await expect(workflowService.triggerWebhook('nope', {})).rejects.toMatchObject({ statusCode: 404 });
    expect((prismaMock.workflow.findFirst as any).mock.calls[0][0].where).toEqual({ webhookTokenHash: hashWebhookToken('nope'), triggerType: 'webhook' });
    (prismaMock.workflow.findFirst as any).mockResolvedValue({ id: 1, tenantId: 't', isActive: false, triggerType: 'webhook' });
    await expect(workflowService.triggerWebhook('tok', {})).rejects.toMatchObject({ statusCode: 409 });
  });
});
