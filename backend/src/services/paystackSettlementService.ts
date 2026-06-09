import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { paystackService } from './paystackService';
import { digitalDeliveryService } from './digitalDeliveryService';
import { GLAutomationService } from './glAutomationService';
import { metaCapiService } from './metaCapiService';
import workflowService from './workflowService';
import { emitOrderCreated } from '../sockets';
import { getSocketInstance } from '../utils/socketInstance';

export type SettlementStatus = 'success' | 'failed' | 'pending' | 'not_found';

export interface SettlementResult {
  status: SettlementStatus;
  order?: Awaited<ReturnType<typeof prisma.order.findFirst>>;
}

/**
 * Settle a Paystack payment by reference.
 *
 * Deferred-creation model: a Paystack checkout never creates an Order up front —
 * it stores a {@link PendingCheckout} snapshot keyed by the Paystack reference.
 * This function is the ONLY place that turns a confirmed payment into a real
 * Order (status `confirmed`, paymentStatus `paid`/`deposited`). It is called from
 * both the webhook (`charge.success`) and the callback verify, so an order is
 * created exactly once whichever path arrives first — abandoned or failed
 * payments produce no Order at all.
 *
 * Idempotency: the PendingCheckout row is the claim token. The first caller to
 * delete it wins and creates the Order; a concurrent caller gets P2025 and
 * returns the already-created Order.
 *
 * @param reference  the Paystack transaction reference
 * @param opts.webhookTenantId  when called from a per-tenant webhook, the tenant
 *   that owns the webhook URL — must match the pending checkout's tenant.
 */
