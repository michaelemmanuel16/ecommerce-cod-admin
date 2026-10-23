import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { listConnections, saveConnection, testConnection } from '../services/paymentConnectionService';

const saveSchema = z.object({
  provider: z.string().trim().min(1).max(40),
  mode: z.enum(['test', 'live']),
  publicKey: z.string().trim().max(200).nullable().optional(),
  secretKey: z.string().max(300).nullable().optional(),
  isEnabled: z.boolean().optional(),
});

export const getConnections = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ connections: await listConnections() });
  } catch (error) {
    next(error);
  }
};

export const putConnection = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid payment connection', 400, 'VALIDATION_ERROR');
    res.json({ connection: await saveConnection(parsed.data) });
  } catch (error) {
    next(error);
  }
};

export const postTestConnection = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid payment connection id', 400, 'VALIDATION_ERROR');
    res.json(await testConnection(id));
  } catch (error) {
    next(error);
  }
};
