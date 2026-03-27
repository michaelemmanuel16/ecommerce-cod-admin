import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel, MessageStatus } from '@prisma/client';
import whatsappService, { ORDER_STATUS_TEMPLATES } from './whatsappService';
import { smsService } from './smsService';

export const communicationService = {
  async getMessages(params: {
    page?: number;
    limit?: number;
    channel?: MessageChannel;
    status?: MessageStatus;
    orderId?: number;
    customerId?: number;
    startDate?: string;
    endDate?: string;
  }) {
    return whatsappService.getMessages(params);
  },

  async getStats(startDate?: string, endDate?: string) {
    return whatsappService.getStats(startDate, endDate);
  },

  async getRecipients(filters: {
    state?: string;
    productId?: number;
    hasOrdered?: boolean;
    channel: 'sms' | 'whatsapp';
  }) {
    const where: any = { isActive: true };
    if (filters.state) where.state = filters.state;
    if (filters.hasOrdered) where.totalOrders = { gt: 0 };
    if (filters.channel === 'sms') where.smsOptOut = false;
    if (filters.channel === 'whatsapp') where.whatsappOptOut = false;

    // Filter by product: find customers who have ordered this product
    if (filters.productId) {
      where.orders = {
        some: {
          orderItems: {
            some: { productId: filters.productId },
          },
        },
      };
    }

    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        state: true,
        area: true,
        smsOptOut: true,
        whatsappOptOut: true,
      },
      orderBy: { firstName: 'asc' },
      take: 1000,
    });
    return customers;
  },

  async bulkSendSms(customerIds: number[], message: string) {
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, smsOptOut: false, isActive: true },
      select: { id: true, phoneNumber: true },
    });

    const results = [];
    for (const customer of customers) {
      try {
        const result = await smsService.sendSms({
          to: customer.phoneNumber,
          body: message,
          customerId: customer.id,
        });
        results.push({ customerId: customer.id, success: true, messageLogId: result.messageLogId });
      } catch (error: any) {
        results.push({ customerId: customer.id, success: false, error: error.message });
      }
    }

    logger.info('Bulk SMS completed', {
      total: customers.length,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });
    return { total: customers.length, results };
  },

  async bulkSendWhatsApp(customerIds: number[], templateKey: string, customLink?: string) {
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, whatsappOptOut: false, isActive: true },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });

    const templateConfig = ORDER_STATUS_TEMPLATES[templateKey];
    if (!templateConfig) {
      throw new Error(`Unknown WhatsApp template: ${templateKey}`);
    }

    const results = [];
    for (const customer of customers) {
      try {
        const bodyParams = [
          `${customer.firstName} ${customer.lastName}`.trim(),
          'your order',
        ];
        if (customLink) bodyParams.push(customLink);

        const result = await whatsappService.sendTemplate({
          to: customer.phoneNumber,
          templateName: templateConfig.templateName,
          bodyParams,
          customerId: customer.id,
        });
        results.push({ customerId: customer.id, success: true, messageLogId: result.messageLogId });
      } catch (error: any) {
        results.push({ customerId: customer.id, success: false, error: error.message });
      }
    }

    logger.info('Bulk WhatsApp completed', {
      total: customers.length,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });
    return { total: customers.length, results };
  },

  async getTemplates() {
    return prisma.smsTemplate.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async createTemplate(data: { name: string; body: string }) {
    return prisma.smsTemplate.create({ data });
  },

  async updateTemplate(id: number, data: { name?: string; body?: string }) {
    return prisma.smsTemplate.update({ where: { id }, data });
  },

  async deleteTemplate(id: number) {
    return prisma.smsTemplate.delete({ where: { id } });
  },

  async getOptOutCustomers(page = 1, limit = 20) {
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where: { OR: [{ smsOptOut: true }, { whatsappOptOut: true }] },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          smsOptOut: true,
          whatsappOptOut: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { firstName: 'asc' },
      }),
      prisma.customer.count({
        where: { OR: [{ smsOptOut: true }, { whatsappOptOut: true }] },
      }),
    ]);
    return {
      customers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async updateCustomerOptOut(
    customerId: number,
    data: { smsOptOut?: boolean; whatsappOptOut?: boolean },
  ) {
    return prisma.customer.update({ where: { id: customerId }, data });
  },
};
