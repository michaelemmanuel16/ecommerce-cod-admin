export const MCP_CONFIG = {
  name: 'cod-admin',
  version: '1.0.0',
  description: 'COD Admin MCP Server — query your business data via AI',
  auth: {
    cacheTtlMs: 60_000, // Re-validate API key every 60 seconds
    keyEnvVar: 'COD_ADMIN_API_KEY',
  },
  connectionPool: {
    limit: 2, // Small pool — low concurrency
  },
} as const;
