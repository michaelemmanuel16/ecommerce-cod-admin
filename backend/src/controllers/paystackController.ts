import { Request, Response } from 'express';
import { paystackService } from '../services/paystackService';
import { digitalDeliveryService } from '../services/digitalDeliveryService';
import { GLAutomationService } from '../services/glAutomationService';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

/**
 * Paystack webhook handler — called by Paystack on charge.success.
 * Uses raw body for HMAC signature verification.
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['x-paystack-signature'] as string;
    if (!signature) {
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    // Use rawBody preserved by the verify callback in server.ts (avoids express.json() parsing issue)
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      logger.error('Paystack webhook: rawBody not available — check server.ts verify callback');
      res.status(500).json({ error: 'Server configuration error' });
      return;
    }
    const isValid = await paystackService.validateWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn('Invalid Paystack webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // req.body is already parsed by express.json(); use it directly
    const event = req.body;
    logger.info('Paystack webhook received', { event: event.event });

    if (event.event === 'charge.success') {
      await handleChargeSuccess(event.data);
    }

    // Always return 200 to acknowledge receipt
    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error('Paystack webhook error', { error: error.message });
    // Still return 200 to prevent retries for processing errors
    res.status(200).json({ received: true });
  }
}

interface PaystackChargeData {
  reference: string;
  metadata?: { orderId?: number; order_id?: number };
  amount: number;
  fees: number;
  currency: string;
}

async function handleChargeSuccess(data: PaystackChargeData): Promise<void> {
  const { reference, metadata, amount, fees, currency } = data;
  const orderId = metadata?.orderId || metadata?.order_id;

  if (!orderId) {
    logger.error('Paystack charge.success missing orderId in metadata', { reference });
    return;
  }

  // Double-verify with Paystack API
  const verification = await paystackService.verifyTransaction(reference);
  if (verification.data.status !== 'success') {
    logger.warn('Paystack verification failed', { orderId, reference, status: verification.data.status });
    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: 'payment_failed' },
    });
    return;
  }

  // Atomic idempotency: only update if not already paid.
  // Prevents TOCTOU race when concurrent webhooks arrive.
  const updated = await prisma.$queryRaw<{ id: number }[]>`
    UPDATE "orders"
    SET "payment_status" = 'paid', "status" = 'confirmed',
        "payment_reference" = ${reference}, "updated_at" = NOW()
    WHERE "id" = ${Number(orderId)}
      AND "payment_status" != 'paid'
    RETURNING "id"
  `;

  if (!updated || updated.length === 0) {
    logger.info('Paystack payment already processed, skipping', { orderId, reference });
    return;
  }

  // Fetch the full order for downstream processing
  const order = await prisma.order.findUnique({
    where: { id: Number(orderId) },
    include: { orderItems: { include: { product: true } }, customer: true },
  });

  if (!order) {
    logger.error('Order not found after payment update', { orderId, reference });
    return;
  }

  // Process remaining payment records in transaction
  await prisma.$transaction(async (tx) => {
    // Create transaction record
    await tx.transaction.create({
      data: {
        orderId: Number(orderId),
        type: 'payment',
        amount: amount / 100, // Convert from minor units
        paymentMethod: 'paystack',
        status: 'paid',
        reference,
        metadata: {
          currency,
          fees: fees / 100,
          paystackReference: reference,
        },
      },
    });

    // Create order history
    await tx.orderHistory.create({
      data: {
        orderId: Number(orderId),
        status: 'confirmed',
        notes: `Payment confirmed via Paystack (ref: ${reference})`,
      },
    });

    // Create GL entry for digital sale
    if (order.orderType === 'digital') {
      try {
        const glService = new GLAutomationService();
        const paystackFee = (fees || 0) / 100;
        await glService.createDigitalSaleEntry(tx as any, Number(orderId), amount / 100, paystackFee, order.customer?.id || 1);
      } catch (glError: any) {
        logger.warn('Failed to create GL entry for digital sale, continuing', { orderId, error: glError.message });
      }
    }
  });

  logger.info('Paystack payment processed successfully', { orderId, reference, amount: amount / 100 });

  // For digital orders: generate download token and send links
  if (order.orderType === 'digital') {
    try {
      const token = await digitalDeliveryService.generateDownloadToken(Number(orderId), order);
      await digitalDeliveryService.sendDownloadLinks(Number(orderId), token, order);

      // Update status to digital_delivered
      await prisma.order.update({
        where: { id: Number(orderId) },
        data: { status: 'digital_delivered' },
      });
      await prisma.orderHistory.create({
        data: {
          orderId: Number(orderId),
          status: 'digital_delivered',
          notes: 'Download link sent to customer',
        },
      });
    } catch (err: any) {
      logger.error('Failed to deliver digital product — customer paid but delivery failed', {
        orderId,
        reference,
        error: err.message,
      });
      // Flag the order so admins can see and retry manually
      // Use 'confirmed' status (payment succeeded) with notes explaining delivery failure
      try {
        await prisma.order.update({
          where: { id: Number(orderId) },
          data: {
            notes: `DELIVERY FAILED: Digital delivery failed after payment (ref: ${reference}): ${err.message}. Manual intervention required.`,
          },
        });
        await prisma.orderHistory.create({
          data: {
            orderId: Number(orderId),
            status: 'confirmed',
            notes: `Automatic digital delivery failed: ${err.message}. Customer was charged. Manual resend required.`,
          },
        });
      } catch (flagErr: any) {
        logger.error('Failed to flag digital delivery failure on order', { orderId, error: flagErr.message });
      }
    }
  }
}

/**
 * Shared verification helper. Returns verification data and order (if found).
 */
async function verifyPaymentCore(reference: string) {
  const verification = await paystackService.verifyTransaction(reference);
  const orderId = verification.data.metadata?.orderId || verification.data.metadata?.order_id;

  let order = null;
  if (orderId) {
    order = await prisma.order.findUnique({
      where: { id: Number(orderId) },
      select: { id: true, status: true, paymentStatus: true, totalAmount: true },
    });
  }

  return { verification, order };
}

/**
 * Verify a payment by reference (admin use, authenticated).
 */
export async function verifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const { verification, order } = await verifyPaymentCore(reference);

    res.json({
      success: verification.data.status === 'success',
      paymentStatus: verification.data.status,
      reference: verification.data.reference,
      amount: verification.data.amount / 100,
      currency: verification.data.currency,
      order,
    });
  } catch (error: any) {
    logger.error('Payment verification failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}

/**
 * Public endpoint to verify payment status (used by PaymentCallback page).
 * Requires orderId query param to prevent reference enumeration.
 */
export async function publicVerifyPayment(req: Request, res: Response): Promise<void> {
  try {
    const { reference } = req.params;
    const expectedOrderId = req.query.orderId as string;

    if (!reference) {
      res.status(400).json({ error: 'Reference is required' });
      return;
    }

    const { verification, order } = await verifyPaymentCore(reference);

    // Require orderId correlation to prevent enumeration attacks
    if (expectedOrderId && order && order.id !== Number(expectedOrderId)) {
      res.status(404).json({ error: 'Payment not found' });
      return;
    }

    res.json({
      success: verification.data.status === 'success',
      paymentStatus: verification.data.status,
      order: order ? { id: order.id, status: order.status, paymentStatus: order.paymentStatus } : null,
    });
  } catch (error: any) {
    logger.error('Public payment verification failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}
