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
 * Each request gets a fresh server + stateless transport (no sessions, no cache).
 */
// Middleware: normalize Accept header at the raw IncomingMessage level.
// The MCP SDK converts req to a Web Standard Request via getRequestListener,
// reading headers from the raw Node.js IncomingMessage — not Express's req.headers.
// We must set it here so the Web Standard Request sees the correct Accept header.
router.use((req: Request, _res: Response, next) => {
  const accept = req.headers.accept || '';
  if (!accept.includes('text/event-stream') || !accept.includes('application/json')) {
    const normalized = 'application/json, text/event-stream';
    req.headers.accept = normalized;
    // Also patch the raw headers array that Node's http.IncomingMessage uses
    const rawIdx = req.rawHeaders.findIndex((h) => h.toLowerCase() === 'accept');
    if (rawIdx >= 0) {
      req.rawHeaders[rawIdx + 1] = normalized;
    } else {
      req.rawHeaders.push('Accept', normalized);
    }
  }
  next();
});

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

    // Validate key upfront to reject bad requests before creating a server.
    // wrapHandler inside createMcpServer also re-validates per tool call (defense-in-depth).
    // Both hit the 60s auth cache so the double check is effectively free.
    try {
      await validateKey(apiKey);
    } catch (err) {
      res.status(401).json({ error: (err as Error).message });
      return;
    }

    // Create a fresh server per request — no cache, no raw keys in memory,
    // no EventEmitter leak from repeated server.connect() on a cached instance
    const server = createMcpServer(() => apiKey);

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

// GET /mcp — Stateless mode doesn't support SSE streams
router.get('/', (_req: Request, res: Response) => {
  res.status(405).json({
    error: 'Method Not Allowed. This MCP endpoint uses stateless mode — send POST requests only.',
  });
});

export default router;
