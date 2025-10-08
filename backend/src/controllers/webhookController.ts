import { Response, Request } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { verifySignature } from '../utils/crypto';
import logger from '../utils/logger';

export const getAllWebhooks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const webhooks = await prisma.webhookConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });

    res.json({ webhooks });
  } catch (error) {
    throw error;
  }
};

export const createWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, url, secret, apiKey, fieldMapping, headers } = req.body;

    const webhook = await prisma.webhookConfig.create({
      data: {
        name,
        url,
        secret,
        apiKey,
        fieldMapping,
        headers
      }
    });

    res.status(201).json({ webhook });
  } catch (error) {
    throw error;
  }
};

export const getWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id },
      include: {
        logs: {
          orderBy: { processedAt: 'desc' },
          take: 10
        }
      }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    res.json({ webhook });
  } catch (error) {
    throw error;
  }
};

export const updateWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const webhook = await prisma.webhookConfig.update({
      where: { id },
      data: updateData
    });

    res.json({ webhook });
  } catch (error) {
    throw error;
  }
};

export const deleteWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.webhookConfig.delete({
      where: { id }
    });

    res.json({ message: 'Webhook deleted successfully' });
  } catch (error) {
    throw error;
  }
};

export const importOrdersViaWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-webhook-signature'] as string;
    const apiKey = req.headers['x-api-key'] as string;
    const body = req.body;

    logger.info('Webhook received', { headers: req.headers, body });

    // Log the webhook attempt
    const webhookLog = await prisma.webhookLog.create({
      data: {
        endpoint: req.path,
        method: req.method,
        headers: req.headers as any,
        body,
        success: false
      }
    });

    // Verify signature if provided
    if (signature) {
      const isValid = verifySignature(JSON.stringify(body), signature);
      if (!isValid) {
        await prisma.webhookLog.update({
          where: { id: webhookLog.id },
          data: {
            success: false,
            errorMessage: 'Invalid signature',
            statusCode: 401
          }
        });
        throw new AppError('Invalid webhook signature', 401);
      }
    }

    // Find webhook config by API key
    let webhookConfig = null;
    if (apiKey) {
      webhookConfig = await prisma.webhookConfig.findFirst({
        where: { apiKey, isActive: true }
      });

      if (!webhookConfig) {
        await prisma.webhookLog.update({
          where: { id: webhookLog.id },
          data: {
            success: false,
            errorMessage: 'Invalid API key',
            statusCode: 401
          }
        });
        throw new AppError('Invalid API key', 401);
      }

      await prisma.webhookLog.update({
        where: { id: webhookLog.id },
        data: { webhookConfigId: webhookConfig.id }
      });
    }

    // Map external data to internal structure
    const mapping = webhookConfig?.fieldMapping as any || {};
    const orders = Array.isArray(body.orders) ? body.orders : [body];

    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (const externalOrder of orders) {
      try {
        // Map fields
        const mappedData: any = {};
        for (const [internalField, externalField] of Object.entries(mapping)) {
          mappedData[internalField] = externalOrder[externalField as string];
        }

        // Find or create customer
        const customerPhone = mappedData.customerPhone || externalOrder.customer_phone;
        let customer = await prisma.customer.findUnique({
          where: { phoneNumber: customerPhone }
        });

        if (!customer) {
          customer = await prisma.customer.create({
            data: {
              firstName: mappedData.customerFirstName || externalOrder.customer_name || 'Unknown',
              lastName: mappedData.customerLastName || '',
              phoneNumber: customerPhone,
              address: mappedData.deliveryAddress || externalOrder.address || '',
              city: mappedData.deliveryCity || externalOrder.city || '',
              state: mappedData.deliveryState || externalOrder.state || '',
              zipCode: mappedData.deliveryZipCode || externalOrder.zip || '',
              area: mappedData.deliveryArea || externalOrder.area || ''
            }
          });
        }

        // Generate order number
        const orderCount = await prisma.order.count();
        const orderNumber = `ORD-${Date.now()}-${String(orderCount + 1).padStart(5, '0')}`;

        // Create order
        await prisma.order.create({
          data: {
            orderNumber,
            customerId: customer.id,
            subtotal: Number(mappedData.subtotal || externalOrder.amount || 0),
            totalAmount: Number(mappedData.totalAmount || externalOrder.amount || 0),
            codAmount: Number(mappedData.totalAmount || externalOrder.amount || 0),
            deliveryAddress: mappedData.deliveryAddress || externalOrder.address || customer.address,
            deliveryCity: mappedData.deliveryCity || externalOrder.city || customer.city,
            deliveryState: mappedData.deliveryState || externalOrder.state || customer.state,
            deliveryZipCode: mappedData.deliveryZipCode || externalOrder.zip || customer.zipCode,
            deliveryArea: mappedData.deliveryArea || externalOrder.area || customer.area,
            notes: mappedData.notes || externalOrder.notes,
            source: 'webhook',
            externalOrderId: externalOrder.id || externalOrder.order_id,
            webhookData: externalOrder,
            orderHistory: {
              create: {
                status: 'pending_confirmation',
                notes: 'Order imported via webhook'
              }
            }
          }
        });

        results.success++;
      } catch (err: any) {
        logger.error('Failed to process webhook order', err);
        results.failed++;
        results.errors.push({
          order: externalOrder,
          error: err.message
        });
      }
    }

    // Update webhook log
    await prisma.webhookLog.update({
      where: { id: webhookLog.id },
      data: {
        success: true,
        response: results as any,
        statusCode: 200
      }
    });

    res.json({
      message: 'Webhook processed',
      results
    });
  } catch (error: any) {
    logger.error('Webhook processing error', error);
    throw error;
  }
};

export const getWebhookLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      prisma.webhookLog.findMany({
        where: { webhookConfigId: id },
        skip,
        take: Number(limit),
        orderBy: { processedAt: 'desc' }
      }),
      prisma.webhookLog.count({
        where: { webhookConfigId: id }
      })
    ]);

    res.json({
      logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};

export const testWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { sampleData } = req.body;

    const webhook = await prisma.webhookConfig.findUnique({
      where: { id }
    });

    if (!webhook) {
      throw new AppError('Webhook not found', 404);
    }

    // Test field mapping
    const mapping = webhook.fieldMapping as any;
    const mappedData: any = {};

    for (const [internalField, externalField] of Object.entries(mapping)) {
      mappedData[internalField] = sampleData[externalField as string];
    }

    res.json({
      message: 'Webhook test successful',
      mappedData,
      sampleData
    });
  } catch (error) {
    throw error;
  }
};
