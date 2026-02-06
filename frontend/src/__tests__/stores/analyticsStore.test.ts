import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAnalyticsStore } from '../../stores/analyticsStore';
import { analyticsService } from '../../services/analytics.service';

// Mock the analytics service
vi.mock('../../services/analytics.service', () => ({
    analyticsService: {
        getDashboardMetrics: vi.fn(),
        getSalesTrends: vi.fn(),
        getConversionFunnel: vi.fn(),
        getRepPerformance: vi.fn(),
        getAgentPerformance: vi.fn(),
        getCustomerInsights: vi.fn(),
        getPendingOrders: vi.fn(),
        getRecentActivity: vi.fn(),
        getOrderStatusDistribution: vi.fn(),
    },
}));

describe('Analytics Store', () => {
    beforeEach(() => {
        // Reset store state before each test
        useAnalyticsStore.setState({
            metrics: null,
            trends: [],
            conversionFunnel: [],
            repPerformance: [],
            agentPerformance: [],
            customerInsights: null,
            pendingOrders: [],
            recentActivity: [],
            ordersByStatus: [],
            isLoading: false,
            error: null,
        });
        vi.clearAllMocks();
    });

    it('should initialize with default state', () => {
        const state = useAnalyticsStore.getState();
        expect(state.metrics).toBeNull();
        expect(state.trends).toEqual([]);
        expect(state.isLoading).toBe(false);
    });

    it('should fetch dashboard metrics successfully', async () => {
        const mockMetrics = {
            totalOrders: 100,
            todayOrders: 10,
            pendingOrders: 5,
            deliveredOrders: 80,
            totalRevenue: 5000,
            todayRevenue: 500,
            activeAgents: 10,
            avgDeliveryTime: 24,
            deliveryRate: 0.8,
        };
        vi.mocked(analyticsService.getDashboardMetrics).mockResolvedValue(mockMetrics);

        const { fetchDashboardMetrics } = useAnalyticsStore.getState();
        await fetchDashboardMetrics();

        const state = useAnalyticsStore.getState();
        expect(state.metrics).toEqual(mockMetrics);
        expect(state.isLoading).toBe(false);
    });

    it('should handle fetch dashboard metrics error', async () => {
        const errorMessage = 'Failed to fetch dashboard metrics';
        vi.mocked(analyticsService.getDashboardMetrics).mockRejectedValue(
            new Error(errorMessage)
        );

        const { fetchDashboardMetrics } = useAnalyticsStore.getState();
        await fetchDashboardMetrics();

        const state = useAnalyticsStore.getState();
        expect(state.error).toBe(errorMessage);
        expect(state.isLoading).toBe(false);
    });

    it('should fetch sales trends successfully', async () => {
        const mockTrends = [{ date: '2024-01-01', orders: 10, revenue: 100, delivered: 8, conversionRate: 0.8 }];
        vi.mocked(analyticsService.getSalesTrends).mockResolvedValue(mockTrends);

        const { fetchSalesTrends } = useAnalyticsStore.getState();
        await fetchSalesTrends('daily', 7);

        const state = useAnalyticsStore.getState();
        expect(state.trends).toEqual(mockTrends);
    });

    it('should fetch pending orders successfully', async () => {
        const mockPending = [{ id: 1, orderNumber: 'ORD-1', customerName: 'John', customerPhone: '123', customerArea: 'Area', totalAmount: 100, createdAt: 'date', repName: 'Rep' }];
        vi.mocked(analyticsService.getPendingOrders).mockResolvedValue(mockPending);

        const { fetchPendingOrders } = useAnalyticsStore.getState();
        await fetchPendingOrders();

        const state = useAnalyticsStore.getState();
        expect(state.pendingOrders).toEqual(mockPending);
    });

    it('should refresh all data', async () => {
        vi.mocked(analyticsService.getDashboardMetrics).mockResolvedValue({} as any);
        vi.mocked(analyticsService.getSalesTrends).mockResolvedValue([]);
        vi.mocked(analyticsService.getRepPerformance).mockResolvedValue([]);
        vi.mocked(analyticsService.getAgentPerformance).mockResolvedValue([]);
        vi.mocked(analyticsService.getPendingOrders).mockResolvedValue([]);
        vi.mocked(analyticsService.getRecentActivity).mockResolvedValue([]);
        vi.mocked(analyticsService.getOrderStatusDistribution).mockResolvedValue([]);

        const { refreshAll } = useAnalyticsStore.getState();
        await refreshAll();

        expect(analyticsService.getDashboardMetrics).toHaveBeenCalled();
        expect(analyticsService.getSalesTrends).toHaveBeenCalled();
        const state = useAnalyticsStore.getState();
        expect(state.isLoading).toBe(false);
    });
});
