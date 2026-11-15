import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { templateCreateSchema, templateListSchema, templateUpdateSchema } from '../validators/messageTemplateSchema';
import * as templates from '../services/messaging/templateService';

const tenantOf = (req: AuthRequest): string => {
  if (!req.user?.tenantId) throw new AppError('This account has no templates', 403);
  return req.user.tenantId;
};
const idOf = (req: AuthRequest): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
  return id;
};

/** GET /api/message-templates */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = templateListSchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json({ items: await templates.listTemplates(tenantOf(req), parsed.data) });
};

/** POST /api/message-templates */
export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = templateCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.status(201).json(await templates.createTemplate(tenantOf(req), parsed.data));
};

/** PUT /api/message-templates/:id */
export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = templateUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await templates.updateTemplate(tenantOf(req), idOf(req), parsed.data));
};

/** DELETE /api/message-templates/:id */
export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  await templates.deleteTemplate(tenantOf(req), idOf(req));
  res.status(204).end();
};

/** POST /api/message-templates/sync */
export const sync = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await templates.syncWhatsappTemplates(tenantOf(req)));
};
