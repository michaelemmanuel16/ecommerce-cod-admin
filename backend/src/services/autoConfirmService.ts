import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import * as Money from '../utils/money';
import { resolveTenantId, runInTenant, withoutTenant } from '../utils/tenantContext';
import { whatsappService } from './whatsappService';
import { smsService } from './smsService';
import { AppEvent, onOrderEvent } from '../utils/appEvents';

export interface AutoConfirmResult {
  token: string;
  channel: string;
}

/**
 * Send auto-confirm message for a COD order if enabled for the tenant.
 * Exactly one send per order (guaranteed by atomic autoConfirmSentAt check).
 * No operating hours hold (P4: sends at once).
 */
export async function sendAutoConfirmForOrder(orderId: number, tenantId?: string | null): Promise<AutoConfirmResult | null> {
  const order = await withoutTenant('auto-confirm-find-order', () =>
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        orderItems: { include: { product: true } },
      },
    })
  );

  if (!order || !order.customer || order.deletedAt !== null) return null;
  const tId = resolveTenantId(order.tenantId ?? tenantId);

  return runInTenant(tId, async () => {
    // Check eligibility:
    // 1. Physical COD order
    const isCod = order.paymentMethod === 'cod' || (order.codAmount && Number(order.codAmount) > 0);
    if (order.orderType !== 'physical' || !isCod) return null;

    // 2. COD-blocked customer needing manual call does not get auto-confirm
    if (order.requiresManualCall) return null;

    // 3. Status must be pending_confirmation
    if (order.status !== 'pending_confirmation') return null;

    // 4. Exactly one send per order
    if (order.autoConfirmSentAt !== null) return null;

    // 5. Tenant settings check
    const config = await prisma.systemConfig.findUnique({
      where: { tenantId: tId },
      select: { autoConfirmEnabled: true, autoConfirmChannel: true },
    });

    if (!config?.autoConfirmEnabled) return null;

    const phone = order.customer.phoneNumber;
    if (!phone) return null;

    // Check channel opt-outs
    const targetChannel = config.autoConfirmChannel ?? 'whatsapp';
    if (targetChannel === 'whatsapp' && order.customer.whatsappOptOut) return null;
    if (targetChannel === 'sms' && order.customer.smsOptOut) return null;

    // Atomically claim the send on the order to avoid duplicate sends
    const claimed = await prisma.order.updateMany({
      where: { id: order.id, autoConfirmSentAt: null },
      data: { autoConfirmSentAt: new Date() },
    });
    if (claimed.count === 0) return null; // Another process already claimed it

    // Create ConfirmToken
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    await prisma.confirmToken.create({
      data: {
        tenantId: tId,
        orderId: order.id,
        token,
        channel: targetChannel,
        expiresAt,
      },
    });

    // Prepare message (COD-64, M7-T08)
    const customerName = `${order.customer.firstName} ${order.customer.lastName}`.trim();
    const total = Money.toApi(Money.parse(order.totalAmount));
    const currency = order.currency ?? 'GHS';
    const message = `Hello ${customerName}, thank you for your order #${order.id} of ${currency} ${total}. Reply YES to confirm it. Reply NO if you want to change or cancel, and our team will call you.`;

    if (targetChannel === 'whatsapp') {
      try {
        await whatsappService.sendText({
          to: phone,
          body: message,
          orderId: order.id,
          customerId: order.customer.id,
        });
      } catch (err: any) {
        logger.warn('Auto-confirm WhatsApp send failed, falling back to SMS', { orderId: order.id, error: err.message });
        try {
          await smsService.sendSms({
            to: phone,
            body: message,
            orderId: order.id,
            customerId: order.customer.id,
          });
        } catch (smsErr: any) {
          logger.error('Auto-confirm SMS fallback also failed', { orderId: order.id, error: smsErr.message });
        }
      }
    } else {
      try {
        await smsService.sendSms({
          to: phone,
          body: message,
          orderId: order.id,
          customerId: order.customer.id,
        });
      } catch (err: any) {
        logger.error('Auto-confirm SMS send failed', { orderId: order.id, error: err.message });
      }
    }

    return { token, channel: targetChannel };
  });
}

// Subscribe to order created events
onOrderEvent(AppEvent.ORDER_CREATED, async (evt) => {
  if (evt.imported && !evt.runWorkflows) return;
  try {
    await sendAutoConfirmForOrder(evt.orderId, evt.tenantId);
  } catch (error: any) {
    logger.error('Failed to process auto-confirm for created order', { orderId: evt.orderId, error: error?.message });
  }
});
