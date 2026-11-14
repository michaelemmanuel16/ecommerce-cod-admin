import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { reminderCreateSchema, reminderListSchema, reminderPatchSchema } from '../validators/reminderSchema';
import * as reminders from '../services/reminderService';

const me = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role as string });
const idParam = (req: AuthRequest): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Reminder ID must be a positive whole number', 400);
  return id;
};

/** POST /api/reminders */
export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = reminderCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const { dueAt, ...rest } = parsed.data;
  res.status(201).json({ reminder: await reminders.createReminder({ ...rest, dueAt: new Date(dueAt) }, me(req)) });
};

/** GET /api/reminders?status&mine */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = reminderListSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json({ reminders: await reminders.listReminders(me(req), { status: parsed.data.status, mine: parsed.data.mine === '1' || parsed.data.mine === 'true' }) });
};

/** PATCH /api/reminders/:id { note?, dueAt?, cancel? } */
export const patch = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = reminderPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const { dueAt, ...rest } = parsed.data;
  res.json({ reminder: await reminders.updateReminder(idParam(req), { ...rest, ...(dueAt ? { dueAt: new Date(dueAt) } : {}) }, me(req)) });
};

/** DELETE /api/reminders/:id: cancels. */
export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ reminder: await reminders.cancelReminder(idParam(req), me(req)) });
};
