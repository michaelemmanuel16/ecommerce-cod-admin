import { Response } from 'express';
import { AuthRequest } from '../types';
import deliveryService from '../services/deliveryService';
import { proofAndAttempts } from '../services/deliveryProofService';

const isAgent = (req: AuthRequest) => req.user!.role === 'delivery_agent';
const requesterOf = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });

export const getAllDeliveries = async (req: AuthRequest, res: Response): Promise<void> => {
  const { agentId, status, page = 1, limit = 20 } = req.query;

  const result = await deliveryService.getAllDeliveries({
    // a delivery agent only ever lists their own deliveries
    agentId: isAgent(req) ? String(req.user!.id) : (agentId as string | undefined),
    status: status as string | undefined,
    page: Number(page),
    limit: Number(limit)
  });

  res.json(result);
};

export const getDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const delivery = await deliveryService.getDeliveryById(id, requesterOf(req));
  res.json({ delivery });
};

export const uploadProofOfDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { proofType, proofData, recipientName, recipientPhone } = req.body;

  const delivery = await deliveryService.uploadProofOfDelivery(
    id,
    { proofType, proofData, recipientName, recipientPhone },
    requesterOf(req)
  );

  res.json({ delivery });
};

export const completeDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { codAmount, proofType, proofData, recipientName } = req.body;

  const result = await deliveryService.completeDelivery(
    id,
    { codAmount, proofType, proofData, recipientName },
    req.user?.id?.toString(),
    requesterOf(req)
  );

  res.json(result);
};

export const getAgentOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  const agentId = req.user!.id;
  const { status, page = 1, limit = 20, search, startDate, endDate } = req.query;

  const result = await deliveryService.getAgentOrders(agentId, {
    status: status as string | undefined,
    page: Number(page),
    limit: Number(limit),
    search: search as string | undefined,
    startDate: startDate as string | undefined,
    endDate: endDate as string | undefined,
  });

  res.json(result);
};

export const getDeliveryByOrderId = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.orderId, 10);
  const delivery = await deliveryService.getDeliveryByOrderId(id, isAgent(req) ? req.user!.id : undefined);
  // F-711, F-713: the proof block (photo by a signed link that expires) and the attempts. The stored photo address is not sent to admin roles.
  const { proof, attempts } = await proofAndAttempts(id, delivery);
  res.json({ delivery: isAgent(req) ? delivery : { ...delivery, proofImageUrl: null }, proof, attempts });
};
