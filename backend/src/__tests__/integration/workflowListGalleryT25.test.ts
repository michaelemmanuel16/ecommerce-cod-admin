/**
 * M9-T25 (COD-81): list stats and summary, gallery connections, save validation, and the assign_agent / add_tag data migration.
 * Real DB (ecommerce_cod_test_c) and app.
 */
import { jest, describe, it, expect, beforeAll, afterEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { clearWhatsAppConfigCache } from '../../services/whatsappService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { migrationStatements } from './helpers/migrationSql';

jest.setTimeout(120_000);

const PREFIX = `T25 ${Date.now()}`;
let pair: TwoTenants;
let tenantId: string;
let seq = 0;

const adminAuth = () => ({ Authorization: `Bearer ${pair.a.users.admin.token}` });
const bAuth = () => ({ Authorization: `Bearer ${pair.b.users.admin.token}` });
const day = 24 * 60 * 60 * 1000;
const mkWorkflow = (actions: any[], extra: Record<string, unknown> = {}) =>
  prismaBase.workflow.create({
    data: { name: `${PREFIX} ${seq++}`, triggerType: 'manual', triggerData: {}, actions, conditions: {}, isActive: true, tenantId, ...extra } as any,
  });
const mkRun = (workflowId: number, status: string, extra: Record<string, unknown> = {}) =>
  prismaBase.workflowExecution.create({ data: { tenantId, workflowId, status, input: {}, steps: [], ...extra } as any });
const body = (extra: Record<string, unknown>) => ({
  name: `${PREFIX} api ${seq++}`, triggerType: 'order_created', triggerData: {}, actions: [{ type: 'wait', config: { duration: 1 } }], conditions: {}, ...extra,
});

beforeAll(async () => {
  pair = await createTwoTenants('t25');
  tenantId = pair.a.id;
}, 60_000);

afterEach(async () => {
  clearWhatsAppConfigCache();
  await prismaBase.systemConfig.updateMany({ where: { tenantId }, data: { whatsappProvider: null as any } }).catch(() => undefined);
  await prismaBase.workflow.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] }, name: { startsWith: PREFIX } } });
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('list stats and summary', () => {
  it('counts the last 30 days (no skipped, no test runs), the last run time and the summary', async () => {
    // the fixture seeds one completed run per tenant: start from none
    await prismaBase.workflowExecution.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
    const wf = await mkWorkflow([{ type: 'wait' }]);
    const off = await mkWorkflow([{ type: 'wait' }], { isActive: false });
    await mkRun(wf.id, 'completed');
    await mkRun(wf.id, 'completed', { startedAt: new Date(Date.now() - 3 * day) });
    await mkRun(wf.id, 'failed');
    await mkRun(wf.id, 'skipped', { error: 'conditions_not_met' });
    await mkRun(wf.id, 'completed', { mode: 'test' });
    await mkRun(wf.id, 'completed', { startedAt: new Date(Date.now() - 40 * day) });

    const res = await request(app).get('/api/workflows').set(adminAuth());
    expect(res.status).toBe(200);
    const row = res.body.workflows.find((w: any) => w.id === wf.id);
    expect(row.stats).toMatchObject({ runs: 3, succeeded: 2, failed: 1, days: 30 });
    expect(row.stats.lastRunAt).toBeTruthy();
    const idle = res.body.workflows.find((w: any) => w.id === off.id);
    expect(idle.stats).toMatchObject({ runs: 0, succeeded: 0, failed: 0, lastRunAt: null });
    // today: the completed and the failed run of "now" (the 3-day-old one is not today)
    expect(res.body.summary).toMatchObject({ runsToday: 2, failuresToday: 1 });
    expect(res.body.summary.activeCount).toBeGreaterThanOrEqual(1);
    // another tenant sees none of it
    const other = await request(app).get('/api/workflows').set(bAuth());
    expect(other.body.workflows.find((w: any) => w.id === wf.id)).toBeUndefined();
    expect(other.body.summary).toMatchObject({ runsToday: 0, failuresToday: 0 });
  });
});

describe('template gallery', () => {
  it('has no Shopify order import card and lists the connections each template needs', async () => {
    const res = await request(app).get('/api/workflows/templates').set(adminAuth());
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.templates).toLowerCase()).not.toContain('shopify');
    for (const t of res.body.templates) {
      expect(Array.isArray(t.needs)).toBe(true);
      expect(typeof t.available).toBe('boolean');
    }
  });

  it('a WhatsApp template is unavailable until the store has a WhatsApp connection', async () => {
    const without = await request(app).get('/api/workflows/templates').set(adminAuth());
    const wa = without.body.templates.find((t: any) => t.id === 'whatsapp-order-confirmation');
    expect(wa).toMatchObject({ needs: ['whatsapp'], available: false, unavailableReason: 'Needs WhatsApp in Connections' });
    expect(without.body.templates.filter((t: any) => !t.needs.includes('whatsapp')).every((t: any) => t.available)).toBe(true);

    await prismaBase.systemConfig.update({
      where: { tenantId },
      data: { whatsappProvider: { isEnabled: true, accessToken: 'tok', phoneNumberId: '123' } as any },
    });
    clearWhatsAppConfigCache();
    const withIt = await request(app).get('/api/workflows/templates').set(adminAuth());
    expect(withIt.body.templates.find((t: any) => t.id === 'whatsapp-order-confirmation')).toMatchObject({ needs: ['whatsapp'], available: true });
    expect(withIt.body.templates.find((t: any) => t.id === 'whatsapp-order-confirmation').unavailableReason).toBeUndefined();
  });

  it('no template uses a removed action', async () => {
    const res = await request(app).get('/api/workflows/templates').set(adminAuth());
    const types = res.body.templates.flatMap((t: any) => t.actions.map((a: any) => a.type));
    expect(types).not.toContain('add_tag');
    expect(types).not.toContain('assign_agent');
  });
});

