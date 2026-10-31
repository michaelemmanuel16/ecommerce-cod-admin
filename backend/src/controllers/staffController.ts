import { NextFunction, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { auditService } from '../services/auditService';
import * as staffService from '../services/staffService';
import { formatIssues } from '../tools/shared';
import { permanentDeleteSchema, resetPasswordSchema, staffQuerySchema, updateStaffSchema } from '../validators/staffSchema';

/** M6-T05: the staff table API. Routes -> this file -> staffService. */

const handler = (fn: (req: AuthRequest, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => { fn(req as AuthRequest, res).catch(next); };

const idParam = (raw: string): number => {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid staff ID', 400);
  return id;
};

const parse = <T extends z.ZodTypeAny>(schema: T, data: unknown, where: 'body' | 'query' = 'body'): z.infer<T> => {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error, where), 400, 'VALIDATION_ERROR');
  return parsed.data;
};

const actorOf = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });

const audit = (req: AuthRequest, action: string, staffId: number, metadata: Record<string, unknown> = {}) =>
  auditService.recordFromRequest(req, { action, resource: 'user', resourceId: String(staffId), metadata });

/** GET /api/staff?status&role&q: the rows plus the four tab counts. */
export const list = handler(async (req, res) => {
  res.json(await staffService.listStaff(parse(staffQuerySchema, req.query, 'query')));
});

/** GET /api/staff/workload: open orders per active person. */
export const workload = handler(async (_req, res) => {
  res.json({ workload: await staffService.staffWorkload() });
});

/** PUT /api/staff/:id. adminService.updateUser writes the audit row. */
export const update = handler(async (req, res) => {
  const staff = await staffService.updateStaff(actorOf(req), idParam(req.params.id), parse(updateStaffSchema, req.body));
  res.json({ staff });
});

export const resetPassword = handler(async (req, res) => {
  const id = idParam(req.params.id);
  await staffService.resetStaffPassword(actorOf(req), id, parse(resetPasswordSchema, req.body).password);
  res.json({ message: 'Password reset' });
});

export const deactivate = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const staff = await staffService.deactivateStaff(actorOf(req), id);
  await audit(req, 'staff_deactivate', id);
  res.json({ staff });
});

export const reactivate = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const staff = await staffService.reactivateStaff(actorOf(req), id);
  await audit(req, 'staff_reactivate', id);
  res.json({ staff });
});

/** DELETE /api/staff/:id: soft delete. */
export const remove = handler(async (req, res) => {
  const id = idParam(req.params.id);
  const staff = await staffService.deleteStaff(actorOf(req), id);
  await audit(req, 'staff_delete', id);
  res.json({ staff });
});

/** DELETE /api/staff/:id/permanent with `{confirm: "DELETE"}`. */
export const removePermanently = handler(async (req, res) => {
  const id = idParam(req.params.id);
  parse(permanentDeleteSchema, req.body);
  await staffService.permanentlyDeleteStaff(id);
  await audit(req, 'staff_permanent_delete', id);
  res.json({ message: 'Staff member permanently deleted' });
});
