import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { dateRange } from './marketingMappingController';
import * as kpi from '../services/marketing/marketingKpiService';

export const getSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await kpi.tiles(dateRange(req)));
  } catch (error) {
    next(error);
  }
};
