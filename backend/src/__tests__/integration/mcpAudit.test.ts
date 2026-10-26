/**
 * Over stdio and over POST /mcp,
 *  1. each of the 14 tools writes exactly one AuditLog row: actor id, actorKind, channel mcp, tool name, redacted input,
 *     status and duration;
 *  2. a key whose role (or whose user's base role) does not allow a tool: tools/list does not show it, a call returns
 *     an error, and the audit row has status `denied`.
 * "stdio" runs the real StdioServerTransport on in-process streams (the same createMcpServer that server.ts connects).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { PassThrough, Readable, Writable } from 'stream';
import request from 'supertest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createMcpServer } from '../../mcp/createServer';
import { clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { listTools } from '../../tools/registry';
import '../../tools';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeMcpKey } from './helpers/mcpKey';
import { toolAuditRows } from './helpers/callTool';

// 14 tools x 2 transports and the denied calls would trip the 30 calls a minute bucket. Plain function: resetMocks would wipe a jest.fn.
jest.mock('../../mcp/rateLimiter', () => require('./helpers/allowAllRateLimiter').allowAllRateLimiter());

jest.setTimeout(60_000);

/** A client transport over two streams: what StdioClientTransport does, without a child process. */
class StreamClientTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private buffer = new ReadBuffer();
  constructor(private input: Readable, private output: Writable) {}
  async start() {
    this.input.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let m = this.buffer.readMessage(); m; m = this.buffer.readMessage()) this.onmessage?.(m);
    });
  }
  async send(message: JSONRPCMessage) { this.output.write(serializeMessage(message)); }
  async close() { this.onclose?.(); }
}

interface Caller {
  list(): Promise<string[]>;
  call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }>;
  close(): Promise<void>;
}

async function stdioCaller(key: string): Promise<Caller> {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const server = createMcpServer(() => key);
  await server.connect(new StdioServerTransport(toServer, toClient));
  const client = new Client({ name: 'mcp-audit-stdio', version: '1.0.0' });
  await client.connect(new StreamClientTransport(toClient, toServer));
  return {
    list: async () => (await client.listTools()).tools.map((t) => t.name).sort(),
    call: async (name, args) => {
      const res: any = await client.callTool({ name, arguments: args });
      return { isError: !!res.isError, text: res.content.map((c: { text: string }) => c.text).join('\n') };
    },
    close: async () => { await client.close(); await server.close(); },
  };
}

function httpCaller(key: string): Caller {
  let id = 0;
  const rpc = async (method: string, params: unknown) => {
    const res = await request(app)
      .post('/mcp')
      .set('Authorization', `Bearer ${key}`)
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', id: ++id, method, params });
    expect(res.status).toBe(200);
    return res.body.result;
  };
  return {
    list: async () => (await rpc('tools/list', {})).tools.map((t: { name: string }) => t.name).sort(),
    call: async (name, args) => {
      const result = await rpc('tools/call', { name, arguments: args });
      return { isError: !!result.isError, text: result.content.map((c: { text: string }) => c.text).join('\n') };
    },
    close: async () => {},
  };
}

const TRANSPORTS: Array<['stdio' | 'POST /mcp', (key: string) => Promise<Caller>]> = [
  ['stdio', stdioCaller],
  ['POST /mcp', async (key) => httpCaller(key)],
];

let pair: TwoTenants;

/** A user, optionally a role, and a key for tenant A. */
async function makeKey(label: string, userRole: 'admin' | 'sales_rep' | 'super_admin', roleName: string | null) {
  const { key, userId, roleId } = await makeMcpKey(pair.a.id, { slug: `${label}-${pair.a.slug}`, userRole, roleName });
  return { key, user: { id: userId as number }, roleId };
}

const toolRows = (tool: string) => toolAuditRows(pair.a.id, tool);

/** Valid input per tool, aimed at tenant A's own rows. */
/** The tools the Legacy MCP role holds: the registry without the tools added after the 14. */
const legacyToolNames = () => listTools().map((t) => t.name).filter((n) => n !== 'partner_payout_record').sort();

const argsFor = (): Record<string, Record<string, unknown>> => ({
  orders_search: { limit: 5 },
  orders_summary: { period: 'month' },
  orders_update_status: { orderId: pair.a.ids.order, status: 'preparing' },
  customers_lookup: { name: 'Cust' },
  products_inventory: {},
  deliveries_active: {},
  agents_status: {},
  agents_performance: { period: 'month' },
  reps_status: {},
  reps_performance: { period: 'month' },
  analytics_daily: {},
  analytics_weekly: {},
  analytics_monthly: {},
  financial_summary: { period: 'month' },
});

beforeAll(async () => {
  pair = await createTwoTenants('mcpaudit');
  // orders_update_status moves confirmed -> preparing: touches neither stock nor the ledger
  await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { status: 'confirmed' } });
}, 60_000);

