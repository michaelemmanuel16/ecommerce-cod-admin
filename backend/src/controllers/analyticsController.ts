import { Response } from 'express';
import { AuthRequest } from '../types';
import analyticsService from '../services/analyticsService';

export const getDashboardMetrics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const metrics = await analyticsService.getDashboardMetrics(
      {
        startDate: startDate as string,
        endDate: endDate as string
      },
      req.user?.id,
      req.user?.role
    );

    res.json({ metrics });
  } catch (error) {
    throw error;
  }
};

export const getSalesTrends = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { period = 'daily', days = 30, startDate, endDate } = req.query;

    const trends = await analyticsService.getSalesTrends(
      {
        period: period as string,
        days: Number(days),
        startDate: startDate as string,
        endDate: endDate as string
      },
      req.user?.id,
      req.user?.role
    );

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
    const { startDate, endDate } = req.query;

    const performance = await analyticsService.getRepPerformance({
      startDate: startDate as string,
      endDate: endDate as string
    });

    // Filter data for sales reps - they can only see their own performance
    if (req.user?.role === 'sales_rep') {
      const myPerformance = performance.filter(
        (rep: any) => rep.userId === req.user?.id || rep.id === req.user?.id
      );
      res.json({ performance: myPerformance });
    } else {
      // Admins/managers see all reps' performance
      res.json({ performance });
    }
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

export const getPendingOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await analyticsService.getPendingOrders();
    res.json({ orders });
  } catch (error) {
    throw error;
  }
};

export const getRecentActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const activity = await analyticsService.getRecentActivity();
    res.json({ activity });
  } catch (error) {
    throw error;
  }
};
