import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import payoutService from '../../services/payoutService';
import { OrderStatus } from '@prisma/client';
import { GLAutomationService } from '../../services/glAutomationService';

jest.mock('../../services/glAutomationService', () => ({
    GLAutomationService: {
        recordCommissionPayout: jest.fn().mockResolvedValue({ id: 1, transactions: [] })
    }
}));

describe('PayoutService', () => {
    const repId = 1001;

    describe('getPendingPayments', () => {
        it('should return pending payments for a valid representative', async () => {
            const mockRep = { id: repId, commissionAmount: 10 };
            const mockOrders = [
                {
                    id: 1,
                    totalAmount: 100,
                    updatedAt: new Date(),
                    customer: { firstName: 'John', lastName: 'Doe' },
                    delivery: { actualDeliveryTime: new Date() }
                }
            ];

            (prismaMock.user.findUnique as any).mockResolvedValue(mockRep as any);
            (prismaMock.order.findMany as any).mockResolvedValue(mockOrders as any);

            const result = await payoutService.getPendingPayments(repId);

            expect(result).toHaveLength(1);
            expect(result[0].customerName).toBe('John Doe');
            expect(result[0].commissionAmount).toBe(10);
            expect(prismaMock.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: {
                    customerRepId: repId,
                    status: OrderStatus.delivered,
                    commissionPaid: false
                }
            }));
        });

        it('should throw error if representative not found', async () => {
            (prismaMock.user.findUnique as any).mockResolvedValue(null);

            await expect(payoutService.getPendingPayments(repId))
                .rejects.toThrow('Representative not found');
        });

        it('should use updatedAt if actualDeliveryTime is missing', async () => {
            const mockRep = { id: repId, commissionAmount: 10 };
            const updatedAt = new Date('2024-01-01');
            const mockOrders = [
                {
                    id: 1,
                    totalAmount: 100,
                    updatedAt,
                    customer: { firstName: 'John', lastName: 'Doe' },
                    delivery: null
                }
            ];

            prismaMock.user.findUnique.mockResolvedValue(mockRep as any);
            prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

            const result = await payoutService.getPendingPayments(repId);

            expect(result[0].deliveredAt).toEqual(updatedAt);
        });
    });

    describe('getPayoutHistory', () => {
        it('should return payout history for a representative', async () => {
            const mockPayouts = [
                { id: 1, amount: 500, repId, payoutDate: new Date(), _count: { orders: 5 } }
            ];

            (prismaMock.payout.findMany as any).mockResolvedValue(mockPayouts as any);

            const result = await payoutService.getPayoutHistory(repId);

            expect(result).toHaveLength(1);
            expect(result[0].amount).toBe(500);
            expect(prismaMock.payout.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { repId }
            }));
        });
    });

    describe('processPayout', () => {
        it('should process a payout within a transaction', async () => {
            const payoutData = {
                repId,
                amount: 300,
                method: 'Mobile Money',
                orderIds: [1, 2, 3],
                notes: 'Monthly payout',
                processedBy: 99
            };

            const mockPayout = { id: 50, ...payoutData };

            (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
                return callback(prismaMock);
            });

            (prismaMock.payout.create as any).mockResolvedValue(mockPayout as any);
            (prismaMock.order.updateMany as any).mockResolvedValue({ count: 3 } as any);

            const result = await payoutService.processPayout(payoutData);

            expect(result).toEqual(mockPayout);
            expect(prismaMock.payout.create).toHaveBeenCalled();
            expect(prismaMock.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: {
                    id: { in: payoutData.orderIds },
                    customerRepId: repId
                },
                data: {
                    commissionPaid: true,
                    payoutId: 50
                }
            }));
            expect(GLAutomationService.recordCommissionPayout).toHaveBeenCalledTimes(1);
        });
    });
});
