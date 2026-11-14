import { NextFunction, Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { retryMessage, resendAsSms } from '../services/messaging/messageActions';

const idOf = (req: AuthRequest): number => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Message not found', 404, 'MESSAGE_NOT_FOUND');
  return id;
};

/** POST /api/messages/:id/retry */
export const retry = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await retryMessage(idOf(req), { id: req.user!.id, role: req.user!.role });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/** POST /api/messages/:id/resend-sms */
export const resendSms = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await resendAsSms(idOf(req), { id: req.user!.id, role: req.user!.role });
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};
