/**
 * The MCP schema resources are built from the Prisma DMMF: every listed field exists, the checker catches a wrong one,
 * the order resource lists the 12 real statuses, and each tool named in a resource is in the registry.
 */
import { describe, it, expect } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EXPOSED_MODELS, buildSchemaResource, checkExposedFields, registerResources } from '../../mcp/resources/schema';
import { listTools } from '../../tools/registry';
import '../../tools';

describe('schema resource', () => {
  it('every listed field exists in the Prisma schema', () => {
    expect(checkExposedFields()).toEqual([]);
  });

  it('the checker fails on a planted wrong field, a relation and an unknown model', () => {
    expect(checkExposedFields({ orders: { model: 'Order', fields: ['id', 'totalAmmount'] } })).toEqual(['Order.totalAmmount']);
    expect(checkExposedFields({ orders: { model: 'Order', fields: ['customer'] } })).toEqual(['Order.customer']);
    expect(checkExposedFields({ x: { model: 'NoSuchModel', fields: ['id'] } })).toEqual(['NoSuchModel.id']);
  });

  it('the orders resource lists the 12 real statuses', () => {
    const status = buildSchemaResource('orders').fields.find((f) => f.name === 'status') as { values: string[] };
    expect(status.values).toHaveLength(12);
    expect(status.values).toEqual(expect.arrayContaining(['payment_pending', 'digital_delivered', 'payment_failed']));
  });

  it('names only registered tools', () => {
    const registered = new Set(listTools().map((t) => t.name));
    for (const entry of Object.values(EXPOSED_MODELS)) for (const tool of entry.tools) expect(registered.has(tool)).toBe(true);
  });

  it('serves each resource over MCP', async () => {
    const server = new McpServer({ name: 't', version: '1' });
    registerResources(server);
    const client = new Client({ name: 'c', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(Object.keys(EXPOSED_MODELS).map((k) => `schema://${k}`).sort());
    const read = await client.readResource({ uri: 'schema://orders' });
    expect(JSON.parse((read.contents[0] as { text: string }).text).fields.find((f: any) => f.name === 'status').values).toHaveLength(12);
    await client.close();
  });
});
