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

    if (process.env.NODE_ENV === 'development') {
      console.log('[DEBUG] analyticsController.getDashboardMetrics response:', metrics);
    }
    res.json({ metrics });
  } catch (error) {
    console.error('[analyticsController] getDashboardMetrics error:', error);
    res.status(500).json({
      error: 'Failed to fetch dashboard metrics',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
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
    console.error('[analyticsController] getSalesTrends error:', error);
    res.status(500).json({
      error: 'Failed to fetch sales trends',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getConversionFunnel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const funnel = await analyticsService.getConversionFunnel(
      {
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      },
      req.user?.id,
      req.user?.role
    );

    res.json({ funnel });
  } catch (error) {
    console.error('[analyticsController] getConversionFunnel error:', error);
    res.status(500).json({
      error: 'Failed to fetch conversion funnel',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
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
    console.error('[analyticsController] getRepPerformance error:', error);
    res.status(500).json({
      error: 'Failed to fetch rep performance',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getAgentPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const performance = await analyticsService.getAgentPerformance({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    res.json({ performance });
  } catch (error) {
    console.error('[analyticsController] getAgentPerformance error:', error);
    res.status(500).json({
      error: 'Failed to fetch agent performance',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getCustomerInsights = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const insights = await analyticsService.getCustomerInsights();
    res.json({ insights });
  } catch (error) {
    console.error('[analyticsController] getCustomerInsights error:', error);
    res.status(500).json({
      error: 'Failed to fetch customer insights',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getPendingOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const orders = await analyticsService.getPendingOrders(req.user?.id, req.user?.role);
    res.json({ orders });
  } catch (error) {
    console.error('[analyticsController] getPendingOrders error:', error);
    res.status(500).json({
      error: 'Failed to fetch pending orders',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getRecentActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const activity = await analyticsService.getRecentActivity(req.user?.id, req.user?.role);
    res.json({ activity });
  } catch (error) {
    console.error('[analyticsController] getRecentActivity error:', error);
    res.status(500).json({
      error: 'Failed to fetch recent activity',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getProductPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const performance = await analyticsService.getProductPerformance({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    res.json({ performance });
  } catch (error) {
    console.error('[analyticsController] getProductPerformance error:', error);
    res.status(500).json({
      error: 'Failed to fetch product performance',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getAreaDistribution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const distribution = await analyticsService.getAreaDistribution({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
    });
    res.json({ distribution });
  } catch (error) {
    console.error('[analyticsController] getAreaDistribution error:', error);
    res.status(500).json({
      error: 'Failed to fetch area distribution',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};

export const getOrderStatusDistribution = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const distribution = await analyticsService.getOrderStatusDistribution(
      {
        startDate: startDate as string,
        endDate: endDate as string
      },
      req.user?.id,
      req.user?.role
    );

    res.json({ distribution });
  } catch (error) {
    console.error('[analyticsController] getOrderStatusDistribution error:', error);
    res.status(500).json({
      error: 'Failed to fetch order status distribution',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
};
