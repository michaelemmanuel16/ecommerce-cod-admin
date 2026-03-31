import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { escapeHtml } from '../utils/sanitizer';
import { sendEmail } from './emailService';
import { whatsappService } from './whatsappService';

export const digitalDeliveryService = {
  /**
   * Generate a secure download token for an order.
   */
  async generateDownloadToken(orderId: number, preloadedOrder?: any): Promise<string> {
    const order = preloadedOrder || await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { include: { product: true } } },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    // Get expiry from the first digital product (or default 72 hours)
    const digitalProduct = order.orderItems.find(
      (item: any) => item.product.productType === 'digital'
    )?.product;
    const expiryHours = digitalProduct?.downloadLinkExpiryHours ?? 72;

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    await prisma.downloadToken.create({
      data: {
        orderId,
        token,
        expiresAt,
        maxDownloads: 5,
      },
    });

    logger.info('Download token generated', { orderId, expiresAt, expiryHours });
    return token;
  },

  /**
   * Validate a download token and return the file URL if valid.
   */
  async validateAndGetDownloadUrl(token: string): Promise<{ fileUrl: string; productName: string } | null> {
    // Atomic check-and-increment: prevents TOCTOU race condition where concurrent
    // requests could exceed maxDownloads. Uses raw SQL because Prisma updateMany
    // doesn't support comparing two columns in a WHERE clause.
    const updated: { id: number; orderId: number }[] = await prisma.$queryRaw`
      UPDATE "DownloadToken"
      SET "downloadCount" = "downloadCount" + 1
      WHERE "token" = ${token}
        AND "isRevoked" = false
        AND "expiresAt" > NOW()
        AND "downloadCount" < "maxDownloads"
      RETURNING "id", "orderId"
    `;

    if (!updated || updated.length === 0) {
      logger.warn('Download token invalid, expired, revoked, or limit reached', { token: token.substring(0, 8) + '...' });
      return null;
    }

    const { orderId } = updated[0];

    // Fetch the order with digital product info
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { orderItems: { include: { product: true } } },
    });

    if (!order) {
      logger.error('Order not found for download token', { orderId });
      return null;
    }

    // Find the digital product's file URL
    const digitalItem = order.orderItems.find(
      (item: any) => item.product.productType === 'digital' && item.product.digitalFileUrl
    );

    if (!digitalItem?.product.digitalFileUrl) {
      logger.error('No digital file URL found for order', { orderId });
      return null;
    }

    return {
      fileUrl: digitalItem.product.digitalFileUrl,
      productName: digitalItem.product.name,
    };
  },

  /**
   * Send download links via email and WhatsApp.
   */
  async sendDownloadLinks(orderId: number, token: string, preloadedOrder?: any): Promise<void> {
    const order = preloadedOrder || await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        orderItems: { include: { product: true } },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    const digitalProduct = order.orderItems.find(
      (item: any) => item.product.productType === 'digital'
    )?.product;

    if (!digitalProduct) throw new Error(`No digital product in order ${orderId}`);

    const backendUrl = process.env.BACKEND_URL || process.env.FRONTEND_URL?.replace(':5173', ':3000') || 'http://localhost:3000';
    const downloadUrl = `${backendUrl}/api/public/download/${token}`;
    const expiryHours = digitalProduct.downloadLinkExpiryHours ?? 72;
    const productName = digitalProduct.name;

    // Send via email
    if (order.customer.email) {
      try {
        await sendDigitalProductEmail(
          order.customer.email,
          order.customer.firstName,
          productName,
          downloadUrl,
          expiryHours,
        );
        logger.info('Digital product email sent', { orderId, email: order.customer.email.replace(/(.{2}).*(@.*)/, '$1***$2') });
      } catch (error: any) {
        logger.error('Failed to send digital product email', { orderId, error: error.message });
      }
    }

    // Send via WhatsApp
    try {
      const message = `Thank you for your purchase of ${productName}! 🎉\n\nHere is your download link:\n${downloadUrl}\n\nThis link expires in ${expiryHours} hours and can be used up to 5 times.`;

      await whatsappService.sendText({
        to: order.customer.phoneNumber,
        body: message,
        orderId: order.id,
        customerId: order.customerId,
      });
      logger.info('Digital product WhatsApp sent', { orderId, phone: order.customer.phoneNumber });
    } catch (error: any) {
      logger.error('Failed to send digital product WhatsApp', { orderId, error: error.message });
    }
  },

  /**
   * Revoke all download tokens for an order.
   */
  async revokeDownloadTokens(orderId: number): Promise<void> {
    await prisma.downloadToken.updateMany({
      where: { orderId, isRevoked: false },
      data: { isRevoked: true },
    });
    logger.info('Download tokens revoked', { orderId });
  },

  /**
   * Resend download links — generates new token and sends again.
   */
  async resendDownloadLinks(orderId: number): Promise<void> {
    const token = await this.generateDownloadToken(orderId);
    await this.sendDownloadLinks(orderId, token);
    logger.info('Download links resent', { orderId });
  },
};

/**
 * Send a styled email with digital product download link.
 */
async function sendDigitalProductEmail(
  email: string,
  firstName: string,
  productName: string,
  downloadUrl: string,
  expiryHours: number,
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Your download is ready: ${productName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1f2937;">Your purchase is complete! 🎉</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Thank you for purchasing <strong>${escapeHtml(productName)}</strong>. Your download is ready!</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${downloadUrl}"
             style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
            Download Now
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">
          This link expires in <strong>${expiryHours} hours</strong> and can be used up to 5 times.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${downloadUrl}" style="color: #2563eb;">${downloadUrl}</a>
        </p>
      </div>
    `,
  });
}
