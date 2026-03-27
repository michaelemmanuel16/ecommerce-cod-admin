import { Response } from 'express';
import { MessageChannel, MessageStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { communicationService } from '../services/communicationService';

const bulkSendSmsSchema = z.object({
  customerIds: z.array(z.number()).min(1).max(5000),
  message: z.string().min(1).max(1000),
});

const bulkSendWhatsAppSchema = z.object({
  customerIds: z.array(z.number()).min(1).max(5000),
  templateKey: z.string().min(1),
  customLink: z.string().url().optional(),
});

const templateSchema = z.object({
  name: z.string().min(1),
  body: z.string().min(1),
});

const updateTemplateSchema = templateSchema.partial().refine(
  (data) => data.name !== undefined || data.body !== undefined,
  { message: 'At least one of name or body is required' },
);

const validChannels = Object.values(MessageChannel);
const validStatuses = Object.values(MessageStatus);

const updateOptOutSchema = z
  .object({
    smsOptOut: z.boolean().optional(),
    whatsappOptOut: z.boolean().optional(),
  })
  .refine((data) => data.smsOptOut !== undefined || data.whatsappOptOut !== undefined, {
    message: 'At least one of smsOptOut or whatsappOptOut is required',
  });

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, channel, status, startDate, endDate } = req.query;
    if (channel && !validChannels.includes(channel as MessageChannel)) {
      res.status(400).json({ error: `Invalid channel. Must be one of: ${validChannels.join(', ')}` });
      return;
    }
    if (status && !validStatuses.includes(status as MessageStatus)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
      return;
    }
    const result = await communicationService.getMessages({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      channel: channel as MessageChannel | undefined,
      status: status as MessageStatus | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const result = await communicationService.getStats(
      startDate as string | undefined,
      endDate as string | undefined,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getRecipients = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { state, productId, hasOrdered, channel } = req.query;
    if (!channel || (channel !== 'sms' && channel !== 'whatsapp')) {
      res.status(400).json({ error: 'channel query param is required (sms or whatsapp)' });
      return;
    }
    const recipients = await communicationService.getRecipients({
      state: state as string | undefined,
      productId: productId ? Number(productId) : undefined,
      hasOrdered: hasOrdered === 'true',
      channel: channel as 'sms' | 'whatsapp',
    });
    res.json(recipients);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const bulkSendSms = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = bulkSendSmsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((e) => e.message).join(', ') });
      return;
    }
    const { customerIds, message } = parsed.data;
    const result = await communicationService.bulkSendSms(customerIds, message);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const bulkSendWhatsApp = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = bulkSendWhatsAppSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((e) => e.message).join(', ') });
      return;
    }
    const { customerIds, templateKey, customLink } = parsed.data;
    const result = await communicationService.bulkSendWhatsApp(customerIds, templateKey, customLink);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTemplates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const templates = await communicationService.getTemplates();
    res.json(templates);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((e) => e.message).join(', ') });
      return;
    }
    const template = await communicationService.createTemplate(parsed.data);
    res.status(201).json(template);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const parsed = updateTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((e) => e.message).join(', ') });
      return;
    }
    const template = await communicationService.updateTemplate(id, parsed.data);
    res.json(template);
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await communicationService.deleteTemplate(id);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};

export const getOptOutCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit } = req.query;
    const result = await communicationService.getOptOutCustomers(
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateOptOut = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customerId = Number(req.params.customerId);
    const parsed = updateOptOutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((e) => e.message).join(', ') });
      return;
    }
    const customer = await communicationService.updateCustomerOptOut(customerId, parsed.data);
    res.json(customer);
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }
    res.status(500).json({ error: error.message });
  }
};
