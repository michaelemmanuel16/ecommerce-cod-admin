import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runInTenant } from '../utils/tenantContext';
import { validateKey, McpPrincipal } from './auth';
import { checkMcp } from './rateLimiter';
import { MCP_CONFIG } from './config';
import { mcpError, mcpRateLimited, toMcpResult } from './utils';
import { allowedTools, listTools, runTool, ToolContext } from '../tools/registry';
import '../tools'; // registers the 14 tools

// Import resource registrations
import { registerResources } from './resources/schema';

const contextOf = (p: McpPrincipal): ToolContext => ({
  tenantId: p.tenantId,
  actorId: p.userId,
  actorKind: p.actorKind,
  roleId: p.roleId,
  channel: 'mcp',
  access: p.access,
});

/** tools/list entries, built once from the registry. Same JSON schema options the SDK uses for its own tools. */
let toolEntries: Array<{ name: string; description: string; inputSchema: ReturnType<typeof toJsonSchemaCompat> }> | undefined;
const entries = () =>
  (toolEntries ??= listTools().map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: toJsonSchemaCompat(def.input as never, { strictUnions: true, pipeStrategy: 'input' }),
  })));

/**
 * Create a fully configured MCP server. Used by both stdio (local) and HTTP (remote) transports.
 * Tools come from the registry. Each call runs as the key's user through runTool, so the registry does the input
 * check, the permission check and the audit row. tools/list shows only the tools that call would allow.
 */
export function createMcpServer(resolveApiKey: () => string) {
  const server = new McpServer({
    name: MCP_CONFIG.name,
    version: MCP_CONFIG.version,
  });
  registerResources(server);
  server.server.registerCapabilities({ tools: { listChanged: true } });

  // The SDK would check a call's input before it reaches us, and a refused call would write no audit row. So both
  // tool handlers are ours: runTool checks the input and writes the row (status invalid).
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const apiKey = resolveApiKey();
    let principal: McpPrincipal;
    try {
      principal = await validateKey(apiKey);
    } catch (err) {
      return mcpError((err as Error).message);
    }

    // The one counting point: per key and per tenant.
    const limit = await checkMcp({ keyId: principal.keyId, tenantId: principal.tenantId });
    if (!limit.allowed) return mcpRateLimited(limit.retryAfterSeconds);

    return toMcpResult(await runTool(request.params.name as never, request.params.arguments, contextOf(principal))) as never;
  });

  // An error here (a bad key, a failed lookup) is an error to the client, never a full list.
  server.server.setRequestHandler(ListToolsRequestSchema, async () => {
    const principal = await validateKey(resolveApiKey());
    const allowed = await runInTenant(principal.tenantId, () => allowedTools(contextOf(principal)));
    const names = new Set<string>(allowed.map((def) => def.name));
    return { tools: entries().filter((t) => names.has(t.name)) } as never;
  });

  return server;
}
