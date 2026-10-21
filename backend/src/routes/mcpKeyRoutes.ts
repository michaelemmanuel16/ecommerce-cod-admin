import { Router, Request, Response } from 'express';
import path from 'path';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { getTenantId } from '../utils/tenantContext';
import { AuthRequest } from '../types';
import { auditService } from '../services/auditService';
import { createKey, revokeKey } from '../services/mcpKeyService';
import { roleToolList } from '../config/defaultRoles';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);
router.use(requireSuperAdmin);

const generateKeySchema = z.object({
  label: z.string().trim().min(1).max(50),
  roleId: z.number().int().positive(),
  userId: z.number().int().positive().optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/** Record an audit row for a key change. The raw key and its hash never go in: only the prefix does. */
async function auditKey(req: AuthRequest, action: 'mcp_key_create' | 'mcp_key_revoke', key: {
  id: string; label: string; keyPrefix: string; userId: number | null; roleId: number | null;
}) {
  try {
    await auditService.record({
      actorId: req.user!.id,
      actorKind: 'person',
      channel: 'app',
      action,
      resource: 'mcp_key',
      resourceId: key.id,
      metadata: { label: key.label, keyPrefix: key.keyPrefix, userId: key.userId, roleId: key.roleId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  } catch (error) {
    // The key change already happened; a lost audit row is logged, not turned into a failed request.
    logger.error('Failed to write MCP key audit row', { action, keyId: key.id, error });
  }
}

// List all API keys for the tenant
router.get('/', async (_req: Request, res: Response) => {
  try {
    const keys = await prisma.mcpApiKey.findMany({
      where: { revokedAt: null },
      select: {
        id: true,
        keyPrefix: true,
        label: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        userId: true,
        roleId: true,
        role: { select: { name: true, tools: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      keys: keys.map(({ role, ...key }) => ({
        ...key,
        roleName: role?.name ?? null,
        toolCount: roleToolList(role?.tools).length,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Generate a new API key
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = generateKeySchema.parse(req.body);
    const { key, rawKey, roleName, toolCount } = await createKey({ tenantId: getTenantId()!, ...parsed });

    await auditKey(req as AuthRequest, 'mcp_key_create', key);

    // FRONTEND_URL doubles as the public base URL since nginx fronts both frontend and
    // backend on the same domain. If the architecture ever splits them across subdomains,
    // add a dedicated BACKEND_URL or MCP_BASE_URL env var here.
    const envBase = process.env.FRONTEND_URL;
    const baseUrl = envBase || `${req.protocol}://${req.get('host')}`;

    // Return the raw key ONCE — it's hashed in the DB and can never be retrieved again
    res.status(201).json({
      id: key.id,
      key: rawKey,
      keyPrefix: key.keyPrefix,
      label: key.label,
      userId: key.userId,
      roleId: key.roleId,
      roleName,
      toolCount,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      mcpConfig: {
        remote: {
          mcpServers: {
            'cod-admin': {
              type: 'http',
              url: `${baseUrl}/mcp`,
              headers: { Authorization: `Bearer ${rawKey}` },
            },
          },
        },
        local: {
          mcpServers: {
            'cod-admin': {
              command: 'node',
              args: [path.resolve(__dirname, '..', 'mcp', 'server.js')],
              env: { COD_ADMIN_API_KEY: rawKey },
            },
          },
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// Revoke an API key
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const key = await revokeKey(getTenantId()!, req.params.id);
    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    await auditKey(req as AuthRequest, 'mcp_key_revoke', key);

    res.json({ message: 'API key revoked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
