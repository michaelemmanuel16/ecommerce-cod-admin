import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import crypto from 'crypto';
import { parsePackageField } from '../utils/packageParser';
import workflowService from './workflowService';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderCreated } from '../sockets';
import { tenantStorage } from '../utils/tenantContext';


interface CreateWebhookData {
  name: string;
  url: string;
  secret: string;
  apiKey?: string;
  productId?: number;
  fieldMapping: Record<string, string>;
  headers?: Record<string, string>;
}

interface ProcessWebhookData {
  signature?: string;
  apiKey?: string;
  body: any;
  headers: any;
  endpoint: string;
  method: string;
}

interface ProcessWebhookByUniqueUrlData {
  uniqueUrl: string;
  signature?: string;
  body: any;
  headers: any;
  endpoint: string;
  method: string;
}

export class WebhookService {
  /**
   * Get all webhook configurations
   */
  async getAllWebhooks() {

    const webhooks = await prisma.webhookConfig.findMany({
      where: {},
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        }
      }
    });

    return webhooks;
  }

  /**
   * Create new webhook configuration
   */
  async createWebhook(data: CreateWebhookData) {

    const webhook = await prisma.webhookConfig.create({
      data: {
        name: data.name,
        url: data.url,
        secret: data.secret,
        apiKey: data.apiKey,
        productId: data.productId,
        fieldMapping: data.fieldMapping,
        headers: data.headers || {},
              },
      include: {
        product: true
      }
    });

    logger.info('Webhook configuration created', {
      webhookId: webhook.id,
      name: webhook.name,
      productId: webhook.productId
    });

    return webhook;
  }

  /**
   * Get webhook by ID
   */
  async getWebhookById(webhookId: number) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        },
        logs: {
          orderBy: { processedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    return webhook;
  }

  /**
   * Update webhook configuration
   */
  async updateWebhook(webhookId: number, updateData: Partial<CreateWebhookData>) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    const updated = await prisma.webhookConfig.update({
      where: { id: webhookId },
      data: updateData,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true
          }
        }
      }
    });

    logger.info('Webhook configuration updated', { webhookId });
    return updated;
  }

  /**
   * Delete webhook configuration
   */
  async deleteWebhook(webhookId: number) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    await prisma.webhookConfig.delete({
      where: { id: webhookId }
    });

    logger.info('Webhook configuration deleted', { webhookId });
    return { message: 'Webhook deleted successfully' };
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload: string, signature: string, secret: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(payload).digest('hex');
      const sig = signature.replace(/^sha256=/, '');
      if (sig.length !== digest.length) return false;
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(digest, 'hex'));
    } catch (error) {
      logger.error('Signature verification failed', { error });
      return false;
    }
  }

  /**
   * Process incoming webhook
   */
  async processWebhook(data: ProcessWebhookData) {
    const { signature, apiKey, body, headers, endpoint, method } = data;

    // Create webhook log (WebhookLog has no tenantId column)
    const webhookLog = await prisma.webhookLog.create({
      data: {
        endpoint,
        method,
        headers: headers as any,
        body: body as any,
        success: false,
      }
    });

    try {
      // Find webhook config by API key
      let webhookConfig = null;
      if (apiKey) {
        webhookConfig = await prisma.webhookConfig.findFirst({
          where: { apiKey, isActive: true }
        });

        if (!webhookConfig) {
          await this.updateWebhookLog(webhookLog.id, {
            success: false,
            errorMessage: 'Invalid API key',
            statusCode: 401
          });
          throw new AppError('Invalid API key', 401);
        }

        await prisma.webhookLog.update({
          where: { id: webhookLog.id },
          data: { webhookConfigId: webhookConfig.id }
        });
      }

      // Verify signature if provided
      if (signature && webhookConfig) {
        const isValid = this.verifySignature(JSON.stringify(body), signature, webhookConfig.secret);
        if (!isValid) {
          await this.updateWebhookLog(webhookLog.id, {
            success: false,
            errorMessage: 'Invalid signature',
            statusCode: 401
          });
          throw new AppError('Invalid webhook signature', 401);
        }
      }

      // Process orders within tenant context derived from webhook config
      const tenantId = webhookConfig?.tenantId as string | null;
      const results = tenantId
        ? await tenantStorage.run({ tenantId }, () => this.processOrdersFromWebhook(body, webhookConfig))
        : await this.processOrdersFromWebhook(body, webhookConfig);

      // Update webhook log as successful
      await this.updateWebhookLog(webhookLog.id, {
        success: true,
        response: results,
        statusCode: 200
      });

      return {
        message: 'Webhook processed',
        results
      };
    } catch (error: any) {
      logger.error('Webhook processing error', {
        error: error.message,
        webhookLogId: webhookLog.id
      });

      await this.updateWebhookLog(webhookLog.id, {
        success: false,
        errorMessage: error.message,
        statusCode: error.statusCode || 500
      });

      throw error;
    }
  }

  /**
   * Process incoming webhook via unique URL
   */
  async processWebhookByUniqueUrl(data: ProcessWebhookByUniqueUrlData) {
    const { uniqueUrl, signature, body, headers, endpoint, method } = data;

    // Create webhook log (WebhookLog has no tenantId column)
    const webhookLog = await prisma.webhookLog.create({
      data: {
        endpoint,
        method,
        headers: headers as any,
        body: body as any,
        success: false,
      }
    });

    try {
      // Find webhook config by unique URL (include product relation)
      const webhookConfig = await prisma.webhookConfig.findUnique({
        where: { uniqueUrl, isActive: true },
        include: {
          product: true
        }
      });

      if (!webhookConfig) {
        await this.updateWebhookLog(webhookLog.id, {
          success: false,
          errorMessage: 'Invalid webhook URL',
          statusCode: 404
        });
        throw new AppError('Webhook not found', 404);
      }

      // Link webhook log to config
      await prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: { webhookConfigId: webhookConfig.id }
      });

      // Verify signature if provided
      if (signature) {
        const isValid = this.verifySignature(JSON.stringify(body), signature, webhookConfig.secret);
        if (!isValid) {
          await this.updateWebhookLog(webhookLog.id, {
            success: false,
            errorMessage: 'Invalid signature',
            statusCode: 401
          });
          throw new AppError('Invalid webhook signature', 401);
        }
      }

      // Process orders within tenant context derived from webhook config
      const tenantId = webhookConfig?.tenantId as string | null;
      const results = tenantId
        ? await tenantStorage.run({ tenantId }, () => this.processOrdersFromWebhook(body, webhookConfig))
        : await this.processOrdersFromWebhook(body, webhookConfig);

      // Update webhook log as successful
      await this.updateWebhookLog(webhookLog.id, {
        success: true,
        response: results,
        statusCode: 200
      });

      return {
        message: 'Webhook processed',
        results
      };
    } catch (error: any) {
      logger.error('Webhook processing error', {
        error: error.message,
        webhookLogId: webhookLog.id
      });

      await this.updateWebhookLog(webhookLog.id, {
        success: false,
        errorMessage: error.message,
        statusCode: error.statusCode || 500
      });

      throw error;
    }
  }

  /**
   * Process orders from webhook payload
   */
  private getExternalId(order: any): string | undefined {
    const id = order.id || order.order_id;
    return id ? String(id) : undefined;
  }

  /**
   * Generate a unique fingerprint for webhook order deduplication.
   * Hash of (phone + totalAmount + date) prevents race-condition duplicates
   * via a DB unique constraint.
   */
  private generateWebhookFingerprint(phone: string, totalAmount: number, webhookConfigId?: number): string {
    const dateStr = new Date().toISOString().split('T')[0]; // same calendar day
    const raw = `${phone}|${totalAmount}|${webhookConfigId || ''}|${dateStr}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
  }

  private async processOrdersFromWebhook(body: any, webhookConfig: any) {
    const mapping = (webhookConfig?.fieldMapping as any) || {};
    const orders = Array.isArray(body.orders) ? body.orders : [body];

    const results = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [] as Array<{ order: any; error: string }>
    };

    // Guard 1 pre-fetch: collect all externalOrderIds in the batch and query once
    const batchExternalIds = orders
      .map((o: any) => this.getExternalId(o))
      .filter(Boolean) as string[];

    const existingExternalIdSet = new Set<string>();

    if (batchExternalIds.length > 0) {
      const existing = await prisma.order.findMany({
        where: { externalOrderId: { in: batchExternalIds }, deletedAt: null },
        select: { externalOrderId: true },
      });
      existing.forEach((o) => existingExternalIdSet.add(o.externalOrderId!));
    }

    for (const externalOrder of orders) {
      try {
        // Map external fields to internal fields
        const mappedData = this.mapFields(externalOrder, mapping);

        // Find or create customer
        const customer = await this.findOrCreateCustomer(mappedData, externalOrder);

        // Determine product, quantity, and price
        let product = null;
        let quantity = 1;
        let price = 0;
        let packageInfo = '';

        // Check if webhook has a configured product (new flow)
        if (webhookConfig?.productId && webhookConfig?.product) {
          // Use webhook's configured product
          product = webhookConfig.product;

          // Parse package field to extract quantity and price
          const packageField = mappedData.quantity || mappedData.package || externalOrder.quantity || externalOrder.package || '';
          packageInfo = packageField;

          if (packageField) {
            const parsed = parsePackageField(packageField);
            quantity = parsed.quantity;
            price = parsed.price;

            logger.info('Parsed package field', {
              packageField,
              quantity,
              price,
              productId: product.id
            });
          } else {
            // Fall back to explicit quantity/price fields if package field is empty
            quantity = Number(mappedData.quantity || externalOrder.quantity || 1);
            price = Number(mappedData.price || externalOrder.price || 0);
          }
        } else {
          // Old flow: Look up product by name (backward compatibility)
          const productName = mappedData.productName || externalOrder.product_name || externalOrder.product;
          quantity = Number(mappedData.quantity || externalOrder.quantity || 1);
          price = Number(mappedData.price || externalOrder.price || 0);
          packageInfo = mappedData.package || externalOrder.package || '';

          product = productName ? await this.findProductByName(productName) : null;
        }

        // Calculate totals
        // The parsed price from package field is the TOTAL price for the package, not per-unit
        // Example: "BUY THREE SETS - GH₵675" means 3 sets for 675 total (not 675 each)
        const itemTotal = price; // Use price as-is (it's already the total)
        const subtotal = mappedData.subtotal ? Number(mappedData.subtotal) : itemTotal;
        const shippingCost = Number(mappedData.shippingCost || mappedData.deliveryFee || externalOrder.shipping_cost || externalOrder.delivery_fee || 0);
        const totalAmount = Math.round((mappedData.totalAmount ? Number(mappedData.totalAmount) : subtotal + shippingCost) * 100) / 100;

        // Guard 1: exact-retry deduplication by externalOrderId (in-memory lookup from pre-fetch)
        const externalId = this.getExternalId(externalOrder);
        if (externalId && existingExternalIdSet.has(externalId)) {
          logger.info('Skipping duplicate webhook order (same externalOrderId)', {
            externalOrderId: externalId,
          });
          results.skipped++;
          continue;
        }

        // Guard 2: DB-level fingerprint deduplication (phone + amount + day + webhookConfig)
        // Uses a unique constraint on webhookFingerprint to prevent race-condition duplicates
        const fingerprint = this.generateWebhookFingerprint(
          customer.phoneNumber,
          totalAmount,
          webhookConfig?.id
        );

        // Also check in-memory for orders already created in this batch
        if (existingExternalIdSet.has(`fp:${fingerprint}`)) {
          logger.info('Skipping duplicate webhook order (same fingerprint in batch)', {
            phone: customer.phoneNumber,
            totalAmount,
          });
          results.skipped++;
          continue;
        }

        // Create order with fingerprint — unique constraint catches concurrent duplicates
        let createdOrder;
        try {
          createdOrder = await prisma.order.create({
            data: {
              customerId: customer.id,
              subtotal,
              shippingCost,
              totalAmount,
              codAmount: totalAmount,
                            deliveryAddress: mappedData.deliveryAddress || externalOrder.address || customer.address,
              deliveryState: mappedData.deliveryState || externalOrder.state || customer.state,
              deliveryArea: mappedData.deliveryArea || externalOrder.area || customer.area,
              notes: mappedData.notes || externalOrder.notes || (packageInfo ? `Package: ${packageInfo}` : undefined),
              source: 'webhook',
              externalOrderId: externalOrder.id || externalOrder.order_id,
              webhookData: externalOrder,
              webhookFingerprint: fingerprint,
              orderItems: product ? {
                create: {
                  productId: product.id,
                  quantity,
                  unitPrice: quantity > 0 ? price / quantity : price,
                  totalPrice: itemTotal
                }
              } : undefined,
              orderHistory: {
                create: {
                  status: 'pending_confirmation',
                  notes: 'Order imported via webhook'
                }
              }
            },
            include: {
              orderItems: true
            }
          });
        } catch (err: any) {
          // P2002 = unique constraint violation — another concurrent request already created this order
          if (err.code === 'P2002' && err.meta?.target?.includes('webhook_fingerprint')) {
            logger.info('Skipping duplicate webhook order (concurrent fingerprint collision)', {
              phone: customer.phoneNumber,
              totalAmount,
              fingerprint,
            });
            results.skipped++;
            continue;
          }
          throw err; // Re-throw non-dedup errors
        }

        // Track fingerprint in-memory for remaining items in this batch
        existingExternalIdSet.add(`fp:${fingerprint}`);

        results.success++;
        logger.info('Webhook order created', { orderId: createdOrder.id });

        // Trigger workflows for imported order
        workflowService.triggerOrderCreatedWorkflows(createdOrder).catch(err => {
          logger.error('Failed to trigger workflow for webhook order', {
            orderId: createdOrder.id,
            error: err.message
          });
        });

        // Emit socket event for real-time update
        emitOrderCreated(getSocketInstance() as any, createdOrder);
      } catch (err: any) {
        results.failed++;
        results.errors.push({
          order: externalOrder,
          error: err.message
        });
        logger.error('Failed to process webhook order', {
          error: err.message,
          orderData: externalOrder
        });
      }
    }

    return results;
  }

  /**
   * Map external fields to internal fields
   */
  private mapFields(externalData: any, mapping: Record<string, string>): any {
    const mappedData: any = {};

    for (const [internalField, externalField] of Object.entries(mapping)) {
      if (externalData[externalField] !== undefined) {
        mappedData[internalField] = externalData[externalField];
      }
    }

    return mappedData;
  }

  /**
   * Find product by name or SKU (case-insensitive)
   */
  private async findProductByName(productName: string): Promise<any> {

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { name: { equals: productName, mode: 'insensitive' } },
          { sku: { equals: productName, mode: 'insensitive' } }
        ],
              }
    });

    if (!product) {
      throw new Error(`Product not found: ${productName}`);
    }

    return product;
  }

  /**
   * Find or create customer from webhook data
   */
  private async findOrCreateCustomer(mappedData: any, externalOrder: any) {
    const customerPhone = mappedData.customerPhone || externalOrder.customer_phone || externalOrder.phone;

    if (!customerPhone) {
      throw new Error('Customer phone number is required');
    }


    let customer = await prisma.customer.findFirst({
      where: { phoneNumber: customerPhone }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          firstName: mappedData.customerFirstName || externalOrder.customer_name || 'Unknown',
          lastName: mappedData.customerLastName || '',
          phoneNumber: customerPhone,
          alternatePhone: mappedData.alternativePhone || externalOrder.alternative_phone_number || undefined,
          email: mappedData.customerEmail || externalOrder.email || undefined,
          address: mappedData.deliveryAddress || externalOrder.address || '',
          state: mappedData.deliveryState || externalOrder.state || '',
          area: mappedData.deliveryArea || externalOrder.area || '',
                  }
      });

      logger.info('Customer created from webhook', {
        customerId: customer.id,
        phoneNumber: customerPhone
      });
    }

    return customer;
  }

  /**
   * Update webhook log
   */
  private async updateWebhookLog(
    logId: number,
    data: {
      success: boolean;
      response?: any;
      errorMessage?: string;
      statusCode?: number;
    }
  ) {
    return prisma.webhookLog.update({
      where: { id: logId },
      data: {
        success: data.success,
        response: data.response as any,
        errorMessage: data.errorMessage,
        statusCode: data.statusCode
      }
    });
  }

  /**
   * Get webhook logs
   */
  async getWebhookLogs(
    webhookId: number,
    filters?: { page?: number; limit?: number }
  ) {
    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where: { webhookConfigId: webhookId },
        skip,
        take: limit,
        orderBy: { processedAt: 'desc' }
      }),
      prisma.webhookLog.count({
        where: { webhookConfigId: webhookId }
      })
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Test webhook field mapping
   */
  async testWebhook(webhookId: number, sampleData: any) {

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    // Test field mapping
    const mapping = webhook.fieldMapping as any;
    const mappedData = this.mapFields(sampleData, mapping);

    return {
      message: 'Webhook test successful',
      mappedData,
      sampleData
    };
  }

  /**
   * Retry failed webhook
   */
  async retryWebhook(logId: number) {
    const log = await prisma.webhookLog.findUnique({
      where: { id: logId },
      include: {
        webhookConfig: true
      }
    });

    if (!log) {
      throw new AppError('Webhook log not found', 404);
    }

    if (log.success) {
      throw new AppError('Cannot retry successful webhook', 400);
    }

    // Reprocess the webhook
    return this.processWebhook({
      body: log.body,
      headers: log.headers as any,
      endpoint: log.endpoint,
      method: log.method,
      apiKey: log.webhookConfig?.apiKey ?? undefined
    });
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(webhookId: number, filters?: { days?: number }) {
    const { days = 30 } = filters || {};
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [totalLogs, successLogs, failedLogs, recentLogs] = await Promise.all([
      prisma.webhookLog.count({
        where: {
          webhookConfigId: webhookId,
          processedAt: { gte: startDate }
        }
      }),
      prisma.webhookLog.count({
        where: {
          webhookConfigId: webhookId,
          success: true,
          processedAt: { gte: startDate }
        }
      }),
      prisma.webhookLog.count({
        where: {
          webhookConfigId: webhookId,
          success: false,
          processedAt: { gte: startDate }
        }
      }),
      prisma.webhookLog.findMany({
        where: {
          webhookConfigId: webhookId,
          processedAt: { gte: startDate }
        },
        select: {
          processedAt: true,
          success: true
        },
        orderBy: { processedAt: 'desc' }
      })
    ]);

    return {
      totalRequests: totalLogs,
      successfulRequests: successLogs,
      failedRequests: failedLogs,
      successRate: totalLogs > 0 ? (successLogs / totalLogs) * 100 : 0,
      recentActivity: recentLogs
    };
  }
}

export default new WebhookService();
