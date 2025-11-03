import { Response } from 'express';
import { AuthRequest } from '../types';
import deliveryService from '../services/deliveryService';

export const getAllDeliveries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId, status, page = 1, limit = 20 } = req.query;

    const result = await deliveryService.getAllDeliveries({
      agentId: agentId as string | undefined,
      status: status as string | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const delivery = await deliveryService.getDeliveryById(id);
    res.json({ delivery });
  } catch (error) {
    throw error;
  }
};

export const uploadProofOfDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { proofType, proofData, recipientName, recipientPhone } = req.body;

    const delivery = await deliveryService.uploadProofOfDelivery(id, {
      proofType,
      proofData,
      recipientName,
      recipientPhone
    });

    res.json({ delivery });
  } catch (error) {
    throw error;
  }
};

export const completeDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { codAmount, proofType, proofData, recipientName } = req.body;

    const result = await deliveryService.completeDelivery(
      id,
      {
        codAmount,
        proofType,
        proofData,
        recipientName
      },
      req.user?.id
    );

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const getAgentRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId } = req.params;
    const { date } = req.query;

    const route = await deliveryService.getAgentRoute(
      agentId,
      date ? new Date(date as string) : undefined
    );

    res.json({ route });
  } catch (error) {
    throw error;
  }
};
