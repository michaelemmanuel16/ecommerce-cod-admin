import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import prisma from '../utils/prisma';
import { getCustomerOptOuts, setOptOut } from '../services/messaging/optOutService';

const putSchema = z.object({ channel: z.enum(['sms', 'whatsapp', 'email']), optedOut: z.boolean() });

const idOf = (req: AuthRequest): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  return id;
};
const tenantOf = (req: AuthRequest): string => {
  if (!req.user?.tenantId) throw new AppError('This account has no customers', 403);
  return req.user.tenantId;
};

/** GET /api/customers/:id/opt-outs */
export const getOptOuts = async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await getCustomerOptOuts(tenantOf(req), idOf(req));
  if (!result) throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  res.json(result);
};

/** PUT /api/customers/:id/opt-outs  { channel, optedOut } */
export const putOptOut = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const tenantId = tenantOf(req);
  const customer = await prisma.customer.findFirst({ where: { id: idOf(req), tenantId }, select: { id: true, phoneNumber: true, email: true } });
  if (!customer) throw new AppError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
  await setOptOut({
    tenantId, customerId: customer.id, phone: parsed.data.channel === 'email' ? null : customer.phoneNumber,
    email: parsed.data.channel === 'email' ? customer.email : null,
    channel: parsed.data.channel, optedOut: parsed.data.optedOut, reason: 'staff', actorId: req.user!.id,
  });
  res.json(await getCustomerOptOuts(tenantId, customer.id));
};
