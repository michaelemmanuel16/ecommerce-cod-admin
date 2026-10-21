import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import searchService from '../services/searchService';

export const search = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json(await searchService.search(q, req.user));
};
