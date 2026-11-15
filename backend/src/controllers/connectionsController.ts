import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { listConnectionCards } from '../services/connections/connectionCards';
import { listActivity } from '../services/connections/connectionEventService';
import { CSV_TEMPLATE_COLUMNS } from '../utils/partnerCsv';

const tenantOf = (req: AuthRequest): string => {
  if (!req.user?.tenantId) throw new AppError('This account has no connections', 403);
  return req.user.tenantId;
};

/** GET /api/connections */
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  const tenantId = tenantOf(req);
  const cards = await listConnectionCards(tenantId);
  res.json({
    ...cards,
    // M9-T29: the CSV tool is always there; the card links to the template and to the partner CSV preview route
    csv: {
      status: 'connected',
      reason: null,
      lastEventAt: null,
      templateUrl: '/api/connections/csv/template',
      previewRoute: '/api/delivery-partners/:id/csv/preview',
    },
  });
};

const activityQuery = z.object({
  level: z.enum(['all', 'error', 'warning']).optional(),
  cursor: z.string().max(200).optional(),
});

/** GET /api/connections/activity */
export const activity = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = activityQuery.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await listActivity(tenantOf(req), parsed.data));
};

/** GET /api/connections/csv/template: a header row with the columns the partner CSV tool reads (M5). */
export const csvTemplate = (_req: AuthRequest, res: Response): void => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="partner-status-template.csv"');
  res.send(`${CSV_TEMPLATE_COLUMNS.join(',')}\n`);
};
