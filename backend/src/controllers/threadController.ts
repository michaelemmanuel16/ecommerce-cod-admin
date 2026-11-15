import { Response } from 'express';
import { AuthRequest } from '../types';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { commentCreateSchema, commentPatchSchema, threadSubjectSchema } from '../validators/threadSchema';
import * as threads from '../services/threadService';

const me = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role as string });

const subjectOf = (req: AuthRequest) => {
  const parsed = threadSubjectSchema.safeParse(req.params);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  return parsed.data;
};

const commentId = (req: AuthRequest): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Comment ID must be a positive whole number', 400);
  return id;
};

/** GET /api/threads/by-subject/:type/:id */
export const getBySubject = async (req: AuthRequest, res: Response): Promise<void> => {
  const { type, id } = subjectOf(req);
  res.json(await threads.getThreadBySubject(type, id, me(req)));
};

/** GET /api/threads/by-subject/:type/:id/mentionable */
export const getMentionable = async (req: AuthRequest, res: Response): Promise<void> => {
  const { type, id } = subjectOf(req);
  res.json(await threads.listMentionable(type, id, me(req)));
};

/** POST /api/threads/by-subject/:type/:id/comments { body, parentId?, mentionIds? } */
export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { type, id } = subjectOf(req);
  const parsed = commentCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.status(201).json(await threads.addComment(type, id, parsed.data, me(req)));
};

/** PATCH /api/comments/:id { body } */
export const editComment = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = commentPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json(await threads.editComment(commentId(req), parsed.data.body, me(req)));
};

/** DELETE /api/comments/:id */
export const deleteComment = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json(await threads.deleteComment(commentId(req), me(req)));
};
