import { Router, Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validateKey } from './auth';
import { createMcpServer } from './createServer';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /mcp — Streamable HTTP transport for remote MCP clients.
 *
 * Auth: API key in Authorization header (Bearer mcp_...).
 * Each request gets a fresh stateless transport (no sessions).
 * The MCP server is created once per validated API key and cached.
 */

const serverCache = new Map<string, ReturnType<typeof createMcpServer>>();

function getOrCreateServer(apiKey: string) {
  // Cache key is the API key itself (one server per key, same tenant)
  if (!serverCache.has(apiKey)) {
    const server = createMcpServer(() => apiKey);
    serverCache.set(apiKey, server);
  }
  return serverCache.get(apiKey)!;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    // Extract API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header. Use: Bearer mcp_...' });
      return;
    }

    const apiKey = authHeader.slice(7);
    if (!apiKey.startsWith('mcp_')) {
      res.status(401).json({ error: 'Invalid API key format' });
      return;
    }

    // Validate the key (cached for 60s)
    try {
      await validateKey(apiKey);
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
      return;
    }

    const server = getOrCreateServer(apiKey);

    // Create stateless transport for this request (no session persistence)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => transport.close());

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error('MCP HTTP transport error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP request failed' });
    }
  }
});

export default router;
