import { z } from 'zod';
import { positiveInt } from './common';
import { NOTE_SUBJECT_TYPES } from '../services/inbox/subjectAccess';

export const COMMENT_MAX_LENGTH = 4000;

const body = z.string().min(1, 'Write a comment').max(COMMENT_MAX_LENGTH, `A comment can be ${COMMENT_MAX_LENGTH} characters at most`)
  .refine((b) => b.trim().length > 0, { message: 'Write a comment' });

/** :type and :id of /api/threads/by-subject/:type/:id */
export const threadSubjectSchema = z.object({
  type: z.enum(NOTE_SUBJECT_TYPES, { message: `Subject type must be one of: ${NOTE_SUBJECT_TYPES.join(', ')}` }),
  id: positiveInt,
});

/** POST /api/threads/by-subject/:type/:id/comments */
export const commentCreateSchema = z.object({
  body,
  parentId: positiveInt.optional(),
  mentionIds: z.array(positiveInt).max(50, 'Mention 50 people at most').optional(),
});

/** PATCH /api/comments/:id */
export const commentPatchSchema = z.object({ body });
