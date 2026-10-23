import { Prisma } from '@prisma/client';
import { getTenantId, resolveTenantId, runInTenant, withoutTenant } from '../utils/tenantContext';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { getPaymentProvider, normalizeMethod } from './payments';
import { digitalDeliveryService } from './digitalDeliveryService';
import { GLAutomationService } from './glAutomationService';
import { transitionOrder } from './orderStateMachine';
import { metaCapiService } from './metaCapiService';
import { emitOrderCreatedEvent } from '../utils/appEvents';
import { emitOrderCreated } from '../sockets';
import { getSocketInstance } from '../utils/socketInstance';
import * as Money from '../utils/money';
import { cleanText, deliveryAddressOf } from '../utils/checkoutLocation';

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
  // Settlement always runs scoped to one tenant: the webhook's tenant, the signed-in
  // caller's tenant, or (public verify, no context) the tenant that owns the
  // reference, found by a minimal unscoped lookup of the pending checkout / order.
  let tenantId = opts.webhookTenantId ?? getTenantId();
  if (!tenantId) {
    tenantId = await withoutTenant('paystack-verify', async () => {
      const pendingRow = await prisma.pendingCheckout.findUnique({ where: { reference }, select: { tenantId: true } });
      if (pendingRow) return pendingRow.tenantId;
      const orderRow = await prisma.order.findFirst({ where: { paymentReference: reference }, select: { tenantId: true } });
      return orderRow?.tenantId ?? null;
    });
    if (!tenantId) {
      return { status: 'not_found' };
    }
  }
  return runInTenant(tenantId, () => settleInTenant(reference, opts));
}

async function settleInTenant(
  reference: string,
  opts: { webhookTenantId?: string },
): Promise<SettlementResult> {
  // Reference lookups are scoped to the webhook's tenant when we have one, so a
  // cross-account reference collision can never resolve another tenant's order.
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

  // Verify with the provider that holds this payment, using the tenant's keys.
  const provider = getPaymentProvider(pending.provider);
  const verification = await provider.verify(pending.tenantId, reference);
  if (verification.status !== 'success') {
    logger.info('Payment not successful — no order created', {
      reference,
      provider: provider.id,
      tenantId: pending.tenantId,
      status: verification.status,
    });
    return { status: verification.status === 'failed' ? 'failed' : 'pending' };
  }

  // SECURITY: the provider must have charged in the currency we asked for, and the amount must cover the
  // expected charge (deposit portion or full total). Stops an underpaid/tampered initialize from fulfilling —
  // digital products auto-deliver. Minor against minor: the stored charge and the provider's figure use the provider's own unit.
  if (verification.currency !== pending.currency) {
    logger.warn('Payment currency mismatch — not creating order', {
      reference,
      provider: provider.id,
      paidCurrency: verification.currency,
      expectedCurrency: pending.currency,
    });
    return { status: 'failed' };
  }
  const paid = verification.amount;
  if (verification.amountMinor < pending.paystackChargeMinor) {
    logger.warn('Payment underpayment — not creating order', {
      reference,
      provider: provider.id,
      paidMinor: verification.amountMinor,
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

  // Order money is in major units (F-405); the adapter already converted the provider's amounts.
  const providerFee = provider.fee(verification);
  // Pending rows saved before the neutral names shipped still say paystack_*; the order gets the neutral name.
  const method = normalizeMethod(pending.paymentMethod) ?? 'online_full';
  const isDeposit = method === 'online_deposit';
  const formData = pending.formData as Record<string, any>;

  const order = await prisma.order.create({
    data: {
      customerId: pending.customerId,
      status: 'confirmed',
      paymentStatus: isDeposit ? 'deposited' : 'paid',
      orderType: pending.orderType,
      paymentMethod: method,
      subtotal: pending.subtotal,
      shippingCost: pending.shippingCost,
      discount: pending.discount,
      totalAmount: pending.totalAmount,
      codAmount: pending.codAmount,
      balanceDue: pending.balanceDue,
      depositPaid: paid,
      paymentReference: reference,
      paymentProvider: provider.id,
      deliveryAddress: deliveryAddressOf(formData.address, formData.landmark),
      deliveryState: formData.state || null,
      deliveryArea: cleanText(formData.town, 100) || null,
      notes: formData.notes || null,
      source: 'checkout_form',
      tenantId: pending.tenantId,
      // Carry the Meta click ids captured at checkout so the Paystack Purchase CAPI
      // event gets the same match keys as a COD order (see metaCapiService).
      fbp: pending.fbp,
      fbc: pending.fbc,
      orderItems: { create: pending.orderItems as Prisma.OrderItemCreateManyOrderInput[] },
    },
    include: { customer: true, orderItems: { include: { product: true } } },
  });

  // Form submission, customer totals, transaction + history — the records the
  // COD path writes at creation, written here now that payment is confirmed.
  await prisma.formSubmission.create({
    data: {
      tenantId: resolveTenantId(pending.tenantId),
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
        amount: paid,
        paymentMethod: provider.id,
        provider: provider.id,
        status: 'paid',
        reference,
        metadata: {
          currency: verification.currency,
          fees: Money.toApi(providerFee),
          paystackReference: reference, // old key, kept for readers of past rows
          providerReference: reference,
        },
      },
    });

    await tx.orderHistory.create({
      data: {
        tenantId: resolveTenantId(order.tenantId),
        orderId: order.id,
        status: 'confirmed',
        notes: `Payment confirmed via ${provider.displayName} (ref: ${reference})`,
      },
    });

    if (order.orderType === 'digital') {
      try {
        const glService = new GLAutomationService();
        await glService.createDigitalSaleEntry(
          tx as any,
          order.id,
          paid,
          providerFee,
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

  logger.info('Payment settled — order created', {
    tenantId: pending.tenantId,
    orderId: order.id,
    reference,
    amount: Money.toApi(paid),
  });

  // Workflows + realtime, now that the order exists.
  emitOrderCreatedEvent(order);
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
      // deliveryDate is the revenue date (F-901): the settle time (COD-9).
      await transitionOrder(order.id, 'digital_delivered', { kind: 'system' }, {
        note: 'Download link sent to customer',
        deliveryDate: new Date(),
      });
      order.status = 'digital_delivered';
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
            tenantId: resolveTenantId(order.tenantId),
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
