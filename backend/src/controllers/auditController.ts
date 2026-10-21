import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { auditService } from '../services/auditService';

const listQuery = z.object({
  actorId: z.coerce.number().int().positive().optional(),
  channel: z.enum(['app', 'chat', 'mcp', 'connector', 'system']).optional(),
  tool: z.string().min(1).max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** GET /api/audit-log?actorId&channel&tool&from&to&page&limit */
export const listAuditLog = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 400);
    }
    res.json(await auditService.list(parsed.data));
  } catch (error) {
    next(error);
  }
};
