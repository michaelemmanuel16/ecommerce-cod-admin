import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Response } from 'express';
import { AuthRequest } from '../../types';
import * as analyticsController from '../../controllers/analyticsController';
import analyticsService from '../../services/analyticsService';

// Mock analyticsService
jest.mock('../../services/analyticsService', () => ({
  __esModule: true,
  default: {
    getDashboardMetrics: jest.fn(),
    getSalesTrends: jest.fn(),
    getConversionFunnel: jest.fn(),
    getRepPerformance: jest.fn(),
    getAgentPerformance: jest.fn(),
    getCustomerInsights: jest.fn(),
    getPendingOrders: jest.fn(),
    getRecentActivity: jest.fn(),
  },
}));

describe('Analytics Controller Error Handling', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    mockReq = {
      query: {},
      user: {
        id: 1,
        role: 'admin',
        email: 'admin@test.com'
      } as any,
    };
    mockRes = {
      json: jest.fn().mockReturnThis() as any,
      status: jest.fn().mockReturnThis() as any,
    };
    // Spy on console.error to verify error logging
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('getDashboardMetrics', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Database connection failed');
      (analyticsService.getDashboardMetrics as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getDashboardMetrics(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch dashboard metrics',
        message: expect.any(String),
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[analyticsController] getDashboardMetrics error:',
        mockError
      );
    });

    it('should return metrics on success', async () => {
      const mockMetrics = {
        totalOrders: 100,
        todayOrders: 10,
        totalRevenue: 5000,
      };
      (analyticsService.getDashboardMetrics as jest.Mock).mockResolvedValue(mockMetrics);

      await analyticsController.getDashboardMetrics(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ metrics: mockMetrics });
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('getSalesTrends', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Query timeout');
      (analyticsService.getSalesTrends as jest.Mock).mockRejectedValue(mockError);

      mockReq.query = { period: 'daily', days: '30' };
      await analyticsController.getSalesTrends(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch sales trends',
        message: expect.any(String),
      });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[analyticsController] getSalesTrends error:',
        mockError
      );
    });

    it('should return trends on success', async () => {
      const mockTrends = [
        { date: '2024-01-01', revenue: 1000 },
        { date: '2024-01-02', revenue: 1500 },
      ];
      (analyticsService.getSalesTrends as jest.Mock).mockResolvedValue(mockTrends);

      mockReq.query = { period: 'daily', days: '7' };
      await analyticsController.getSalesTrends(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({ trends: mockTrends });
    });
  });

  describe('getConversionFunnel', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Connection pool exhausted');
      (analyticsService.getConversionFunnel as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getConversionFunnel(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch conversion funnel',
        message: expect.any(String),
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getRepPerformance', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Service unavailable');
      (analyticsService.getRepPerformance as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getRepPerformance(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch rep performance',
        message: expect.any(String),
      });
    });

    it('should filter performance for sales_rep users', async () => {
      const mockPerformance = [
        { userId: 1, name: 'Rep 1', orders: 50 },
        { userId: 2, name: 'Rep 2', orders: 30 },
      ];
      (analyticsService.getRepPerformance as jest.Mock).mockResolvedValue(mockPerformance);

      mockReq.user = { id: 1, role: 'sales_rep' } as any;
      await analyticsController.getRepPerformance(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        performance: [mockPerformance[0]], // Only their own data
      });
    });
  });

  describe('getAgentPerformance', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Database error');
      (analyticsService.getAgentPerformance as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getAgentPerformance(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch agent performance',
        message: expect.any(String),
      });
    });
  });

  describe('getCustomerInsights', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Timeout error');
      (analyticsService.getCustomerInsights as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getCustomerInsights(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch customer insights',
        message: expect.any(String),
      });
    });
  });

  describe('getPendingOrders', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Service error');
      (analyticsService.getPendingOrders as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getPendingOrders(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch pending orders',
        message: expect.any(String),
      });
    });
  });

  describe('getRecentActivity', () => {
    it('should return 500 on service error', async () => {
      const mockError = new Error('Activity fetch failed');
      (analyticsService.getRecentActivity as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getRecentActivity(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch recent activity',
        message: expect.any(String),
      });
    });
  });

  describe('Error message environment handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should include detailed message in development', async () => {
      process.env.NODE_ENV = 'development';
      const mockError = new Error('Detailed error message');
      (analyticsService.getDashboardMetrics as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getDashboardMetrics(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch dashboard metrics',
        message: 'Detailed error message',
      });
    });

    it('should hide detailed message in production', async () => {
      process.env.NODE_ENV = 'production';
      const mockError = new Error('Sensitive error details');
      (analyticsService.getDashboardMetrics as jest.Mock).mockRejectedValue(mockError);

      await analyticsController.getDashboardMetrics(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Failed to fetch dashboard metrics',
        message: 'Internal server error',
      });
    });
  });
});
