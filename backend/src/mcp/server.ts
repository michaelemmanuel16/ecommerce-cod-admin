#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tenantStorage } from '../utils/tenantContext';
import { validateKey, disconnectPrisma } from './auth';
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

const apiKey = process.env[MCP_CONFIG.auth.keyEnvVar];
if (!apiKey) {
  console.error(`Error: ${MCP_CONFIG.auth.keyEnvVar} environment variable is required`);
  process.exit(1);
}

async function main() {
  // Validate API key at startup to fail fast
  let tenantId: string;
  try {
    tenantId = await validateKey(apiKey!);
  } catch (err) {
    console.error(`Auth failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const server = new McpServer({
    name: MCP_CONFIG.name,
    version: MCP_CONFIG.version,
  });

  // Helper to wrap tool handlers with tenant context, auth re-validation, and rate limiting
  function wrapHandler<T>(handler: (args: T) => Promise<any>) {
    return async (args: T) => {
      // Rate limit check
      if (!rateLimiter.tryConsume()) {
        return mcpError('Rate limit exceeded. Please wait before making more requests.');
      }

      // Re-validate API key (cached for 60s)
      try {
        tenantId = await validateKey(apiKey!);
      } catch (err) {
        return mcpError((err as Error).message);
      }

      // Run handler within tenant context
      return tenantStorage.run({ tenantId }, () => handler(args));
    };
  }

  // Register all tools
  registerOrderTools(server, wrapHandler);
  registerAnalyticsTools(server, wrapHandler);
  registerAgentTools(server, wrapHandler);
  registerDeliveryTools(server, wrapHandler);
  registerCustomerTools(server, wrapHandler);
  registerProductTools(server, wrapHandler);
  registerFinancialTools(server, wrapHandler);
  registerCustomerRepTools(server, wrapHandler);

  // Register resources
  registerResources(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Graceful shutdown — disconnect both the auth Prisma client and the main (extended) client
async function shutdown() {
  const { prismaBase } = await import('../utils/prisma');
  await Promise.all([disconnectPrisma(), prismaBase.$disconnect()]);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in MCP server:', reason);
});

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
