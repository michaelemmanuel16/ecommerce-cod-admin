import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { AnalyticsService } from '../../services/analyticsService';

describe('AnalyticsService - Month-to-Date Filtering', () => {
    let analyticsService: AnalyticsService;

    beforeEach(() => {
        analyticsService = new AnalyticsService();
        jest.clearAllMocks();
    });

    describe('getDashboardMetrics - MTD Filtering', () => {
        it('should apply month-to-date filter by default (no custom dates)', async () => {
            // Note: We can't easily mock Date constructor, so we test the behavior
            // by verifying that date filters are applied (not the exact dates)

            prismaMock.order.count
                .mockResolvedValueOnce(10) // totalOrders (MTD)
                .mockResolvedValueOnce(2) // todayOrders
                .mockResolvedValueOnce(154) // pendingOrders (all-time, no date filter)
                .mockResolvedValueOnce(0); // deliveredOrders (MTD)

            prismaMock.order.aggregate
                .mockResolvedValueOnce({ _sum: { totalAmount: 1000 } } as any) // totalRevenue (MTD)
                .mockResolvedValueOnce({ _sum: { totalAmount: 200 } } as any); // todayRevenue

            prismaMock.user.count.mockResolvedValue(5);
            prismaMock.delivery.findMany.mockResolvedValue([]);

            const metrics = await analyticsService.getDashboardMetrics();

            // Verify MTD filtering was applied
            expect(metrics.totalOrders).toBe(10); // Only Feb orders
            expect(metrics.deliveredOrders).toBe(0); // Only Feb delivered
            expect(metrics.totalRevenue).toBe(1000); // Only Feb revenue
            expect(metrics.pendingOrders).toBe(154); // All pending (no date filter)

            // Verify the date filter was constructed correctly
            const orderCountCalls = prismaMock.order.count.mock.calls;
            expect(orderCountCalls[0][0].where.createdAt).toBeDefined();
            expect(orderCountCalls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
            expect(orderCountCalls[0][0].where.createdAt.lte).toBeInstanceOf(Date);

            // Pending orders should NOT have date filter (only status filter)
            expect(orderCountCalls[2][0].where.createdAt).toBeUndefined();
            expect(orderCountCalls[2][0].where.status).toBe('pending_confirmation');
        });

        it('should override MTD filter when custom date range provided', async () => {
            const customStart = '2026-01-01';
            const customEnd = '2026-01-31';

            prismaMock.order.count
                .mockResolvedValueOnce(50) // totalOrders (custom range)
                .mockResolvedValueOnce(0) // todayOrders
                .mockResolvedValueOnce(154) // pendingOrders
                .mockResolvedValueOnce(30); // deliveredOrders (custom range)

            prismaMock.order.aggregate
                .mockResolvedValueOnce({ _sum: { totalAmount: 5000 } } as any)
                .mockResolvedValueOnce({ _sum: { totalAmount: 0 } } as any);

            prismaMock.user.count.mockResolvedValue(5);
            prismaMock.delivery.findMany.mockResolvedValue([]);

            const metrics = await analyticsService.getDashboardMetrics({
                startDate: customStart,
                endDate: customEnd
            });

            // Verify custom date range was used
            expect(metrics.totalOrders).toBe(50);
            expect(metrics.deliveredOrders).toBe(30);
            expect(metrics.totalRevenue).toBe(5000);

            // Verify the custom dates were passed to Prisma
            const orderCountCalls = prismaMock.order.count.mock.calls;
            const dateFilter = orderCountCalls[0][0].where.createdAt;
            expect(dateFilter.gte).toEqual(new Date(customStart));
            expect(dateFilter.lte).toEqual(new Date(customEnd));
        });

        it('should keep pending orders unfiltered even with custom date range', async () => {
            prismaMock.order.count
                .mockResolvedValueOnce(20)
                .mockResolvedValueOnce(5)
                .mockResolvedValueOnce(154) // Pending should still be all-time
                .mockResolvedValueOnce(10);

            prismaMock.order.aggregate
                .mockResolvedValueOnce({ _sum: { totalAmount: 2000 } } as any)
                .mockResolvedValueOnce({ _sum: { totalAmount: 500 } } as any);

            prismaMock.user.count.mockResolvedValue(5);
            prismaMock.delivery.findMany.mockResolvedValue([]);

            await analyticsService.getDashboardMetrics({
                startDate: '2026-01-01',
                endDate: '2026-01-31'
            });

            // Verify pending orders query has no date filter
            const pendingOrdersCall = prismaMock.order.count.mock.calls[2];
            expect(pendingOrdersCall[0].where.createdAt).toBeUndefined();
            expect(pendingOrdersCall[0].where.deletedAt).toBeNull();
            expect(pendingOrdersCall[0].where.status).toBe('pending_confirmation');
        });
    });

    describe('getRepPerformance - MTD Filtering', () => {
        it('should apply month-to-date filter by default', async () => {

            const mockReps = [
                {
                    id: 1,
                    firstName: 'John',
                    lastName: 'Doe',
                    assignedOrdersAsRep: [
                        {
                            id: 1,
                            status: 'delivered',
                            totalAmount: 100,
                            createdAt: new Date('2026-02-01'),
                            updatedAt: new Date('2026-02-02'),
                            commissionPaid: false
                        },
                        {
                            id: 2,
                            status: 'pending_confirmation',
                            totalAmount: 200,
                            createdAt: new Date('2026-02-03'),
                            updatedAt: new Date('2026-02-03'),
                            commissionPaid: false
                        }
                    ]
                }
            ];

            prismaMock.user.findMany.mockResolvedValue(mockReps as any);

            // Mock pending orders count (all-time)
            prismaMock.order.count.mockResolvedValue(154);

            const performance = await analyticsService.getRepPerformance();

            expect(performance).toHaveLength(1);
            expect(performance[0].totalAssigned).toBe(2); // MTD orders
            expect(performance[0].completed).toBe(1); // MTD delivered
            expect(performance[0].revenue).toBe(100); // MTD revenue
            expect(performance[0].pending).toBe(154); // All-time pending

            // Verify MTD date filter was applied to assignedOrdersAsRep query
            const userFindManyCall = prismaMock.user.findMany.mock.calls[0];
            const dateFilter = userFindManyCall[0].select.assignedOrdersAsRep.where;
            expect(dateFilter.createdAt).toBeDefined();
            expect(dateFilter.createdAt.gte).toBeInstanceOf(Date);
            expect(dateFilter.createdAt.lte).toBeInstanceOf(Date);
        });

        it('should override MTD filter when custom date range provided', async () => {
            const mockReps = [
                {
                    id: 1,
                    firstName: 'Jane',
                    lastName: 'Smith',
                    assignedOrdersAsRep: [
                        {
                            id: 1,
                            status: 'delivered',
                            totalAmount: 500,
                            createdAt: new Date('2026-01-15'),
                            updatedAt: new Date('2026-01-16'),
                            commissionPaid: false
                        },
                        {
                            id: 2,
                            status: 'delivered',
                            totalAmount: 300,
                            createdAt: new Date('2026-01-20'),
                            updatedAt: new Date('2026-01-21'),
                            commissionPaid: false
                        }
                    ]
                }
            ];

            prismaMock.user.findMany.mockResolvedValue(mockReps as any);
            prismaMock.order.count.mockResolvedValue(154);

            const performance = await analyticsService.getRepPerformance({
                startDate: '2026-01-01',
                endDate: '2026-01-31'
            });

            expect(performance[0].totalAssigned).toBe(2); // Custom range orders
            expect(performance[0].completed).toBe(2); // Custom range delivered
            expect(performance[0].revenue).toBe(800); // Custom range revenue
            expect(performance[0].pending).toBe(154); // Still all-time

            // Verify custom date range was used
            const userFindManyCall = prismaMock.user.findMany.mock.calls[0];
            const dateFilter = userFindManyCall[0].select.assignedOrdersAsRep.where;
            expect(dateFilter.createdAt.gte).toEqual(new Date('2026-01-01'));
            expect(dateFilter.createdAt.lte).toEqual(new Date('2026-01-31'));
        });

        it('should fetch pending orders separately without date filter', async () => {
            const mockReps = [
                {
                    id: 1,
                    firstName: 'Test',
                    lastName: 'Rep',
                    assignedOrdersAsRep: []
                }
            ];

            prismaMock.user.findMany.mockResolvedValue(mockReps as any);
            prismaMock.order.count.mockResolvedValue(154);

            await analyticsService.getRepPerformance();

            // Verify separate pending orders query
            const orderCountCall = prismaMock.order.count.mock.calls[0];
            expect(orderCountCall[0].where.assignedTo).toBe(1);
            expect(orderCountCall[0].where.status.notIn).toEqual([
                'delivered',
                'cancelled',
                'returned',
                'failed_delivery'
            ]);
            expect(orderCountCall[0].where.deletedAt).toBeNull();
            // Should NOT have createdAt filter
            expect(orderCountCall[0].where.createdAt).toBeUndefined();
        });

        it('should calculate metrics correctly with MTD filter on first of month', async () => {

            const mockReps = [
                {
                    id: 1,
                    firstName: 'John',
                    lastName: 'Doe',
                    assignedOrdersAsRep: [
                        {
                            id: 1,
                            status: 'delivered',
                            totalAmount: 100,
                            createdAt: new Date('2026-02-01T00:00:00Z'),
                            updatedAt: new Date('2026-02-01T01:00:00Z'),
                            commissionPaid: false
                        }
                    ]
                }
            ];

            prismaMock.user.findMany.mockResolvedValue(mockReps as any);
            prismaMock.order.count.mockResolvedValue(50);

            const performance = await analyticsService.getRepPerformance();

            expect(performance[0].totalAssigned).toBe(1); // Only today's orders
            expect(performance[0].completed).toBe(1);
            expect(performance[0].revenue).toBe(100);
            expect(performance[0].pending).toBe(50); // All-time pending
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty results with MTD filter', async () => {

            prismaMock.order.count.mockResolvedValue(0);
            prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: null } } as any);
            prismaMock.user.count.mockResolvedValue(0);
            prismaMock.delivery.findMany.mockResolvedValue([]);

            const metrics = await analyticsService.getDashboardMetrics();

            expect(metrics.totalOrders).toBe(0);
            expect(metrics.deliveredOrders).toBe(0);
            expect(metrics.totalRevenue).toBe(0);
            expect(metrics.pendingOrders).toBe(0);
        });

        it('should handle partial date range (only startDate)', async () => {
            prismaMock.order.count.mockResolvedValue(25);
            prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: 2500 } } as any);
            prismaMock.user.count.mockResolvedValue(5);
            prismaMock.delivery.findMany.mockResolvedValue([]);

            const metrics = await analyticsService.getDashboardMetrics({
                startDate: '2026-01-01'
            });

            // Should use custom filter when startDate is provided
            const orderCountCall = prismaMock.order.count.mock.calls[0];
            expect(orderCountCall[0].where.createdAt).toBeDefined();
            expect(orderCountCall[0].where.createdAt.gte).toBeDefined();
        });

        it('should handle partial date range (only endDate)', async () => {
            prismaMock.order.count.mockResolvedValue(30);
            prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: 3000 } } as any);
            prismaMock.user.count.mockResolvedValue(5);
            prismaMock.delivery.findMany.mockResolvedValue([]);

            const metrics = await analyticsService.getDashboardMetrics({
                endDate: '2026-01-31'
            });

            // Should use custom filter when endDate is provided
            const orderCountCall = prismaMock.order.count.mock.calls[0];
            expect(orderCountCall[0].where.createdAt).toBeDefined();
            expect(orderCountCall[0].where.createdAt.lte).toBeDefined();
        });
    });
});
