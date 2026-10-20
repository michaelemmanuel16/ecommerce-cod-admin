/**
 * M0-T29 (COD-7), MCP part: every MCP tool, called through the real server with tenant
 * A's API key, returns no tenant B id, name, phone, email or amount. Each tool is called
 * broad and, where it takes an id, pointed straight at a B id.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { prismaBase } from '../../utils/prisma';
import { createMcpServer } from '../../mcp/createServer';
import { clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { createTwoTenants, TwoTenants, TestTenant } from './helpers/twoTenants';

// 14 tools x several calls would trip the 30 calls per minute bucket. Plain function: resetMocks would wipe a jest.fn.
jest.mock('../../mcp/rateLimiter', () => ({ rateLimiter: { tryConsume: () => true } }));

let pair: TwoTenants;
const clients = new Map<string, Client>();

/** One client per API key, shared by every test in the file. */
async function connect(key: string): Promise<Client> {
  const cached = clients.get(key);
  if (cached) return cached;
  const server = createMcpServer(() => key);
  const client = new Client({ name: 'two-tenant-test', version: '1.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  clients.set(key, client);
  return client;
}

/** Calls to make per tool: one broad, then ones aimed at B's ids. Leaks are scanned by marker, phone, email and amount: ids of different tables can collide. */
const callsFor = (b: TestTenant): Record<string, Array<Record<string, unknown>>> => ({
  orders_search: [{}, { customerId: b.ids.customer }, { agentId: b.users.deliveryAgent.id }, { search: b.phone }, { search: String(b.ids.order) }],
  orders_summary: [{ period: 'month' }, { period: 'today' }],
  orders_update_status: [{ orderId: b.ids.order, status: 'cancelled' }],
  customers_lookup: [{ name: 'Cust' }, { phone: b.phone }, { name: `Cust${b.marker}` }],
  products_inventory: [{}, { productId: b.ids.product }, { lowStockOnly: true }],
  deliveries_active: [{}, { agentId: b.users.deliveryAgent.id }],
  agents_status: [{}],
  agents_performance: [{ period: 'month' }, { agentId: b.users.deliveryAgent.id, period: 'month' }],
  reps_status: [{}],
  reps_performance: [{ period: 'month' }, { repId: b.users.salesRep.id, period: 'month' }],
  analytics_daily: [{}],
  analytics_weekly: [{}],
  analytics_monthly: [{}],
  financial_summary: [{ period: 'month' }, { period: 'today' }],
});

/** Tools that list rows by name: with the right key they must show that tenant's own marker. */
const SHOWS_OWN_MARKER = ['orders_search', 'customers_lookup', 'products_inventory', 'deliveries_active', 'agents_status', 'reps_status'];

const textOf = (res: any): string => (res.content as Array<{ text: string }>).map((c) => c.text).join('\n');

beforeAll(async () => {
  pair = await createTwoTenants('mcp');
}, 30000);

afterAll(async () => {
  await Promise.all([...clients.values()].map((c) => c.close()));
  clearAuthCache();
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

describe('MCP tools never return another tenant data', () => {
  it('the server exposes exactly the 14 known tools and the test has calls for each', async () => {
    const client = await connect(pair.a.mcpKey);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toHaveLength(14);
    expect(names).toEqual(Object.keys(callsFor(pair.b)).sort());
  });

  it("every tool called with A's key leaks no B id, name, phone, email or amount", async () => {
    const { a, b } = pair;
    const client = await connect(a.mcpKey);
    const leakTokens = [b.marker, b.phone, b.slug, b.formSlug, b.users.admin.email, b.users.deliveryAgent.email, b.amount];
    const calls = callsFor(b);
    let made = 0;
    const brokenBroadCalls: string[] = [];

    for (const [tool, argsList] of Object.entries(calls)) {
      for (const [i, args] of argsList.entries()) {
        const res: any = await client.callTool({ name: tool, arguments: args });
        const text = textOf(res);
        made += 1;
        // The first call of each read tool is broad and must succeed: an erroring tool would pass the scan for nothing
        if (i === 0 && tool !== 'orders_update_status' && res.isError) brokenBroadCalls.push(`${tool}: ${text}`);
        for (const token of leakTokens) {
          expect({ tool, args, leaked: text.includes(token) ? token : null }).toEqual({ tool, args, leaked: null });
        }
      }
    }
    expect(brokenBroadCalls).toEqual([]);
    expect(made).toBeGreaterThanOrEqual(14);
  });

  it('the same tools do show the key tenant own rows, so the scan above can fail', async () => {
    for (const [own, other] of [[pair.a, pair.b], [pair.b, pair.a]] as const) {
      const client = await connect(own.mcpKey);
      for (const tool of SHOWS_OWN_MARKER) {
        const res = await client.callTool({ name: tool, arguments: tool === 'customers_lookup' ? { name: 'Cust' } : {} });
        const text = textOf(res);
        expect({ tool, own: text.includes(own.marker) }).toEqual({ tool, own: true });
        expect({ tool, other: text.includes(other.marker) }).toEqual({ tool, other: false });
      }
    }
  });

  it("orders_update_status with A's key cannot touch B's order", async () => {
    const { a, b } = pair;
    const client = await connect(a.mcpKey);
    const res: any = await client.callTool({ name: 'orders_update_status', arguments: { orderId: b.ids.order, status: 'cancelled' } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/not found/i);
    const row = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect(row.status).toBe('out_for_delivery');
  });

  it('a key of tenant B resolves to tenant B, not A, on the same server code', async () => {
    const { a, b } = pair;
    const client = await connect(b.mcpKey);
    const res = await client.callTool({ name: 'orders_search', arguments: { customerId: a.ids.customer } });
    expect(textOf(res)).not.toContain(a.marker);
    const own = await client.callTool({ name: 'orders_search', arguments: {} });
    expect(textOf(own)).toContain(b.marker);
  });
});
