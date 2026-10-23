import { FailureReason, OrderStatus } from '@prisma/client';
import { TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';

/**
 * Delivery attempts (F-713, M4-T20). Called by the order state machine in the move's transaction: each move to
 * `failed_delivery` writes one DeliveryAttempt row (a reschedule is a failed attempt with reason `rescheduled`, D3).
 * A repeated call with the same status is not a move, so it never gets here and writes nothing twice.
 * An order with no partner has nobody to record the attempt against and writes no row.
 * `Delivery.deliveryAttempts` is kept equal to the number of rows.
 */
export async function recordDeliveryAttempt(
  tx: TransactionClient,
  order: { id: number; tenantId?: string | null; deliveryAgentId?: number | null },
  to: OrderStatus,
  options: { failureReason?: FailureReason; note?: string },
): Promise<void> {
  if (to !== 'failed_delivery' || order.deliveryAgentId == null) return;
  await tx.deliveryAttempt.create({
    data: {
      tenantId: resolveTenantId(order.tenantId),
      orderId: order.id,
      partnerUserId: order.deliveryAgentId,
      attemptedAt: new Date(),
      reason: options.failureReason ?? null,
      note: options.note ?? null,
    },
  });
  const attempts = await tx.deliveryAttempt.count({ where: { orderId: order.id } });
  await tx.delivery.updateMany({ where: { orderId: order.id }, data: { deliveryAttempts: attempts } });
}
