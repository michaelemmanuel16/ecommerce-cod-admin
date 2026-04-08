#!/usr/bin/env node
import path from 'path';
import { config as dotenvConfig } from 'dotenv';

// Auto-load .env from the backend root (two levels up from dist/mcp/server.js)
dotenvConfig({ path: path.resolve(__dirname, '..', '..', '.env') });

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { validateKey, disconnectPrisma } from './auth';
import { MCP_CONFIG } from './config';
import { createMcpServer } from './createServer';

const apiKey = process.env[MCP_CONFIG.auth.keyEnvVar];
if (!apiKey) {
  console.error(`Error: ${MCP_CONFIG.auth.keyEnvVar} environment variable is required`);
  process.exit(1);
}

async function main() {
  // Validate API key at startup to fail fast
  try {
    await validateKey(apiKey!);
  } catch (err) {
    console.error(`Auth failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const server = createMcpServer(() => apiKey!);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Graceful shutdown
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
