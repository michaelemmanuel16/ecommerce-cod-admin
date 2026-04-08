import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tenantStorage } from '../utils/tenantContext';
import { validateKey } from './auth';
import { rateLimiter } from './rateLimiter';
import { MCP_CONFIG } from './config';
import { mcpError } from './utils';

// Import tool registrations
import { registerOrderTools } from './tools/orders';
import { registerAnalyticsTools } from './tools/analytics';
import { registerAgentTools } from './tools/agents';
import { registerDeliveryTools } from './tools/deliveries';
import { registerCustomerTools } from './tools/customers';
import { registerProductTools } from './tools/products';
import { registerFinancialTools } from './tools/financial';
import { registerCustomerRepTools } from './tools/customerReps';

// Import resource registrations
import { registerResources } from './resources/schema';

/**
 * Create a fully configured MCP server with all tools registered.
 * Used by both stdio (local) and HTTP (remote) transports.
 */
export function createMcpServer(resolveApiKey: () => string) {
  const server = new McpServer({
    name: MCP_CONFIG.name,
    version: MCP_CONFIG.version,
  });

  function wrapHandler<T>(handler: (args: T) => Promise<any>) {
    return async (args: T) => {
      if (!rateLimiter.tryConsume()) {
        return mcpError('Rate limit exceeded. Please wait before making more requests.');
      }

      let resolvedTenantId: string;
      try {
        resolvedTenantId = await validateKey(resolveApiKey());
      } catch (err) {
        return mcpError((err as Error).message);
      }

      return tenantStorage.run({ tenantId: resolvedTenantId }, () => handler(args));
    };
  }

  registerOrderTools(server, wrapHandler);
  registerAnalyticsTools(server, wrapHandler);
  registerAgentTools(server, wrapHandler);
  registerDeliveryTools(server, wrapHandler);
  registerCustomerTools(server, wrapHandler);
  registerProductTools(server, wrapHandler);
  registerFinancialTools(server, wrapHandler);
  registerCustomerRepTools(server, wrapHandler);
  registerResources(server);

  return server;
}