describe('validation on save', () => {
  const rule = (field: string, operator: string, value?: unknown) => ({ id: 'c', logic: 'AND', rules: [{ field, operator, ...(value !== undefined ? { value } : {}) }] });

  it.each([
    ['an empty condition value', { conditions: rule('region', 'is', '') }, /enter a value/],
    ['a numeric operator on a text field', { conditions: rule('productName', 'gt', '5') }, /is text/],
    ['an unknown field', { conditions: rule('colour', 'equals', 'red') }, /not a field/],
    ['more than 10 actions', { actions: Array.from({ length: 11 }, () => ({ type: 'wait', config: { duration: 1 } })) }, /at most 10 actions/],
    ['assign_agent', { actions: [{ type: 'assign_agent', config: { agentId: 1 } }] }, /no longer available/],
    ['add_tag', { actions: [{ type: 'add_tag', config: { tag: 'x' } }] }, /no longer available/],
  ])('refuses %s with 400 on create and on update', async (_label, patch, message) => {
    const create = await request(app).post('/api/workflows').set(adminAuth()).send(body(patch));
    expect(create.status).toBe(400);
    expect(create.body.error ?? create.body.message).toMatch(message as RegExp);
    expect(create.body.errors).toHaveLength(1);

    const wf = await mkWorkflow([{ type: 'wait', config: { duration: 1 } }]);
    const update = await request(app).put(`/api/workflows/${wf.id}`).set(adminAuth()).send(patch);
    expect(update.status).toBe(400);
  });

  it('lists every problem at once, and saves a valid workflow', async () => {
    const bad = await request(app).post('/api/workflows').set(adminAuth()).send(body({
      conditions: { id: 'c', logic: 'AND', rules: [{ field: 'region', operator: 'is', value: '' }, { field: 'productName', operator: 'lt', value: '2' }] },
    }));
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toHaveLength(2);
    const ok = await request(app).post('/api/workflows').set(adminAuth()).send(body({ conditions: rule('totalAmount', 'gt', 100) }));
    expect(ok.status).toBe(201);
    const ten = await request(app).post('/api/workflows').set(adminAuth()).send(body({ actions: Array.from({ length: 10 }, () => ({ type: 'wait', config: { duration: 1 } })) }));
    expect(ten.status).toBe(201);
  });
});

describe('data migration: assign_agent and add_tag', () => {
  it('rewrites old workflows, keeps the order of the actions and the number of workflows', async () => {
    const old = await mkWorkflow([
      { type: 'send_sms', config: { phoneNumber: '+233', message: 'hi' } },
      { type: 'assign_agent', config: { agentId: 42 } },
      { type: 'add_tag', config: { tag: 'high-value' } },
      { type: 'add_tag', tag: 'flat-shape' },
      { type: 'assign_agent', config: { agentIds: [7, 8] } },
    ]);
    const clean = await mkWorkflow([{ type: 'wait', config: { duration: 5 } }]);
    const before = await prismaBase.workflow.count();

    for (const statement of migrationStatements('20261114210000_m9_workflow_remove_assign_agent_add_tag')) {
      await prismaBase.$executeRawUnsafe(statement);
    }

    expect(await prismaBase.workflow.count()).toBe(before);
    const migrated = await prismaBase.workflow.findUniqueOrThrow({ where: { id: old.id } });
    expect(migrated.actions).toEqual([
      { type: 'send_sms', config: { phoneNumber: '+233', message: 'hi' } },
      { type: 'assign_to', config: { role: 'delivery_agent', split: 'even', userIds: [42] } },
      { type: 'update_order', config: { notes: 'Tag: high-value' } },
      { type: 'update_order', config: { notes: 'Tag: flat-shape' } },
      { type: 'assign_to', config: { role: 'delivery_agent', split: 'even', userIds: [7, 8] } },
    ]);
    expect((await prismaBase.workflow.findUniqueOrThrow({ where: { id: clean.id } })).actions).toEqual([{ type: 'wait', config: { duration: 5 } }]);
    // the migrated actions pass the save checks
    const save = await request(app).put(`/api/workflows/${old.id}`).set(adminAuth()).send({ actions: migrated.actions });
    // assign_to needs real users: 400 for the fake ids is about users, never about a removed action
    expect(JSON.stringify(save.body)).not.toMatch(/no longer available/);
  });
});
