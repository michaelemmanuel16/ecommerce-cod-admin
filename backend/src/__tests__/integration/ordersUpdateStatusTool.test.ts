/**
 * The write tool `orders_update_status` on the registry. MCP channel only: a call from chat or the app is
 * refused as "not available" and changes nothing. A call from MCP stores the status before and after in the audit row.
 * (mcpOrdersUpdateStatus.test.ts keeps the behaviour tests: backdated deliveryDate, idempotency, tenant scope.)
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { z } from 'zod';
import { defineTool, getTool, listTools, runTool, ToolContext } from '../../tools/registry';
import '../../tools';
import { toolActorContext, toolAuditRows } from './helpers/callTool';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let orderId: number;

const ctx = (channel: ToolContext['channel']) => toolActorContext(pair.a.id, channel);

const auditRows = () => toolAuditRows(pair.a.id, 'orders_update_status');

beforeAll(async () => {
  pair = await createTwoTenants('updstatus');
  orderId = pair.a.ids.order;
  await prismaBase.order.update({ where: { id: orderId }, data: { status: 'confirmed' } });
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('orders_update_status on the registry', () => {
  it('is a write tool offered to the MCP channel only', () => {
    const def = getTool('orders_update_status')!;
    expect(def.kind).toBe('write');
    expect(def.allowedChannels).toEqual(['mcp']);
    expect(listTools().filter((t) => !t.allowedChannels).every((t) => t.kind === 'read')).toBe(true);
    expect(listTools()).toHaveLength(15);
  });

  it.each(['chat', 'app'] as const)('a call from channel %s returns "not available" and changes nothing', async (channel) => {
    const res = await runTool('orders_update_status', { orderId, status: 'preparing' }, await ctx(channel));
    expect(res.status).toBe('denied');
    expect((res as any).error).toMatch(/not available/i);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('confirmed');
    const rows = await auditRows();
    const last = rows[rows.length - 1];
    expect(last).toMatchObject({ channel });
    expect(last.metadata).toMatchObject({ status: 'denied' });
  });

  it('the channel is checked before the input: a bad input from chat is denied, not invalid', async () => {
    const res = await runTool('orders_update_status', { orderId: 'x' }, await ctx('chat'));
    expect(res.status).toBe('denied');
    expect((await auditRows()).at(-1)!.metadata).toMatchObject({ status: 'denied' });
  });

  it('a write tool is MCP-only by default (defineTool)', () => {
    const tool = defineTool({ name: 'orders_update_status', description: 'x', kind: 'write', input: z.object({}), handler: () => ({}) });
    expect(tool.allowedChannels).toEqual(['mcp']);
    expect(defineTool({ name: 'orders_search', description: 'x', input: z.object({}), handler: () => ({}) }).allowedChannels).toBeUndefined();
  });

  it('a call from MCP moves the order and the audit row holds the status before and after', async () => {
    const res = await runTool('orders_update_status', { orderId, status: 'preparing', notes: 'packed' }, await ctx('mcp'));
    expect(res).toMatchObject({ status: 'ok', data: { updated: true, previousStatus: 'confirmed', newStatus: 'preparing' } });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('preparing');
    // the 14th output of the key scan in toolOutputs.test.ts (the 13 read tools are there)
    expect(JSON.stringify((res as any).data)).not.toMatch(/"(fulfilmentRate|fulfillmentRate|deliveryRate)"/);

    const rows = await auditRows();
    const row = rows[rows.length - 1];
    expect(row).toMatchObject({ channel: 'mcp', actorKind: 'ai_agent' });
    expect(row.before).toEqual({ status: 'confirmed' });
    expect(row.after).toEqual({ status: 'preparing' });
    expect(row.metadata).toMatchObject({ status: 'ok', kind: 'write', targetId: String(orderId) });
    // the order service wrote the history row through transitionOrder with the integration actor
    const history = await prismaBase.orderHistory.findMany({ where: { orderId, status: 'preparing' } });
    expect(history).toHaveLength(1);
  });

  it('an unchanged status makes no change and still records before and after', async () => {
    const res = await runTool('orders_update_status', { orderId, status: 'preparing' }, await ctx('mcp'));
    expect(res).toMatchObject({ status: 'ok', data: { updated: false } });
    expect(await prismaBase.orderHistory.count({ where: { orderId, status: 'preparing' } })).toBe(1);
    const row = (await auditRows()).at(-1)!;
    expect(row.before).toEqual({ status: 'preparing' });
    expect(row.after).toEqual({ status: 'preparing' });
  });

  it('an order of another tenant is not found (error row, nothing changed)', async () => {
    const res = await runTool('orders_update_status', { orderId: pair.b.ids.order, status: 'cancelled' }, await ctx('mcp'));
    expect(res).toMatchObject({ status: 'error', error: expect.stringMatching(/not found/i) });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: pair.b.ids.order } })).status).not.toBe('cancelled');
  });
});
