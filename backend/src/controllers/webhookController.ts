import { Response, Request, NextFunction } from 'express';
import { AuthRequest } from '../types';
import webhookService from '../services/webhookService';

export const getAllWebhooks = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const webhooks = await webhookService.getAllWebhooks();
    res.json({ webhooks });
  } catch (error) {
    next(error);
  }
};

export const createWebhook = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, url, secret, productId, apiKey, fieldMapping, headers } = req.body;

    const webhook = await webhookService.createWebhook({
      name,
      url,
      secret,
      productId,
      apiKey,
      fieldMapping,
      headers
    });

    res.status(201).json({ webhook });
  } catch (error) {
    next(error);
  }
};

export const getWebhook = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const webhook = await webhookService.getWebhookById(Number(id));
    res.json({ webhook });
  } catch (error) {
    next(error);
  }
};

export const updateWebhook = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const webhook = await webhookService.updateWebhook(Number(id), updateData);
    res.json({ webhook });
  } catch (error) {
    next(error);
  }
};

export const deleteWebhook = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await webhookService.deleteWebhook(Number(id));
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const importOrdersViaWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const signature = req.headers['x-webhook-signature'] as string;
    const apiKey = req.headers['x-api-key'] as string;

    const result = await webhookService.processWebhook({
      signature,
      apiKey,
      body: req.body,
      headers: req.headers,
      endpoint: req.path,
      method: req.method
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Import orders via unique webhook URL
 * Simpler endpoint that doesn't require API keys in headers
 */
export const importOrdersViaUniqueUrl = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { uniqueUrl } = req.params;
    const signature = req.headers['x-webhook-signature'] as string;

    const result = await webhookService.processWebhookByUniqueUrl({
      uniqueUrl,
      signature,
      body: req.body,
      headers: req.headers,
      endpoint: req.path,
      method: req.method
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getWebhookLogs = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const result = await webhookService.getWebhookLogs(Number(id), {
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getWebhookStats = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { days } = req.query;

    const stats = await webhookService.getWebhookStats(Number(id), {
      days: days ? Number(days) : undefined
    });

    res.json(stats);
  } catch (error) {
    next(error);
  }
};

export const testWebhook = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { sampleData } = req.body;

    const result = await webhookService.testWebhook(Number(id), sampleData);
    res.json(result);
  } catch (error) {
    next(error);
  }
};