export async function settlePaystackPayment(
  reference: string,
  opts: { webhookTenantId?: string } = {},
): Promise<SettlementResult> {
  // Reference lookups are scoped to the webhook's tenant when we have one, so a
  // cross-account reference collision can never resolve another tenant's order.
  // The public/admin verify paths carry no tenant context and fall back to the
  // (Paystack-globally-unique) reference alone.
  const orderWhere: Prisma.OrderWhereInput = {
    paymentReference: reference,
    ...(opts.webhookTenantId ? { tenantId: opts.webhookTenantId } : {}),
  };

  // Fast path: already settled (also the loser-of-race path).
  const existing = await prisma.order.findFirst({
    where: orderWhere,
    include: { customer: true, orderItems: { include: { product: true } } },
  });
  if (existing) {
    return { status: 'success', order: existing };
  }

  const pending = await prisma.pendingCheckout.findUnique({ where: { reference } });
  if (!pending) {
    return { status: 'not_found' };
  }

  // Anti-cross-tenant: a webhook routed through tenant A's URL must not settle a
  // checkout that belongs to tenant B.
  if (opts.webhookTenantId && pending.tenantId !== opts.webhookTenantId) {
    logger.warn('Paystack settlement tenant mismatch — ignoring', {
      reference,
      webhookTenantId: opts.webhookTenantId,
      pendingTenantId: pending.tenantId,
    });
    return { status: 'not_found' };
  }

  // Verify with Paystack using the tenant's secret.
  const verification = await paystackService.verifyTransaction(pending.tenantId, reference);
  if (verification.data.status !== 'success') {
    logger.info('Paystack payment not successful — no order created', {
      reference,
      tenantId: pending.tenantId,
      status: verification.data.status,
    });
    return { status: verification.data.status === 'failed' ? 'failed' : 'pending' };
  }

  // SECURITY: the amount actually paid must cover the expected charge (deposit
  // portion or full total). Stops an underpaid/tampered initialize from
  // fulfilling — digital products auto-deliver. Paystack amounts are minor units.
  const paidMinor = Number(verification.data.amount ?? 0);
  if (paidMinor < pending.paystackChargeMinor) {
    logger.warn('Paystack underpayment — not creating order', {
      reference,
      paidMinor,
      expectedMinor: pending.paystackChargeMinor,
    });
    return { status: 'failed' };
  }

  // Atomic claim — only one caller deletes the pending row and creates the order.
  try {
    await prisma.pendingCheckout.delete({ where: { reference } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      const winner = await prisma.order.findFirst({
        where: orderWhere,
        include: { customer: true, orderItems: { include: { product: true } } },
      });
      return winner ? { status: 'success', order: winner } : { status: 'pending' };
    }
    throw err;
  }

  const isDeposit = pending.paymentMethod === 'paystack_deposit';
  const formData = pending.formData as Record<string, any>;

  const order = await prisma.order.create({
    data: {
      customerId: pending.customerId,
      status: 'confirmed',
      paymentStatus: isDeposit ? 'deposited' : 'paid',
      orderType: pending.orderType,
      // Digital keeps the generic 'paystack' label for back-compat; physical
      // keeps the granular deposit/full method.
      paymentMethod: pending.orderType === 'digital' ? 'paystack' : pending.paymentMethod,
      subtotal: pending.subtotal,
      shippingCost: pending.shippingCost,
      discount: pending.discount,
      totalAmount: pending.totalAmount,
      codAmount: pending.codAmount,
      balanceDue: pending.balanceDue,
      depositPaid: paidMinor,
      paymentReference: reference,
      deliveryAddress: formData.address || null,
      deliveryState: formData.state || null,
      deliveryArea: formData.state || null,
      notes: formData.notes || null,
      source: 'checkout_form',
      tenantId: pending.tenantId,
      orderItems: { create: pending.orderItems as Prisma.OrderItemCreateManyOrderInput[] },
    },
    include: { customer: true, orderItems: { include: { product: true } } },
  });

  // Form submission, customer totals, transaction + history — the records the
  // COD path writes at creation, written here now that payment is confirmed.
  await prisma.formSubmission.create({
    data: {
      formId: pending.formId,
      orderId: order.id,
      formData: pending.formData ?? Prisma.JsonNull,
      selectedPackage: pending.selectedPackage ?? Prisma.JsonNull,
      selectedUpsells: pending.selectedUpsells ?? Prisma.JsonNull,
      totalAmount: pending.totalAmount,
      ipAddress: pending.ipAddress,
      userAgent: pending.userAgent,
    },
  });

  await prisma.customer.update({
    where: { id: pending.customerId },
    data: {
      totalOrders: { increment: 1 },
      totalSpent: { increment: pending.totalAmount },
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        orderId: order.id,
        type: 'payment',
        amount: paidMinor / 100,
        paymentMethod: 'paystack',
        status: 'paid',
        reference,
        metadata: {
          currency: verification.data.currency,
          fees: Number(verification.data.fees ?? 0) / 100,
          paystackReference: reference,
        },
      },
    });

    await tx.orderHistory.create({
      data: {
        orderId: order.id,
        status: 'confirmed',
        notes: `Payment confirmed via Paystack (ref: ${reference})`,
      },
    });

    if (order.orderType === 'digital') {
      try {
        const glService = new GLAutomationService();
        const paystackFee = Number(verification.data.fees ?? 0) / 100;
        await glService.createDigitalSaleEntry(
          tx as any,
          order.id,
          paidMinor / 100,
          paystackFee,
          order.customer?.id || 1,
        );
      } catch (glError: any) {
        logger.warn('Failed to create GL entry for digital sale, continuing', {
          orderId: order.id,
          error: glError.message,
        });
      }
    }
  });

  logger.info('Paystack payment settled — order created', {
    tenantId: pending.tenantId,
    orderId: order.id,
    reference,
    amount: paidMinor / 100,
  });

  // Workflows + realtime, now that the order exists.
  workflowService.triggerOrderCreatedWorkflows(order).catch((err) => {
    logger.error('Failed to trigger workflow for settled Paystack order', {
      orderId: order.id,
      error: err?.message,
    });
  });
  emitOrderCreated(getSocketInstance() as any, order);

  // Server-side Meta Purchase event (best-effort, idempotent via capiEventFired).
  metaCapiService.fireCapiPurchaseEvent(order.id).catch((err) => {
    logger.error('Failed to fire Meta CAPI event for settled Paystack order', {
      orderId: order.id,
      error: err?.message,
    });
  });

  // Digital fulfilment.
  if (order.orderType === 'digital') {
    try {
      const token = await digitalDeliveryService.generateDownloadToken(order.id, order);
      await digitalDeliveryService.sendDownloadLinks(order.id, token, order);
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'digital_delivered' },
      });
      order.status = 'digital_delivered';
      await prisma.orderHistory.create({
        data: {
          orderId: order.id,
          status: 'digital_delivered',
          notes: 'Download link sent to customer',
        },
      });
    } catch (err: any) {
      logger.error('Digital delivery failed after payment — manual resend required', {
        orderId: order.id,
        reference,
        error: err.message,
      });
      try {
        await prisma.order.update({
          where: { id: order.id },
          data: {
            notes: `DELIVERY FAILED: Digital delivery failed after payment (ref: ${reference}): ${err.message}. Manual intervention required.`,
          },
        });
        await prisma.orderHistory.create({
          data: {
            orderId: order.id,
            status: 'confirmed',
            notes: `Automatic digital delivery failed: ${err.message}. Customer was charged. Manual resend required.`,
          },
        });
      } catch (flagErr: any) {
        logger.error('Failed to flag digital delivery failure on order', {
          orderId: order.id,
          error: flagErr.message,
        });
      }
    }
  }

  // `order` already carries the create-time include; the digital branch updated
  // its status in memory, so no extra round-trip is needed to return final state.
  return { status: 'success', order };
}
