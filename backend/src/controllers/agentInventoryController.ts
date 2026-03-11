import { Response } from 'express';
import { AuthRequest } from '../types';
import agentInventoryService from '../services/agentInventoryService';
import { AppError } from '../middleware/errorHandler';
import { TransferType } from '@prisma/client';

const isDev = process.env.NODE_ENV === 'development';

const handleError = (res: Response, context: string, error: unknown): void => {
  console.error(`[agentInventoryController] ${context}:`, error);
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  res.status(500).json({
    error: `Failed to ${context}`,
    message: isDev ? (error as Error).message : 'Internal server error',
  });
};

class AgentInventoryController {
  async allocateStock(req: AuthRequest, res: Response) {
    try {
      const { productId, agentId, quantity, notes } = req.body;
      const transfer = await agentInventoryService.allocateStock(
        productId,
        agentId,
        quantity,
        req.user!.id,
        notes
      );
      res.status(201).json(transfer);
    } catch (error) {
      handleError(res, 'allocate stock', error);
    }
  }

  async transferStock(req: AuthRequest, res: Response) {
    try {
      const { productId, fromAgentId, toAgentId, quantity, notes } = req.body;
      const transfer = await agentInventoryService.transferStock(
        productId,
        fromAgentId,
        toAgentId,
        quantity,
        req.user!.id,
        notes
      );
      res.status(201).json(transfer);
    } catch (error) {
      handleError(res, 'transfer stock', error);
    }
  }

  async returnStock(req: AuthRequest, res: Response) {
    try {
      const { productId, agentId, quantity, notes } = req.body;
      const transfer = await agentInventoryService.returnStock(
        productId,
        agentId,
        quantity,
        req.user!.id,
        notes
      );
      res.status(201).json(transfer);
    } catch (error) {
      handleError(res, 'return stock', error);
    }
  }

  async adjustStock(req: AuthRequest, res: Response) {
    try {
      const { productId, agentId, newQuantity, notes } = req.body;
      const transfer = await agentInventoryService.adjustStock(
        productId,
        agentId,
        newQuantity,
        req.user!.id,
        notes
      );
      res.json(transfer);
    } catch (error) {
      handleError(res, 'adjust stock', error);
    }
  }

  async getProductAgentStock(req: AuthRequest, res: Response) {
    try {
      const productId = parseInt(req.params.productId);
      const result = await agentInventoryService.getProductAgentStock(productId);
      res.json(result);
    } catch (error) {
      handleError(res, 'get product agent stock', error);
    }
  }

  async getAgentInventory(req: AuthRequest, res: Response) {
    try {
      const agentId = parseInt(req.params.agentId);
      // Self-ownership check: delivery_agents may only view their own inventory.
      // This lives in the controller (not middleware) because agentId comes from the
      // path param, which isn't available at the requireRole middleware level.
      if (req.user!.role === 'delivery_agent' && req.user!.id !== agentId) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const result = await agentInventoryService.getAgentInventory(agentId);
      res.json(result);
    } catch (error) {
      handleError(res, 'get agent inventory', error);
    }
  }

  async getTransferHistory(req: AuthRequest, res: Response) {
    try {
      const { productId, agentId, type, startDate, endDate, page, limit } = req.query;
      const result = await agentInventoryService.getTransferHistory({
        productId: productId ? parseInt(productId as string) : undefined,
        agentId: agentId ? parseInt(agentId as string) : undefined,
        type: type as TransferType | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 50,
      });
      res.json(result);
    } catch (error) {
      handleError(res, 'get transfer history', error);
    }
  }

  async getSummary(_req: AuthRequest, res: Response) {
    try {
      const result = await agentInventoryService.getSummary();
      res.json(result);
    } catch (error) {
      handleError(res, 'get summary', error);
    }
  }
}

export default new AgentInventoryController();
