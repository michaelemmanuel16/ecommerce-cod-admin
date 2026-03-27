import { Response } from 'express';
import { MessageChannel, MessageStatus } from '@prisma/client';
import { AuthRequest } from '../types';
import { communicationService } from '../services/communicationService';

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page, limit, channel, status, startDate, endDate } = req.query;
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
    const { customerIds, message } = req.body;
    if (!Array.isArray(customerIds) || !message) {
      res.status(400).json({ error: 'customerIds (array) and message (string) are required' });
      return;
    }
    const result = await communicationService.bulkSendSms(customerIds, message);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const bulkSendWhatsApp = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { customerIds, templateKey, customLink } = req.body;
    if (!Array.isArray(customerIds) || !templateKey) {
      res.status(400).json({ error: 'customerIds (array) and templateKey (string) are required' });
      return;
    }
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
    const { name, body } = req.body;
    if (!name || !body) {
      res.status(400).json({ error: 'name and body are required' });
      return;
    }
    const template = await communicationService.createTemplate({ name, body });
    res.status(201).json(template);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { name, body } = req.body;
    const template = await communicationService.updateTemplate(id, { name, body });
    res.json(template);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteTemplate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await communicationService.deleteTemplate(id);
    res.json({ success: true });
  } catch (error: any) {
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
    const { smsOptOut, whatsappOptOut } = req.body;
    const customer = await communicationService.updateCustomerOptOut(customerId, {
      smsOptOut,
      whatsappOptOut,
    });
    res.json(customer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
