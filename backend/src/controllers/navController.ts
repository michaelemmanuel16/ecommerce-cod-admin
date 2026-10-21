import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import navService from '../services/navService';

export const getCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  res.json(await navService.getCounts(req.user));
};
