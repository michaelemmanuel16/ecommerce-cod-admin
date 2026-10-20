import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/kpi/revenue');
jest.mock('../../services/kpi/rates', () => ({ ...jest.requireActual<object>('../../services/kpi/rates'), rates: jest.fn() }));
jest.mock('../../services/kpi/reps');

import { prismaMock } from '../mocks/prisma.mock';
import { useTestTenant } from '../mocks/tenant.mock';
import { ratesResult, repRatesResult, repRevenueResult, revenueResult } from '../mocks/kpiResults';
import { AnalyticsService } from '../../services/analyticsService';
import { deliveredRevenue, deliveredRevenueByRep } from '../../services/kpi/revenue';
import { rates } from '../../services/kpi/rates';
import { repRates } from '../../services/kpi/reps';

const mocked = <T extends (...args: any[]) => any>(fn: T) => fn as unknown as jest.MockedFunction<T>;

// The store zone is Africa/Accra (UTC+0), so a store-zone month start is the UTC month start.
const monthStartNow = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
};

describe('AnalyticsService - Month-to-Date Filtering', () => {
    let analyticsService: AnalyticsService;
    useTestTenant();

    beforeEach(() => {
        analyticsService = new AnalyticsService();
    });

    describe('getDashboardMetrics - MTD Filtering', () => {
        beforeEach(() => {
            prismaMock.order.count.mockResolvedValueOnce(10).mockResolvedValueOnce(2).mockResolvedValueOnce(154);
            mocked(deliveredRevenue).mockResolvedValue(revenueResult('1000.00', 7));
            mocked(rates).mockResolvedValue(ratesResult(70, 60, 30));
            prismaMock.user.count.mockResolvedValue(5);
            prismaMock.delivery.findMany.mockResolvedValue([]);
        });

        it('should apply month-to-date filter by default (no custom dates)', async () => {
            const metrics = await analyticsService.getDashboardMetrics();

            expect(metrics.totalOrders).toBe(10);
            expect(metrics.deliveredOrders).toBe(7);
            expect(metrics.totalRevenue).toBe('1000.00');
            expect(metrics.pendingOrders).toBe(154);

            const createdAt = (prismaMock.order.count.mock.calls[0][0] as any).where.createdAt;
            expect(createdAt.gte).toEqual(monthStartNow());
            expect(createdAt.lt).toBeInstanceOf(Date);
            const [, from, to] = mocked(deliveredRevenue).mock.calls[0];
            expect(from).toEqual(monthStartNow());
            expect(to).toBeInstanceOf(Date);

            // Pending orders have no date filter (only a status filter)
            const pendingWhere = (prismaMock.order.count.mock.calls[2][0] as any).where;
            expect(pendingWhere.createdAt).toBeUndefined();
            expect(pendingWhere.status).toBe('pending_confirmation');
        });

        it('should override MTD filter when custom date range provided', async () => {
            await analyticsService.getDashboardMetrics({ startDate: '2026-01-01', endDate: '2026-01-31' });

            const createdAt = (prismaMock.order.count.mock.calls[0][0] as any).where.createdAt;
            expect(createdAt.gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
            expect(createdAt.lt).toEqual(new Date('2026-02-01T00:00:00.000Z')); // 31 Jan is included
            const [, from, to] = mocked(deliveredRevenue).mock.calls[0];
            expect([from, to]).toEqual([createdAt.gte, createdAt.lt]);
        });

        it('should keep pending orders unfiltered even with custom date range', async () => {
            await analyticsService.getDashboardMetrics({ startDate: '2026-01-01', endDate: '2026-01-31' });

            const pendingWhere = (prismaMock.order.count.mock.calls[2][0] as any).where;
            expect(pendingWhere.createdAt).toBeUndefined();
            expect(pendingWhere.deletedAt).toBeNull();
            expect(pendingWhere.status).toBe('pending_confirmation');
        });
    });

    describe('getRepPerformance - MTD Filtering', () => {
        beforeEach(() => {
            prismaMock.user.findMany.mockResolvedValue([{ id: 1, firstName: 'John', lastName: 'Doe' }] as any);
            mocked(repRates).mockResolvedValue(repRatesResult({
                1: { placed: 2, confirmed: 1, confirmationRate: 50, deliveredFromConfirmedRate: 100 },
            }));
            mocked(deliveredRevenueByRep).mockResolvedValue(repRevenueResult({ 1: { revenue: '100.00', deliveredOrders: 1 } }));
            prismaMock.order.groupBy
                .mockResolvedValueOnce([{ customerRepId: 1, _count: { _all: 154 } }] as any)
                .mockResolvedValueOnce([{ customerRepId: 1, _count: { _all: 5 } }] as any);
        });

        it('should apply month-to-date filter by default', async () => {
            const [row] = await analyticsService.getRepPerformance();

            expect(row.totalAssigned).toBe(2);
            expect(row.completed).toBe(1);
            expect(row.revenue).toBe('100.00');
            expect(row.pending).toBe(154); // All-time pending
            expect(row.unpaidDeliveredOrders).toBe(5); // All-time unpaid count
            const [, from, to] = mocked(repRates).mock.calls[0];
            expect(from).toEqual(monthStartNow());
            expect(to).toBeInstanceOf(Date);
            expect(mocked(deliveredRevenueByRep).mock.calls[0].slice(1, 3)).toEqual([from, to]);
        });

        it('should override MTD filter when custom date range provided', async () => {
            await analyticsService.getRepPerformance({ startDate: '2026-01-01', endDate: '2026-01-31' });

            const [, from, to] = mocked(repRates).mock.calls[0];
            expect(from).toEqual(new Date('2026-01-01T00:00:00.000Z'));
            expect(to).toEqual(new Date('2026-02-01T00:00:00.000Z'));
        });

        it('should fetch pending orders separately without date filter', async () => {
            await analyticsService.getRepPerformance({ startDate: '2026-01-01', endDate: '2026-01-31' });

            const where = (prismaMock.order.groupBy.mock.calls[0][0] as any).where;
            expect(where.customerRepId).toEqual({ in: [1] });
            expect(where.status.notIn).toEqual(['delivered', 'cancelled', 'returned', 'failed_delivery']);
            expect(where.deletedAt).toBeNull();
            expect(where.createdAt).toBeUndefined();
        });

        it('should fetch all-time unpaid delivered orders regardless of date filter', async () => {
            await analyticsService.getRepPerformance({ startDate: '2026-01-01', endDate: '2026-01-31' });

            const where = (prismaMock.order.groupBy.mock.calls[1][0] as any).where;
            expect(where.status).toBe('delivered');
            expect(where.commissionPaid).toBe(false);
            expect(where.createdAt).toBeUndefined();
            expect(where.deliveryDate).toBeUndefined();
        });
    });

    describe('Edge Cases', () => {
        beforeEach(() => {
            prismaMock.order.count.mockResolvedValue(0);
            mocked(deliveredRevenue).mockResolvedValue(revenueResult('0.00', 0));
            mocked(rates).mockResolvedValue(ratesResult(null, null, null));
            prismaMock.user.count.mockResolvedValue(0);
            prismaMock.delivery.findMany.mockResolvedValue([]);
        });

        it('should handle empty results with MTD filter', async () => {
            const metrics = await analyticsService.getDashboardMetrics();

            expect(metrics.totalOrders).toBe(0);
            expect(metrics.deliveredOrders).toBe(0);
            expect(metrics.totalRevenue).toBe('0.00');
            expect(metrics.pendingOrders).toBe(0);
        });

        it('should handle partial date range (only startDate)', async () => {
            await analyticsService.getDashboardMetrics({ startDate: '2026-01-15' });

            const createdAt = (prismaMock.order.count.mock.calls[0][0] as any).where.createdAt;
            expect(createdAt.gte).toEqual(new Date('2026-01-15T00:00:00.000Z'));
            expect(createdAt.lt).toBeInstanceOf(Date);
        });

        it('should handle partial date range (only endDate)', async () => {
            await analyticsService.getDashboardMetrics({ endDate: '2026-01-15' });

            const createdAt = (prismaMock.order.count.mock.calls[0][0] as any).where.createdAt;
            expect(createdAt.gte).toEqual(monthStartNow());
            expect(createdAt.lt).toEqual(new Date('2026-01-16T00:00:00.000Z'));
        });
    });
});
