import { Router, Request, Response } from 'express';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import prisma from '../utils/prisma';
import { prismaBase } from '../utils/prisma';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { getTenantId } from '../utils/tenantContext';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);
router.use(requireSuperAdmin);

const MAX_KEYS_PER_TENANT = 5;
const DEFAULT_EXPIRY_DAYS = 90;

const generateKeySchema = z.object({
  label: z.string().min(1).max(50),
  expiresInDays: z.number().int().min(1).max(365).optional(),
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
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Generate a new API key
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = generateKeySchema.parse(req.body);

    // Generate high-entropy key (256 bits)
    const rawKey = `mcp_${randomBytes(32).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12); // "mcp_" + first 8 hex chars

    const expiresInDays = parsed.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const tenantId = getTenantId();

    // Atomic count + create in a transaction to prevent exceeding key limit
    const mcpKey = await prismaBase.$transaction(async (tx) => {
      const existingCount = await tx.mcpApiKey.count({
        where: { tenantId: tenantId!, revokedAt: null },
      });

      if (existingCount >= MAX_KEYS_PER_TENANT) {
        throw new Error(`Maximum ${MAX_KEYS_PER_TENANT} active API keys per tenant`);
      }

      return tx.mcpApiKey.create({
        data: {
          tenantId: tenantId!,
          keyHash,
          keyPrefix,
          label: parsed.label,
          expiresAt,
        },
      });
    });

    // Return the raw key ONCE — it's hashed in the DB and can never be retrieved again
    res.status(201).json({
      id: mcpKey.id,
      key: rawKey,
      keyPrefix,
      label: mcpKey.label,
      expiresAt: mcpKey.expiresAt,
      createdAt: mcpKey.createdAt,
      mcpConfig: {
        mcpServers: {
          'cod-admin': {
            command: 'node',
            args: ['path/to/backend/dist/mcp/server.js'],
            env: { COD_ADMIN_API_KEY: rawKey },
          },
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
      return;
    }
    if ((error as Error).message?.includes('Maximum')) {
      res.status(400).json({ error: (error as Error).message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

// Revoke an API key
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const key = await prisma.mcpApiKey.findFirst({
      where: { id, revokedAt: null },
    });

    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    await prisma.mcpApiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    res.json({ message: 'API key revoked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

export default router;
