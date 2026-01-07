import prisma from '../utils/prisma';
import { OrderStatus } from '@prisma/client';

export interface PendingPayment {
    orderId: number;
    totalAmount: number;
    commissionAmount: number;
    customerName: string;
    deliveredAt: Date;
}

/**
 * Service to handle representative payouts and pending commissions
 */
class PayoutService {
    /**
     * Get all delivered orders for a rep that haven't been paid yet
     */
    async getPendingPayments(repId: number) {
        const rep = await prisma.user.findUnique({
            where: { id: repId },
            select: { commissionRate: true }
        });

        if (!rep) throw new Error('Representative not found');

        const pendingOrders = await prisma.order.findMany({
            where: {
                customerRepId: repId,
                status: OrderStatus.delivered,
                commissionPaid: false
            },
            include: {
                customer: {
                    select: { firstName: true, lastName: true }
                },
                delivery: {
                    select: { actualDeliveryTime: true }
                }
            },
            orderBy: {
                delivery: {
                    actualDeliveryTime: 'desc'
                }
            }
        });

        const commissionRate = rep.commissionRate || 0;

        return pendingOrders.map(order => ({
            orderId: order.id,
            totalAmount: order.totalAmount,
            commissionAmount: commissionRate,
            customerName: `${order.customer.firstName} ${order.customer.lastName}`,
            deliveredAt: order.delivery?.actualDeliveryTime || order.updatedAt
        }));
    }

    /**
     * Get payout history for a rep
     */
    async getPayoutHistory(repId: number) {
        return prisma.payout.findMany({
            where: { repId },
            include: {
                _count: {
                    select: { orders: true }
                }
            },
            orderBy: {
                payoutDate: 'desc'
            }
        });
    }

    /**
     * Process a new payout for a rep
     */
    async processPayout(data: {
        repId: number;
        amount: number;
        method: string;
        orderIds: number[];
        notes?: string;
    }) {
        const { repId, amount, method, orderIds, notes } = data;

        return prisma.$transaction(async (tx) => {
            // 1. Create the Payout record
            const payout = await tx.payout.create({
                data: {
                    repId,
                    amount,
                    method,
                    notes,
                    status: 'completed'
                }
            });

            // 2. Mark orders as paid and link to payout
            await tx.order.updateMany({
                where: {
                    id: { in: orderIds },
                    customerRepId: repId
                },
                data: {
                    commissionPaid: true,
                    payoutId: payout.id
                }
            });

            return payout;
        });
    }
}

export default new PayoutService();
