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

// The scenario reads delivery success from the KPI layer; this suite is about the buckets
jest.mock('../../services/kpi/rates', () => ({ rates: async () => ({ deliverySuccessRate: { value: 48 } }) }));

import { prismaMock } from '../mocks/prisma.mock';
import { FinancialService } from '../../services/financialService';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { useTestTenant } from '../mocks/tenant.mock';
import * as Money from '../../utils/money';
import { cashBuckets, partnerPayDays, buildForecast, DEFAULT_DAYS_TO_PAY, type CashBalances } from '../../services/finance/cashFlowService';

const money = (v: number) => Money.parse(v);
const balances = (cash1010: number, cash1015: number, payables2050 = 0): CashBalances => ({ cash1010: money(cash1010), cash1015: money(cash1015), payables2050: money(payables2050) });
const NO_HISTORY = { overall: DEFAULT_DAYS_TO_PAY, fromHistory: false, byPartner: new Map<number, number>() };

describe('FinancialService Cash Flow Report', () => {
    useTestTenant();
    let financialService: FinancialService;
    const agentCollections = () => (prismaMock as any).agentCollection.findMany as jest.Mock;
    const settlementLines = () => (prismaMock as any).partnerSettlementLine.findMany as jest.Mock;

    beforeEach(() => {
        financialService = new FinancialService();
        jest.clearAllMocks();
        // The forecast reads open collections and settlement history (none here: default 7 days to pay).
        (prismaMock as any).agentCollection = { ...(prismaMock as any).agentCollection, findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) };
        (prismaMock as any).partnerSettlementLine = { findMany: jest.fn().mockResolvedValue([]) };
        prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } } as any);
        prismaMock.expense.aggregate.mockResolvedValue({ _sum: { amount: null } } as any);
        prismaMock.agentBalance.findMany.mockResolvedValue([] as any);
    });

    describe('getCashFlowReport', () => {
        it('buckets 1010 and 1015 only: 1020 is never read, expected stays out of cash', async () => {
            prismaMock.account.findMany.mockResolvedValue([
                { code: GL_ACCOUNTS.CASH_IN_HAND, currentBalance: 1000 },
                { code: GL_ACCOUNTS.CASH_IN_TRANSIT, currentBalance: 2000 },
                { code: GL_ACCOUNTS.AR_AGENTS, currentBalance: 3000 }, // would be returned by a loose query; must not count
            ] as any);
            prismaMock.order.aggregate.mockResolvedValue({ _sum: { totalAmount: 4000 } } as any);
            prismaMock.agentBalance.findMany.mockResolvedValue([
                { agentId: 1, currentBalance: 500, updatedAt: new Date(), agent: { id: 1, firstName: 'Agent', lastName: 'One', email: 'agent1@example.com' } },
            ] as any);
            (prismaMock as any).agentCollection.groupBy.mockResolvedValue([{ agentId: 1, _count: { id: 3 }, _min: { collectionDate: new Date() } }]);

            const report = await financialService.getCashFlowReport();

            expect(Money.toApi(report.kpis.cashInHand)).toBe('1000.00');
            expect(Money.toApi(report.kpis.cashInTransit)).toBe('2000.00');
            expect(Money.toApi(report.kpis.cashExpected)).toBe('4000.00');
            expect(Money.toApi(report.kpis.cashAvailableNow)).toBe('1000.00');
            expect(Money.toApi(report.kpis.totalCashPosition)).toBe('3000.00'); // 1010 + 1015
            expect(Money.toApi(report.kpis.totalCashPipeline)).toBe('7000.00'); // position + expected
            expect(Money.toApi(report.kpis.supplierPayables)).toBe('0.00');
            expect('outstandingReceivables' in report.kpis).toBe(false);
            expect(report.forecast).toHaveLength(30);
            expect(report.scenario).toEqual({ key: 'pace', currentRate: 48, targetRate: 60, multiplier: 1 });
            expect(report.summary.cashToday).toBe('1000.00'); // 1010 only
            expect(report.agentBreakdown).toHaveLength(1);
            expect(prismaMock.account.findMany).toHaveBeenCalledTimes(1); // one read for all balances
        });
    });

    describe('buildForecast', () => {
        it('starts from cash at bank; partner cash lands on the default day 7; pace starts after it; not floored at 0', async () => {
            // 30,000 collected and 15,000 spent in 30 days: 1,000 and 500 a day
            prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: 30000 } } as any);
            prismaMock.expense.aggregate.mockResolvedValue({ _sum: { amount: 15000 } } as any);

            const forecast = await buildForecast({ balances: balances(1000, 2000), payDays: NO_HISTORY });

            expect(forecast).toHaveLength(30);
            expect(Money.toApi(forecast[0].projectedBalance)).toBe('500.00'); // 1000 - 500, no inflow before day 7
            expect(Money.toApi(forecast[0].expectedCollection)).toBe('0.00');
            expect(Money.toApi(forecast[6].expectedCollection)).toBe('2000.00');
            expect(Money.toApi(forecast[6].projectedBalance)).toBe('-500.00');
            expect(Money.toApi(forecast[7].expectedCollection)).toBe('1000.00');
            // day 30 = 1000 - 30*500 + 2000 + 23*1000
            expect(Money.toApi(forecast[29].projectedBalance)).toBe('11000.00');
        });

        it('supplier payables go out on day 1 only', async () => {
            const forecast = await buildForecast({ balances: balances(1000, 0, 800), payDays: NO_HISTORY });
            expect(Money.toApi(forecast[0].expectedExpense)).toBe('800.00');
            expect(Money.toApi(forecast[1].expectedExpense)).toBe('0.00');
            expect(Money.toApi(forecast[0].projectedBalance)).toBe('200.00');
        });

        it('an open collection lands on its partner pay day from history', async () => {
            const now = new Date('2026-10-10T00:00:00Z');
            agentCollections().mockResolvedValue([{ agentId: 5, amount: 2000, allocatedAmount: 0, collectionDate: now }]);
            const forecast = await buildForecast({ balances: balances(0, 2000), payDays: { overall: 3.5, fromHistory: true, byPartner: new Map([[5, 3.5]]) }, now });
            const landed = forecast.findIndex((f) => Money.toApi(f.expectedCollection) === '2000.00');
            expect(landed + 1).toBe(4); // ceil(3.5 days) = day 4
        });
    });

    describe('partnerPayDays', () => {
        it('defaults to 7 days with no settlement history', async () => {
            const days = await partnerPayDays();
            expect(DEFAULT_DAYS_TO_PAY).toBe(7);
            expect(days).toMatchObject({ overall: 7, fromHistory: false });
        });

        it('averages per partner and overall from settled lines', async () => {
            const delivered = new Date('2026-10-01T00:00:00Z');
            const line = (partnerId: number, payout: string) => ({ settlement: { partnerId, payoutDate: new Date(payout) }, order: { deliveryDate: delivered } });
            settlementLines().mockResolvedValue([line(5, '2026-10-04T00:00:00Z'), line(5, '2026-10-05T00:00:00Z'), line(6, '2026-10-11T00:00:00Z')]);
            const days = await partnerPayDays();
            expect(days.byPartner.get(5)).toBe(3.5);
            expect(days.byPartner.get(6)).toBe(10);
            expect(days.overall).toBe(5.7); // (3 + 4 + 10) / 3
            expect(days.fromHistory).toBe(true);
        });
    });

    describe('cashBuckets', () => {
        it('keeps expected apart from cash', () => {
            const b = cashBuckets({ cash1010: 1000, cash1015: 2000, expected: 4000 });
            expect(Money.toApi(b.cashAvailableNow)).toBe('1000.00');
            expect(Money.toApi(b.totalCashPosition)).toBe('3000.00');
            expect(Money.toApi(b.totalCashPipeline)).toBe('7000.00');
        });

        it('empty balances are all zeros', () => {
            const b = cashBuckets({ cash1010: 0, cash1015: 0, expected: 0 });
            expect(Money.toApi(b.totalCashPosition)).toBe('0.00');
            expect(Money.toApi(b.totalCashPipeline)).toBe('0.00');
        });
    });
});
