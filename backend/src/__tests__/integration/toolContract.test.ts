/**
 * The tool contract, over the real MCP server (in-memory transport), on the numbers fixture.
 *  - all 14 tools answer;
 *  - orders_summary for 1 to 17 October 2026: 1,445 placed, 1,026 confirmed, 376 delivered (NUMBERS.md);
 *  - revenue in the tools equals the dashboard KPI;
 *  - tools/list (names and input schemas) is pinned to REGISTRY_VERSION: a schema change without a version change fails.
 *
 * To change a tool's name, description or input fields: bump REGISTRY_VERSION in src/tools/registry.ts, add the new
 * hash printed by the failing test to PINNED_HASH below, and update the snapshot (`-u`). Old versions stay pinned.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { createHash } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { prismaBase } from '../../utils/prisma';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { createMcpServer } from '../../mcp/createServer';
import { clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { listTools, REGISTRY_VERSION } from '../../tools/registry';
import '../../tools';
import analyticsService from '../../services/analyticsService';
import { runInTenant } from '../../utils/tenantContext';
import { makeMcpKey } from './helpers/mcpKey';

jest.mock('../../mcp/rateLimiter', () => require('./helpers/allowAllRateLimiter').allowAllRateLimiter());

jest.setTimeout(180_000);

/** sha256 of the tools/list names, descriptions and input schemas, per registry version. */
const PINNED_HASH: Record<string, string> = {
  '2026.10.1': '3f922785c1c8a87245e744157208076d7d995e9e2e9205acd8cca3b4e0cf6d36',
  '2026.10.2': '9d9c5d932641596b5dd7ff34af7ce0c36c6f0b0a2428d11d22f7acf965a69713', // orders_update_status: runWorkflows (M2-T17)
};

const FROM = '2026-10-01';
const TO = '2026-10-17';
const textOf = (res: any): string => (res.content as Array<{ text: string }>).map((c) => c.text).join('\n');

let tenantId: string;
let client: Client;

async function call(name: string, args: Record<string, unknown>) {
  const res: any = await client.callTool({ name, arguments: args });
  return { isError: !!res.isError, text: textOf(res), body: res.isError ? null : JSON.parse(textOf(res)) };
}

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const { key } = await makeMcpKey(tenantId, { slug: 'contract', roleName: 'Legacy MCP (14 tools)' });
  const server = createMcpServer(() => key);
  client = new Client({ name: 'tool-contract', version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});

afterAll(async () => {
  await client.close();
  clearAuthCache();
  await prismaBase.mcpApiKey.deleteMany({ where: { tenantId } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId } });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

describe('all 14 tools on the numbers fixture', () => {
  it('every tool answers without an error', async () => {
    const order = await prismaBase.order.findFirstOrThrow({ where: { tenantId, status: 'delivered' }, select: { id: true } });
    const customer = await prismaBase.customer.findFirstOrThrow({ where: { tenantId }, select: { firstName: true } });
    const calls: Record<string, Record<string, unknown>> = {
      orders_search: { limit: 5 },
      orders_summary: { period: 'custom', dateFrom: FROM, dateTo: TO },
      customers_lookup: { name: customer.firstName },
      products_inventory: {},
      deliveries_active: { limit: 5 },
      analytics_daily: { date: TO },
      analytics_weekly: { weekOf: '2026-10-12' },
      analytics_monthly: { month: '2026-10' },
      financial_summary: { period: 'custom', dateFrom: FROM, dateTo: TO },
      agents_status: {},
      agents_performance: { period: 'month' },
      reps_status: {},
      reps_performance: { period: 'month' },
      // already delivered: the idempotent path, so the fixture is left as it is
      orders_update_status: { orderId: order.id, status: 'delivered' },
    };
    expect(Object.keys(calls).sort()).toEqual(listTools().map((t) => t.name).sort());
    for (const [name, args] of Object.entries(calls)) {
      const res = await call(name, args);
      expect({ name, isError: res.isError, text: res.isError ? res.text : '' }).toEqual({ name, isError: false, text: '' });
    }
  });

  it('every tool states its currency or carries no money (money tools return a currency code)', async () => {
    for (const def of listTools().filter((t) => t.money && t.kind === 'read')) {
      const args = def.name === 'orders_summary' ? { period: 'month' } : {};
      const res = await call(def.name, args);
      expect({ name: def.name, currency: res.body.currency }).toEqual({ name: def.name, currency: 'GHS' });
    }
  });
});

describe('orders_summary and revenue on the fixture (1 to 17 October 2026)', () => {
  it('1,445 placed, 1,026 confirmed, 376 delivered', async () => {
    const { body } = await call('orders_summary', { period: 'custom', dateFrom: FROM, dateTo: TO });
    expect(body.totalOrders).toBe(1445);
    expect(body.confirmedCount).toBe(1026);
    expect(body.deliveredCount).toBe(376);
    expect(Math.round(body.confirmationRate)).toBe(71);
  });

  it('revenue in orders_summary, financial_summary and analytics_monthly equals the dashboard KPI', async () => {
    const dashboard = await runInTenant(tenantId, () => analyticsService.getDashboardMetrics({ startDate: FROM, endDate: TO }));
    expect(dashboard.totalRevenue).toBe('92000.00');
    const summary = (await call('orders_summary', { period: 'custom', dateFrom: FROM, dateTo: TO })).body;
    const finance = (await call('financial_summary', { period: 'custom', dateFrom: FROM, dateTo: TO })).body;
    const month = (await call('analytics_monthly', { month: '2026-10' })).body;
    expect(summary.revenue).toBe(dashboard.totalRevenue);
    expect(finance.revenue.delivered).toBe(dashboard.totalRevenue);
    expect(month.revenue).toBe(dashboard.totalRevenue);
    expect(summary.deliveredCount).toBe(dashboard.deliveredOrders);
  });
});

describe('tools/list is pinned to the registry version', () => {
  const listed = async () => {
    const { tools } = await client.listTools();
    return tools
      .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const hashOf = (tools: unknown) => createHash('sha256').update(JSON.stringify(tools)).digest('hex');

  it('lists the 14 tools', async () => {
    expect((await listed()).map((t) => t.name)).toEqual(listTools().map((t) => t.name).sort());
  });

  it('the names, descriptions and input schemas match what was pinned for this REGISTRY_VERSION', async () => {
    const tools = await listed();
    const hash = hashOf(tools);
    // A changed schema with the same version fails here. Bump REGISTRY_VERSION and pin the new hash (shown on failure).
    expect({ version: REGISTRY_VERSION, hash }).toEqual({ version: REGISTRY_VERSION, hash: PINNED_HASH[REGISTRY_VERSION] });
  });

  it('the snapshot of the list for this version (readable diff when it changes)', async () => {
    expect({ version: REGISTRY_VERSION, tools: await listed() }).toMatchSnapshot();
  });
});
