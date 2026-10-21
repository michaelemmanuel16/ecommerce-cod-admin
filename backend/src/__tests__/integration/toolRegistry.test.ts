/**
 * M2-T04: runTool returns the right status for ok, denied, invalid and error, writes one audit
 * row each time, runs the handler in the caller's tenant, and ignores a planted tenantId.
 * Tool defs here are test-only; the 14 real tools move onto the registry in T07-T10.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { z } from 'zod';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { getTenantId } from '../../utils/tenantContext';
import { AppError } from '../../middleware/errorHandler';
import { defineTool, runTool, ToolContext, REGISTRY_VERSION, getTool } from '../../tools/registry';
import { TOOL_PERMISSIONS } from '../../config/toolPermissions';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let emptyRoleId: number;
let ownerRoleId: number;

const ctxOf = (t: TwoTenants['a'], who: 'admin' | 'salesRep', extra: Partial<ToolContext> = {}): ToolContext => ({
  tenantId: t.id, actorId: t.users[who].id, actorKind: 'person', roleId: null, channel: 'mcp', ...extra,
});

const seen: { tenant: string | null; input: unknown }[] = [];
const echo = defineTool({
  name: 'orders_search',
  description: 'test tool',
  input: z.object({ q: z.string().min(1) }),
  handler: (input) => { seen.push({ tenant: getTenantId(), input }); return { found: input.q }; },
});
const finance = defineTool({ name: 'financial_summary', description: 'test', input: z.object({}), handler: () => ({ revenue: '1.00' }) });
const boom = defineTool({
  name: 'orders_summary', description: 'test', input: z.object({}),
  handler: () => { throw new Error('db exploded with Bearer abcdefghijklmnop'); },
});
const friendly = defineTool({
  name: 'customers_lookup', description: 'test', input: z.object({}),
  handler: () => { throw new AppError('Customer not found', 404); },
});
const write = defineTool({
  // admin has no orders:update_status by default; this test is about the audit row, so use a cell admin holds
  name: 'products_inventory', description: 'test', kind: 'write', money: true, input: z.object({ id: z.number() }),
  handler: (input, _ctx, trace) => { trace.before = { status: 'pending' }; trace.after = { status: 'confirmed' }; trace.resourceId = String(input.id); return { ok: true }; },
});

const rowsFor = (tenantId: string, tool: string) =>
  prismaBase.auditLog.findMany({ where: { tenantId, resource: 'tool', resourceId: tool }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  pair = await createTwoTenants('toolreg');
  ownerRoleId = (await prismaBase.role.create({ data: { tenantId: pair.a.id, name: 'Test owner', tools: ['orders_search', 'products_inventory'] } })).id;
  emptyRoleId = (await prismaBase.role.create({ data: { tenantId: pair.a.id, name: 'Test empty', tools: [] } })).id;
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('runTool', () => {
  it('ok: returns data, runs in the caller tenant, writes one audit row', async () => {
    const res = await runTool(echo, { q: 'abc' }, ctxOf(pair.a, 'admin', { roleId: ownerRoleId }));
    expect(res).toMatchObject({ status: 'ok', data: { found: 'abc' } });
    expect(seen.at(-1)!.tenant).toBe(pair.a.id);
    const rows = await rowsFor(pair.a.id, 'orders_search');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: pair.a.users.admin.id, actorKind: 'person', channel: 'mcp', roleId: ownerRoleId, action: 'tool_call' });
    expect(rows[0].metadata).toMatchObject({ tool: 'orders_search', status: 'ok', input: { q: 'abc' }, registryVersion: REGISTRY_VERSION });
    expect(typeof (rows[0].metadata as any).durationMs).toBe('number');
  });

  it('invalid: bad input returns issues and never reaches the handler', async () => {
    const before = seen.length;
    const res = await runTool(echo, { q: '' }, ctxOf(pair.a, 'admin'));
    expect(res.status).toBe('invalid');
    expect((res as any).issues[0].path).toEqual(['q']);
    expect(seen.length).toBe(before);
    const rows = await rowsFor(pair.a.id, 'orders_search');
    expect(rows.map((r) => (r.metadata as any).status)).toContain('invalid');
  });

  it('invalid: an unknown tool name', async () => {
    const res = await runTool('nope' as any, {}, ctxOf(pair.a, 'admin'));
    expect(res.status).toBe('invalid');
  });

  it('denied: the base role lacks the permission cell', async () => {
    // sales_rep has financial: []
    const res = await runTool(finance, {}, ctxOf(pair.a, 'salesRep'));
    expect(res).toMatchObject({ status: 'denied' });
    const rows = await rowsFor(pair.a.id, 'financial_summary');
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ status: 'denied' });
    expect(rows[0].userId).toBe(pair.a.users.salesRep.id);
  });

  it('denied: the role does not list the tool, even though the base role allows it', async () => {
    const res = await runTool(echo, { q: 'abc' }, ctxOf(pair.a, 'admin', { roleId: emptyRoleId }));
    expect(res.status).toBe('denied');
  });

  it('denied: a role id from another tenant allows nothing', async () => {
    const res = await runTool(echo, { q: 'abc' }, ctxOf(pair.b, 'admin', { roleId: ownerRoleId }));
    expect(res.status).toBe('denied');
  });

  it('error: handler throws; the message is hidden for plain errors, shown for AppError, and the audit row is redacted', async () => {
    const res = await runTool(boom, {}, ctxOf(pair.a, 'admin'));
    expect(res.status).toBe('error');
    expect((res as any).error).not.toContain('exploded');
    const rows = await rowsFor(pair.a.id, 'orders_summary');
    expect(rows[0].metadata).toMatchObject({ status: 'error' });
    expect(JSON.stringify(rows[0])).not.toContain('abcdefghijklmnop');
    expect(JSON.stringify(rows[0])).toContain('db exploded');

    const shown = await runTool(friendly, {}, ctxOf(pair.a, 'admin'));
    expect(shown).toMatchObject({ status: 'error', error: 'Customer not found' });
  });

  it('write tool: handler can put before and after in the audit row', async () => {
    const res = await runTool(write, { id: 42 }, ctxOf(pair.a, 'admin', { roleId: ownerRoleId }));
    expect(res.status).toBe('ok');
    const [row] = await rowsFor(pair.a.id, 'products_inventory');
    expect(row.before).toEqual({ status: 'pending' });
    expect(row.after).toEqual({ status: 'confirmed' });
    expect(row.metadata).toMatchObject({ kind: 'write', targetId: '42' });
  });

  it('a planted tenantId in the input is dropped and the row lands in the caller tenant', async () => {
    const bRows = () => prismaBase.auditLog.count({ where: { tenantId: pair.b.id, resource: 'tool' } });
    const bBefore = await bRows();
    const res = await runTool(echo, { q: 'x', tenantId: pair.b.id } as any, ctxOf(pair.a, 'admin'));
    expect(res.status).toBe('ok');
    expect(seen.at(-1)!.input).toEqual({ q: 'x' });
    expect(seen.at(-1)!.tenant).toBe(pair.a.id);
    expect(await bRows()).toBe(bBefore);
  });

  it('defineTool takes the permission cell from TOOL_PERMISSIONS', () => {
    expect(echo.permission).toBe(TOOL_PERMISSIONS.orders_search);
    expect(echo.kind).toBe('read');
    expect(echo.confirm).toBe('none');
    expect(echo.roleScope).toBe('listed');
    expect(write.money).toBe(true);
    expect(getTool('orders_search')).toBeUndefined(); // nothing registered by these tests
  });
});
