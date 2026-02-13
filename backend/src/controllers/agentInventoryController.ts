import { Response } from 'express';
import { AuthRequest } from '../types';
import agentInventoryService from '../services/agentInventoryService';
import { TransferType } from '@prisma/client';

class AgentInventoryController {
  async allocateStock(req: AuthRequest, res: Response) {
    const { productId, agentId, quantity, notes } = req.body;
    const transfer = await agentInventoryService.allocateStock(
      productId,
      agentId,
      quantity,
      req.user!.id,
      notes
    );
    res.status(201).json(transfer);
  }

  async transferStock(req: AuthRequest, res: Response) {
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
  }

  async returnStock(req: AuthRequest, res: Response) {
    const { productId, agentId, quantity, notes } = req.body;
    const transfer = await agentInventoryService.returnStock(
      productId,
      agentId,
      quantity,
      req.user!.id,
      notes
    );
    res.status(201).json(transfer);
  }

  async adjustStock(req: AuthRequest, res: Response) {
    const { productId, agentId, newQuantity, notes } = req.body;
    const transfer = await agentInventoryService.adjustStock(
      productId,
      agentId,
      newQuantity,
      req.user!.id,
      notes
    );
    res.json(transfer);
  }

  async getProductAgentStock(req: AuthRequest, res: Response) {
    const productId = parseInt(req.params.productId);
    const result = await agentInventoryService.getProductAgentStock(productId);
    res.json(result);
  }

  async getAgentInventory(req: AuthRequest, res: Response) {
    const agentId = parseInt(req.params.agentId);
    if (req.user!.role === 'delivery_agent' && req.user!.id !== agentId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const result = await agentInventoryService.getAgentInventory(agentId);
    res.json(result);
  }

  async getTransferHistory(req: AuthRequest, res: Response) {
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
  }

  async getSummary(_req: AuthRequest, res: Response) {
    const result = await agentInventoryService.getSummary();
    res.json(result);
  }
}

export default new AgentInventoryController();
