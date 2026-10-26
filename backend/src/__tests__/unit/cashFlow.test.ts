import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
    const m = {
        emit: jest.fn(),
        to: jest.fn(),
    };
    m.to.mockReturnValue(m);
    return { io: m };
});

import { prismaMock } from '../mocks/prisma.mock';
import { FinancialService } from '../../services/financialService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { useTestTenant } from '../mocks/tenant.mock';
import * as Money from '../../utils/money';
import { cashBuckets, partnerPayDays, buildForecast, DEFAULT_DAYS_TO_PAY, trendGrouping } from '../../services/finance/cashFlowService';

describe('FinancialService Cash Flow Report', () => {
    useTestTenant();
    let financialService: FinancialService;

    beforeEach(() => {
        financialService = new FinancialService();
        jest.clearAllMocks();
        // M5-T27: the forecast also reads open collections and settlement history (none here: default 7 days to pay).
        (prismaMock as any).agentCollection = { ...(prismaMock as any).agentCollection, findMany: jest.fn().mockResolvedValue([]) };
        (prismaMock as any).partnerSettlementLine = { findMany: jest.fn().mockResolvedValue([]) };
    });

    describe('getCashFlowReport', () => {
        it('should calculate cash flow report correctly', async () => {
            // Mock GL Account lookups
            prismaMock.account.findUnique.mockImplementation(({ where }: any) => {
                if (where.tenantId_code.code === GL_ACCOUNTS.CASH_IN_HAND) {
                    return Promise.resolve({ code: GL_ACCOUNTS.CASH_IN_HAND, currentBalance: 1000 }) as any;
                }
                if (where.tenantId_code.code === GL_ACCOUNTS.CASH_IN_TRANSIT) {
                    return Promise.resolve({ code: GL_ACCOUNTS.CASH_IN_TRANSIT, currentBalance: 2000 }) as any;
                }
                if (where.tenantId_code.code === GL_ACCOUNTS.AR_AGENTS) {
                    return Promise.resolve({ code: GL_ACCOUNTS.AR_AGENTS, currentBalance: 3000 }) as any;
                }
                return Promise.resolve(null);
            });

            // Mock operational figures from actual order status
            prismaMock.order.aggregate.mockImplementation(({ where }: any) => {
                if (where.status === 'delivered') {
                    return Promise.resolve({ _sum: { totalAmount: 2000 } }) as any;
                }
                if (where.status === 'out_for_delivery') {
                    return Promise.resolve({ _sum: { totalAmount: 4000 } }) as any;
                }
                return Promise.resolve({ _sum: { totalAmount: 0 } }) as any;
            });

            // Mock agent collections for holdings (batched groupBy queries)
            (prismaMock as any).agentCollection = {
                ...(prismaMock as any).agentCollection,
                groupBy: jest.fn().mockResolvedValue([
                    { agentId: 1, _count: { id: 3 }, _min: { collectionDate: new Date() } }
                ]),
            };

            // Mock historical data for forecast
            prismaMock.transaction.aggregate.mockResolvedValue({
                _sum: { amount: 30000 } // Total collections last 30 days
            } as any);
            prismaMock.expense.aggregate.mockResolvedValue({
                _sum: { amount: 15000 } // Total expenses last 30 days
            } as any);

            // Mock agent balances for getAgentCashHoldings
            prismaMock.agentBalance.findMany.mockResolvedValue([
                {
                    agentId: 1,
                    currentBalance: 500,
                    updatedAt: new Date(),
                    agent: { id: 1, firstName: 'Agent', lastName: 'One', email: 'agent1@example.com' }
                }
            ] as any);

            const report = await financialService.getCashFlowReport();

            expect(Money.toApi(report.kpis.cashInHand)).toBe('1000.00');
            expect(Money.toApi(report.kpis.cashInTransit)).toBe('2000.00');
            expect(Money.toApi(report.kpis.outstandingReceivables)).toBe('3000.00');
            expect(Money.toApi(report.kpis.cashExpected)).toBe('4000.00');
            // M5-T27 (F-928): 1020 (3000) is not added to cash now or to the position; expected (4000) is not cash.
            expect(Money.toApi(report.kpis.cashAvailableNow)).toBe('1000.00');
            expect(Money.toApi(report.kpis.totalCashPosition)).toBe('3000.00'); // 1010 + 1015
            expect(Money.toApi(report.kpis.totalCashPipeline)).toBe('7000.00'); // position + expected
            expect(Money.toApi(report.kpis.supplierPayables)).toBe('0.00');
            expect(report.forecast).toHaveLength(30);
            expect(report.agentBreakdown).toHaveLength(1);
        });
    });

    describe('generateCashFlowForecast', () => {
        it('should generate a 30-day forecast based on daily averages', async () => {
            // Mock historical totals (30000 collection / 30 = 1000/day, 15000 expense / 30 = 500/day)
            prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: 30000 } } as any);
            prismaMock.expense.aggregate.mockResolvedValue({ _sum: { amount: 15000 } } as any);

            // Starts from cash at bank (1010) = 1000. Cash with partners (1015 = 2000) arrives later, on day 7 (no history).
            prismaMock.account.findUnique.mockImplementation(({ where }: any) => {
                if (where.tenantId_code.code === GL_ACCOUNTS.CASH_IN_HAND) return Promise.resolve({ currentBalance: 1000 }) as any;
                if (where.tenantId_code.code === GL_ACCOUNTS.CASH_IN_TRANSIT) return Promise.resolve({ currentBalance: 2000 }) as any;
                return Promise.resolve(null);
            });

            const forecast = await financialService.generateCashFlowForecast();

            expect(forecast).toHaveLength(30);

            // Day 1: no inflow before the default 7 days to pay; 1000 - 500 = 500
            expect(Money.toApi(forecast[0].projectedBalance)).toBe('500.00');
            expect(Money.toApi(forecast[0].expectedCollection)).toBe('0.00');
            expect(Money.toApi(forecast[0].expectedExpense)).toBe('500.00');
            // Day 7: partner cash (2000) lands; days 1-7 spend 3500
            expect(Money.toApi(forecast[6].expectedCollection)).toBe('2000.00');
            expect(Money.toApi(forecast[6].projectedBalance)).toBe('-500.00'); // not floored at 0
            // Day 8 on: new deliveries paid at the pace of 1000 a day; day 30 = 1000 - 30*500 + 2000 + 23*1000 = 11000
            expect(Money.toApi(forecast[7].expectedCollection)).toBe('1000.00');
            expect(Money.toApi(forecast[29].projectedBalance)).toBe('11000.00');
        });

        it('should use cache if valid', async () => {
            prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: 30000 } } as any);
            prismaMock.expense.aggregate.mockResolvedValue({ _sum: { amount: 15000 } } as any);

            await financialService.generateCashFlowForecast();
            await financialService.generateCashFlowForecast();

            // Should only call Prisma aggregation once due to caching
            expect(prismaMock.transaction.aggregate).toHaveBeenCalledTimes(1);
        });
    });

    describe('M5-T27 buckets, pay days and trend grouping', () => {
        it('cashBuckets never adds 1020 and keeps expected apart from cash', () => {
            const b = cashBuckets({ cash1010: 1000, cash1015: 2000, receivables1020: 3000, expected: 4000 });
            expect(Money.toApi(b.cashAvailableNow)).toBe('1000.00');
            expect(Money.toApi(b.totalCashPosition)).toBe('3000.00');
            expect(Money.toApi(b.totalCashPipeline)).toBe('7000.00');
            expect(Money.toApi(b.receivablesAgents)).toBe('3000.00');
        });

        it('cashBuckets of empty balances is all zeros', () => {
            const b = cashBuckets({ cash1010: 0, cash1015: 0, expected: 0 });
            expect(Money.toApi(b.totalCashPosition)).toBe('0.00');
            expect(Money.toApi(b.totalCashPipeline)).toBe('0.00');
        });

        it('pay days default to 7 with no settlement history', async () => {
            const days = await partnerPayDays();
            expect(DEFAULT_DAYS_TO_PAY).toBe(7);
            expect(days.overall).toBe(7);
            expect(days.fromHistory).toBe(false);
        });

        it('pay days come from settlement history per partner, and the forecast lands the partner cash on that day', async () => {
            const delivered = new Date('2026-10-01T00:00:00Z');
            (prismaMock as any).partnerSettlementLine.findMany.mockResolvedValue([
                { settlement: { partnerId: 5, payoutDate: new Date('2026-10-04T00:00:00Z') }, order: { deliveryDate: delivered } },
                { settlement: { partnerId: 5, payoutDate: new Date('2026-10-05T00:00:00Z') }, order: { deliveryDate: delivered } },
                { settlement: { partnerId: 6, payoutDate: new Date('2026-10-11T00:00:00Z') }, order: { deliveryDate: delivered } },
            ]);
            const days = await partnerPayDays();
            expect(days.byPartner.get(5)).toBe(3.5);
            expect(days.byPartner.get(6)).toBe(10);
            expect(days.fromHistory).toBe(true);

            const now = new Date('2026-10-10T00:00:00Z');
            prismaMock.account.findUnique.mockImplementation(({ where }: any) => Promise.resolve(
                where.tenantId_code.code === GL_ACCOUNTS.CASH_IN_TRANSIT ? { currentBalance: 2000 } : null) as any);
            prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } } as any);
            prismaMock.expense.aggregate.mockResolvedValue({ _sum: { amount: 0 } } as any);
            (prismaMock as any).agentCollection.findMany.mockResolvedValue([
                { agentId: 5, amount: 2000, allocatedAmount: 0, collectionDate: now },
            ]);
            const forecast = await buildForecast(now);
            const landed = forecast.findIndex((f) => !Money.toApi(f.expectedCollection).startsWith('0.00'));
            expect(landed + 1).toBe(4); // ceil(3.5 days) = day 4
            expect(Money.toApi(forecast[landed].expectedCollection)).toBe('2000.00');
        });

        it('groups the trend by week only over 366 days', () => {
            const start = new Date('2025-01-01T00:00:00Z');
            expect(trendGrouping(start, new Date('2026-01-01T00:00:00Z'))).toBe('day'); // 365 days
            expect(trendGrouping(start, new Date('2026-01-03T00:00:00Z'))).toBe('week'); // 367 days
        });
    });
});
