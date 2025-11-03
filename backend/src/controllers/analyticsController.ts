import { Response } from 'express';
import { AuthRequest } from '../types';
import analyticsService from '../services/analyticsService';

export const getDashboardMetrics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const metrics = await analyticsService.getDashboardMetrics();
    res.json({ metrics });
  } catch (error) {
    throw error;
  }
};

export const getSalesTrends = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'daily', days = 30 } = req.query;

    const trends = await analyticsService.getSalesTrends({
      period: period as string,
      days: Number(days)
    });

    res.json({ trends });
  } catch (error) {
    throw error;
  }
};

export const getConversionFunnel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const funnel = await analyticsService.getConversionFunnel({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });

    res.json({ funnel });
  } catch (error) {
    throw error;
  }
};

export const getRepPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const performance = await analyticsService.getRepPerformance();
    res.json({ performance });
  } catch (error) {
    throw error;
  }
};

export const getAgentPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const performance = await analyticsService.getAgentPerformance();
    res.json({ performance });
  } catch (error) {
    throw error;
  }
};

export const getCustomerInsights = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const insights = await analyticsService.getCustomerInsights();
    res.json({ insights });
  } catch (error) {
    throw error;
  }
};
