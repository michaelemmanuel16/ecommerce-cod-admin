import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { OrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAutomationService } from './glAutomationService';
import * as Money from '../utils/money';

export interface PendingPayment {
    orderId: number;
    totalAmount: Money.Money;
    commissionAmount: Money.Money;
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
            select: { commissionAmount: true }
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

        const commissionAmount = Money.orZero(rep.commissionAmount);

        return pendingOrders.map(order => ({
            orderId: order.id,
            totalAmount: order.totalAmount,
            commissionAmount: commissionAmount,
            customerName: `${order.customer.firstName} ${order.customer.lastName}`,
            deliveredAt: order.delivery?.actualDeliveryTime || order.updatedAt
        }));
    }

    /**
     * Get payout history for a rep
     */
    async getPayoutHistory(repId: number) {
        return prisma.payout.findMany({
            where: { payeeId: repId },
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
        amount: Decimal.Value;
        method: string;
        orderIds: number[];
        notes?: string;
        processedBy: number;
    }) {
        const { repId, amount, method, orderIds, notes, processedBy } = data;

        const payoutAmount = Money.parse(amount);

        return prisma.$transaction(async (tx) => {
            // 1. Create the Payout record
            const rep = await tx.user.findUnique({ where: { id: repId }, select: { tenantId: true } });
            const payout = await tx.payout.create({
                data: {
                    tenantId: resolveTenantId(rep?.tenantId),
                    payeeId: repId,
                    amount: payoutAmount,
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

            // 3. Post GL journal entry: DR Commissions Payable, CR Cash in Hand
            await GLAutomationService.recordCommissionPayout(
                tx as any,
                payout.id,
                repId,
                payoutAmount,
                processedBy
            );

            return payout;
        });
    }
}

export default new PayoutService();
