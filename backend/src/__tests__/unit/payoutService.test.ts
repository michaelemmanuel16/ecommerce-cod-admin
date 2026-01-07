import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import payoutService from '../../services/payoutService';
import { OrderStatus } from '@prisma/client';

describe('PayoutService', () => {
    const repId = 1001;

    describe('getPendingPayments', () => {
        it('should return pending payments for a valid representative', async () => {
            const mockRep = { id: repId, commissionRate: 10 };
            const mockOrders = [
                {
                    id: 1,
                    totalAmount: 100,
                    updatedAt: new Date(),
                    customer: { firstName: 'John', lastName: 'Doe' },
                    delivery: { actualDeliveryTime: new Date() }
                }
            ];

            prismaMock.user.findUnique.mockResolvedValue(mockRep as any);
            prismaMock.order.findMany.mockResolvedValue(mockOrders as any);

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
            prismaMock.user.findUnique.mockResolvedValue(null);

            await expect(payoutService.getPendingPayments(repId))
                .rejects.toThrow('Representative not found');
        });

        it('should use updatedAt if actualDeliveryTime is missing', async () => {
            const mockRep = { id: repId, commissionRate: 10 };
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

            prismaMock.payout.findMany.mockResolvedValue(mockPayouts as any);

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
                notes: 'Monthly payout'
            };

            const mockPayout = { id: 50, ...payoutData };

            prismaMock.$transaction.mockImplementation(async (callback) => {
                return callback(prismaMock);
            });

            prismaMock.payout.create.mockResolvedValue(mockPayout as any);
            prismaMock.order.updateMany.mockResolvedValue({ count: 3 } as any);

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
        });
    });
});
