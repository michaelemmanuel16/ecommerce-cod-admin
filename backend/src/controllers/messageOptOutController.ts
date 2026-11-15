import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { optOutListSchema, optOutWriteSchema } from '../validators/messageOptOutSchema';
import { listOptOuts, setOptOut } from '../services/messaging/optOutService';
import { normalizeInternationalPhone, normalizePhone } from '../utils/phone';

const tenantOf = (req: AuthRequest): string => {
  if (!req.user?.tenantId) throw new AppError('This account has no customers', 403);
  return req.user.tenantId;
};

/** GET /api/messages/opt-outs */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = optOutListSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await listOptOuts(tenantOf(req), parsed.data));
};

/** PUT /api/messages/opt-outs  { channel, optedOut, phone | email }. Goes through setOptOut: every customer with the phone changes and each change is an event. */
export const write = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = optOutWriteSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const { channel, optedOut, phone, email } = parsed.data;
  const tenantId = tenantOf(req);
  const result = await setOptOut({
    tenantId, channel, optedOut, reason: 'staff', actorId: req.user!.id,
    ...(channel === 'email' ? { email } : { phone: normalizePhone(phone) ?? normalizeInternationalPhone(phone) }),
  });
  res.json({ customers: result.customerIds.length });
};
