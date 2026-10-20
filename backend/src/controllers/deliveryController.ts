import { Response } from 'express';
import { AuthRequest } from '../types';
import deliveryService from '../services/deliveryService';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';

const isAgent = (req: AuthRequest) => req.user!.role === 'delivery_agent';
const isAdmin = (req: AuthRequest) => req.user!.role === 'admin' || req.user!.role === 'super_admin';

/**
 * Ownership check for a delivery of the request tenant. A delivery agent may only touch
 * their own. The fail-closed tenant scope makes another tenant's delivery a 404.
 */
const assertDeliveryAccess = async (req: AuthRequest, id: string) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: parseInt(id, 10) },
    select: { id: true, agentId: true, tenantId: true }
  });
  if (!delivery) throw new AppError('Delivery not found', 404);
  if (isAgent(req) && delivery.agentId !== req.user!.id) {
    throw new AppError('Forbidden: this delivery is assigned to another agent', 403);
  }
  return delivery;
};

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
  await assertDeliveryAccess(req, id);
  const delivery = await deliveryService.getDeliveryById(id);
  res.json({ delivery });
};

export const uploadProofOfDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { proofType, proofData, recipientName, recipientPhone } = req.body;

  await assertDeliveryAccess(req, id);
  const delivery = await deliveryService.uploadProofOfDelivery(id, {
    proofType,
    proofData,
    recipientName,
    recipientPhone
  });

  res.json({ delivery });
};

export const completeDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { codAmount, proofType, proofData, recipientName } = req.body;

  const access = await assertDeliveryAccess(req, id);

  const result = await deliveryService.completeDelivery(
    id,
    {
      codAmount,
      proofType,
      proofData,
      recipientName
    },
    req.user?.id?.toString()
  );

  // an admin completing for the assigned agent leaves a trace
  if (isAdmin(req) && access.agentId !== req.user!.id) {
    await prisma.auditLog.create({
      data: {
        tenantId: resolveTenantId(access.tenantId),
        userId: req.user!.id,
        action: 'complete_delivery_for_agent',
        resource: 'delivery',
        resourceId: id,
        metadata: { agentId: access.agentId }
      }
    });
  }

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
  const { orderId } = req.params;
  const delivery = await deliveryService.getDeliveryByOrderId(
    parseInt(orderId, 10),
    req.user!.role === 'delivery_agent' ? req.user!.id : undefined
  );
  res.json({ delivery });
};

export const getAgentRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  const { agentId } = req.params;
  const { date } = req.query;

  if (isAgent(req) && String(req.user!.id) !== agentId) {
    throw new AppError('Forbidden: you can only view your own route', 403);
  }

  const route = await deliveryService.getAgentRoute(
    agentId,
    date ? new Date(date as string) : undefined
  );

  res.json({ route });
};