afterAll(async () => {
  clearAuthCache();
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

describe.each(TRANSPORTS)('tools/list with a revoked key over %s', (transport, connect) => {
  it('gives a clean error, not a raw rejection or a tool list', async () => {
    const { key } = await makeMcpKey(pair.a.id, { slug: `revoked-list-${transport === 'stdio' ? 's' : 'h'}`, roleName: 'Legacy MCP (14 tools)', revokedAt: new Date() });
    clearAuthCache();
    if (transport === 'stdio') {
      const caller = await connect(key);
      try {
        await expect(caller.list()).rejects.toThrow('API key has been revoked');
      } finally {
        await caller.close();
      }
    } else {
      const res = await request(app).post('/mcp').set('Authorization', `Bearer ${key}`).set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      // The HTTP route refuses a bad key before it builds a server, so the list handler is not reached.
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'API key has been revoked' });
    }
  });
});

describe.each(TRANSPORTS)('Done when 1: one audit row per call over %s', (transport, connect) => {
  it('each of the 14 tools writes exactly one row with actor, kind, channel mcp, tool, input, status, duration', async () => {
    const caller = await connect(pair.a.mcpKey);
    try {
      expect(await caller.list()).toEqual(legacyToolNames());
      const calls = argsFor();
      expect(Object.keys(calls).sort()).toEqual(legacyToolNames());

      for (const [tool, args] of Object.entries(calls)) {
        const before = (await toolRows(tool)).length;
        const res = await caller.call(tool, args);
        expect({ tool, transport, isError: res.isError, text: res.isError ? res.text : '' }).toEqual({ tool, transport, isError: false, text: '' });

        const rows = await toolRows(tool);
        expect({ tool, added: rows.length - before }).toEqual({ tool, added: 1 });
        const row = rows[rows.length - 1];
        expect(row).toMatchObject({ userId: pair.a.ids.mcpUser, actorKind: 'ai_agent', channel: 'mcp', action: 'tool_call', roleId: pair.a.ids.legacyRole });
        expect(row.metadata).toMatchObject({ tool, status: 'ok', input: args });
        expect(typeof (row.metadata as { durationMs: unknown }).durationMs).toBe('number');
      }
    } finally {
      await caller.close();
    }
  });

  it('a secret in the input is redacted in the stored row', async () => {
    const caller = await connect(pair.a.mcpKey);
    try {
      const secret = 'Bearer abcdefghijklmnop1234567890';
      const before = (await toolRows('orders_search')).length;
      await caller.call('orders_search', { search: secret });
      const rows = await toolRows('orders_search');
      expect(rows.length - before).toBe(1);
      expect(JSON.stringify(rows[rows.length - 1])).not.toContain('abcdefghijklmnop');
    } finally {
      await caller.close();
    }
  });

  it('an invalid input is refused and writes one row with status invalid', async () => {
    const caller = await connect(pair.a.mcpKey);
    try {
      const before = (await toolRows('orders_summary')).length;
      const res = await caller.call('orders_summary', { period: 'decade' });
      expect(res.isError).toBe(true);
      const rows = await toolRows('orders_summary');
      expect(rows.length - before).toBe(1);
      expect(rows[rows.length - 1].metadata).toMatchObject({ status: 'invalid' });
    } finally {
      await caller.close();
    }
  });
});

describe.each(TRANSPORTS)('Done when 2: a key that may not use a tool, over %s', (transport, connect) => {
  const CALL_REP_TOOLS = ['customers_lookup', 'orders_search', 'orders_summary', 'reps_status'];

  it("role: the Call rep key lists only the role's tools, and another tool is denied", async () => {
    const { key, user, roleId } = await makeKey(`rolekey-${transport === 'stdio' ? 's' : 'h'}`, 'admin', 'Call rep');
    const caller = await connect(key);
    try {
      expect(await caller.list()).toEqual([...CALL_REP_TOOLS].sort());

      const before = (await toolRows('financial_summary')).length;
      const res = await caller.call('financial_summary', { period: 'month' });
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/role does not include/i);
      const rows = await toolRows('financial_summary');
      expect(rows.length - before).toBe(1);
      expect(rows[rows.length - 1]).toMatchObject({ userId: user.id, actorKind: 'ai_agent', channel: 'mcp', roleId });
      expect(rows[rows.length - 1].metadata).toMatchObject({ status: 'denied' });
    } finally {
      await caller.close();
    }
  });

  it("base role: an Owner-role key whose user is a sales rep gets only what a sales rep may use", async () => {
    const { key, user } = await makeKey(`basekey-${transport === 'stdio' ? 's' : 'h'}`, 'sales_rep', 'Owner');
    const caller = await connect(key);
    try {
      const names = await caller.list();
      expect(names).not.toContain('financial_summary'); // sales_rep has financial: []
      expect(names).not.toContain('orders_update_status'); // and no orders:update_status
      expect(names).toContain('orders_search');

      const res = await caller.call('orders_update_status', { orderId: pair.a.ids.order, status: 'preparing' });
      expect(res.isError).toBe(true);
      const rows = await toolRows('orders_update_status');
      const mine = rows.filter((r) => r.userId === user.id);
      expect(mine).toHaveLength(1);
      expect(mine[0].metadata).toMatchObject({ status: 'denied' });
    } finally {
      await caller.close();
    }
  });
});
