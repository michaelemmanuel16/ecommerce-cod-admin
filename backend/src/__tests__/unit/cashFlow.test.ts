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

describe('FinancialService Cash Flow Report', () => {
    let financialService: FinancialService;

    beforeEach(() => {
        financialService = new FinancialService();
        jest.clearAllMocks();
    });

    describe('getCashFlowReport', () => {
        it('should calculate cash flow report correctly', async () => {
            // Mock GL Account lookups
            prismaMock.account.findUnique.mockImplementation(({ where }: any) => {
                if (where.code === GL_ACCOUNTS.CASH_IN_HAND) {
                    return Promise.resolve({ code: GL_ACCOUNTS.CASH_IN_HAND, currentBalance: 1000 }) as any;
                }
                if (where.code === GL_ACCOUNTS.CASH_IN_TRANSIT) {
                    return Promise.resolve({ code: GL_ACCOUNTS.CASH_IN_TRANSIT, currentBalance: 2000 }) as any;
                }
                if (where.code === GL_ACCOUNTS.AR_AGENTS) {
                    return Promise.resolve({ code: GL_ACCOUNTS.AR_AGENTS, currentBalance: 3000 }) as any;
                }
                return Promise.resolve(null);
            });

            // Mock out-for-delivery orders
            prismaMock.order.aggregate.mockResolvedValue({
                _sum: { totalAmount: 4000 }
            } as any);

            // Mock historical data for forecast
            prismaMock.transaction.aggregate.mockResolvedValue({
                _sum: { amount: 30000 } // Total collections last 30 days
            } as any);
            prismaMock.expense.aggregate.mockResolvedValue({
                _sum: { amount: 15000 } // Total expenses last 30 days
            } as any);

            // Mock agent holdings (using prisma.transaction.findMany as per implementation)
            prismaMock.transaction.findMany.mockResolvedValue([
                {
                    id: 't1',
                    amount: 500,
                    createdAt: new Date(),
                    order: {
                        deliveryAgent: { id: 1, firstName: 'Agent', lastName: 'One', email: 'agent1@example.com' }
                    }
                }
            ] as any);

            const report = await financialService.getCashFlowReport();

            expect(report.kpis.cashInHand).toBe(1000);
            expect(report.kpis.cashInTransit).toBe(2000);
            expect(report.kpis.arAgents).toBe(3000);
            expect(report.kpis.cashExpected).toBe(4000);
            expect(report.kpis.totalCashPosition).toBe(10000);
            expect(report.forecast).toHaveLength(30);
            expect(report.agentBreakdown).toHaveLength(1);
        });
    });

    describe('generateCashFlowForecast', () => {
        it('should generate a 30-day forecast based on daily averages', async () => {
            // Mock historical totals (30000 collection / 30 = 1000/day, 15000 expense / 30 = 500/day)
            prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: 30000 } } as any);
            prismaMock.expense.aggregate.mockResolvedValue({ _sum: { amount: 15000 } } as any);

            // Starting liquidity (In Hand + In Transit) = 1000 + 2000 = 3000
            prismaMock.account.findUnique.mockImplementation(({ where }: any) => {
                if (where.code === GL_ACCOUNTS.CASH_IN_HAND) return Promise.resolve({ currentBalance: 1000 }) as any;
                if (where.code === GL_ACCOUNTS.CASH_IN_TRANSIT) return Promise.resolve({ currentBalance: 2000 }) as any;
                return Promise.resolve(null);
            });

            const forecast = await financialService.generateCashFlowForecast();

            expect(forecast).toHaveLength(30);

            // Day 1: 3000 + (1000 - 500) = 3500
            expect(forecast[0].projectedBalance).toBe(3500);
            expect(forecast[0].expectedCollection).toBe(1000);
            expect(forecast[0].expectedExpense).toBe(500);

            // Day 30: 3000 + 30 * (1000 - 500) = 18000
            expect(forecast[29].projectedBalance).toBe(18000);
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
});
