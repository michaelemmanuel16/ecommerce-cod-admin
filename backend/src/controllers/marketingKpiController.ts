import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { dateRange } from './marketingMappingController';
import * as kpi from '../services/marketing/marketingKpiService';
import * as funnel from '../services/marketing/marketingFunnelService';

export const getSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await kpi.tiles(dateRange(req)));
  } catch (error) {
    next(error);
  }
};

export const getFunnel = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const productId = req.query.productId === undefined ? undefined : Number(req.query.productId);
    res.json(await funnel.funnel({ ...dateRange(req), productId }));
  } catch (error) {
    next(error);
  }
};

export const getCampaignPerformance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await funnel.campaigns(dateRange(req)));
  } catch (error) {
    next(error);
  }
};
