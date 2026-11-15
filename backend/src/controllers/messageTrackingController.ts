import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { customerMessages, orderMessages } from '../services/messaging/messageTracking';

const idOf = (req: AuthRequest, what: string): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(`${what} not found`, 404);
  return id;
};

/** GET /api/orders/:id/messages */
export const forOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await orderMessages(idOf(req, 'Order'), { id: req.user!.id, role: req.user!.role }));
};

/** GET /api/customers/:id/messages */
export const forCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await customerMessages(idOf(req, 'Customer'), { id: req.user!.id, role: req.user!.role }));
};
