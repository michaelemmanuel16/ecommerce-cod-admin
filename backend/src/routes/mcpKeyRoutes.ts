import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { auditService } from '../services/auditService';
import { buildMcpConfig, createKey, revokeKey } from '../services/mcpKeyService';
import { registryToolsOfRole } from '../config/roleToolRules';
import { getTenantMatrix } from '../services/permissionService';
import { getTenantId } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';

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
const auditKey = (req: Request, action: 'mcp_key_create' | 'mcp_key_revoke', key: {
  id: string; label: string; keyPrefix: string; userId: number | null; roleId: number | null;
}) => auditService.recordFromRequest(req, {
  action,
  resource: 'mcp_key',
  resourceId: key.id,
  metadata: { label: key.label, keyPrefix: key.keyPrefix, userId: key.userId, roleId: key.roleId },
});

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
        role: { select: { name: true, tools: true, isSystem: true, permissions: true, presetRole: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const matrix = await getTenantMatrix(getTenantId() ?? null);
    res.json({
      keys: keys.map(({ role, ...key }) => ({
        ...key,
        roleName: role?.name ?? null,
        toolCount: role ? registryToolsOfRole(role, matrix).length : 0,
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

    await auditKey(req, 'mcp_key_create', key);

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
      mcpConfig: buildMcpConfig(rawKey, baseUrl),
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

    await auditKey(req, 'mcp_key_revoke', key);

    res.json({ message: 'API key revoked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
