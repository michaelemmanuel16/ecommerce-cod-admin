import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import * as Money from '../utils/money';
import { resolveTenantId, runInTenant, withoutTenant } from '../utils/tenantContext';
import { whatsappService } from './whatsappService';
import { smsService } from './smsService';
import { fullName } from '../utils/nameUtils';

export interface AutoConfirmResult {
  token: string;
  channel: string;
}

/**
 * Send auto-confirm message for a COD order. Called by the `send_auto_confirm` workflow action.
 * Returns null when the order is not eligible (the executors map that to skipped).
 * Exactly one send per order (guaranteed by atomic autoConfirmSentAt check).
 * No operating hours hold (P4: sends at once).
 */
export async function sendAutoConfirmForOrder(
  orderId: number,
  tenantId?: string | null,
  opts: { channel?: 'whatsapp' | 'sms' } = {},
): Promise<AutoConfirmResult | null> {
  const order = await withoutTenant('auto-confirm-find-order', () =>
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            whatsappOptOut: true,
            smsOptOut: true,
          },
        },
        orderItems: {
          select: {
            id: true,
            quantity: true,
            metadata: true,
            product: { select: { name: true } },
          },
        },
      },
    })
  );

  if (!order || !order.customer || order.deletedAt !== null) return null;
  // A workflow runs in one tenant: never send for another tenant's order.
  if (tenantId && order.tenantId && order.tenantId !== tenantId) return null;
  const tId = resolveTenantId(order.tenantId ?? tenantId);

  return runInTenant(tId, async () => {
    // Check eligibility:
    // 1. Physical COD order
    const isCod = order.paymentMethod === 'cod' || (order.codAmount != null && Money.parse(order.codAmount).gt(0));
    if (order.orderType !== 'physical' || !isCod) return null;

    // 2. COD-blocked customer needing manual call does not get auto-confirm
    if (order.requiresManualCall) return null;

    // 3. Status must be pending_confirmation
    if (order.status !== 'pending_confirmation') return null;

    // 4. Exactly one send per order
    if (order.autoConfirmSentAt !== null) return null;

    // 5. Tenant name for the SMS prefix
    const [config, tenant] = await Promise.all([
      prisma.systemConfig.findUnique({
        where: { tenantId: tId },
        select: { businessName: true },
      }),
      prisma.tenant.findUnique({
        where: { id: tId },
        select: { name: true },
      }),
    ]);

    const phone = order.customer.phoneNumber;
    if (!phone) return null;

    // Check channel opt-outs
    const targetChannel = opts.channel ?? 'whatsapp';
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

    // Package label and product name (COD-193 M7-R1)
    const firstItem = order.orderItems[0];
    const productName = firstItem?.product?.name || 'Product';
    const firstItemMeta = (firstItem?.metadata ?? {}) as Record<string, any>;
    const packageName = firstItemMeta.packageName;
    let packageLabel = packageName
      ? packageName
      : `${firstItem?.quantity ?? 1} x ${productName}`;
    if (order.orderItems.length > 1) {
      const extraCount = order.orderItems.length - 1;
      packageLabel += ` + ${extraCount} more item${extraCount > 1 ? 's' : ''}`;
    }

    const customerName = fullName(order.customer);
    const customerFirstName = order.customer.firstName || 'there';
    const total = Money.toApi(Money.parse(order.totalAmount));
    const currency = order.currency ?? 'GHS';
    const formattedTotalWithSign = Money.formatWithSign(order.totalAmount, currency);

    // SMS message: plain GSM characters only, no ₵ sign
    const storeName = config?.businessName?.trim() || tenant?.name?.trim() || null;
    const storePrefix = storeName ? `${storeName}: ` : '';
    const smsMessage = `${storePrefix}Hello ${customerFirstName}, please confirm order #${order.id}, ${productName}, ${currency} ${total} on delivery. Reply YES to confirm or NO to change or cancel.`;

    if (targetChannel === 'whatsapp') {
      try {
        await whatsappService.sendTemplate({
          to: phone,
          templateName: 'order_auto_confirm',
          languageCode: 'en',
          headerParams: [productName],
          bodyParams: [
            customerName,
            packageLabel,
            String(order.id),
            formattedTotalWithSign,
          ],
          buttonPayloads: ['CONFIRM', 'CHANGE', 'CANCEL'],
          orderId: order.id,
          customerId: order.customer.id,
        });
      } catch (err: any) {
        logger.warn('Auto-confirm WhatsApp send failed, falling back to SMS', { orderId: order.id, error: err.message });
        try {
          await smsService.sendSms({
            to: phone,
            body: smsMessage,
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
          body: smsMessage,
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
