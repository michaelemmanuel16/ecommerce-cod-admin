import { z } from 'zod';
import { positiveInt } from './common';
import { NOTE_SUBJECT_TYPES } from '../services/inbox/subjectAccess';

const isoDate = (what: string) => z.string().datetime({ offset: true, message: `${what} must be an ISO date and time` });

/** POST /api/reminders */
export const reminderCreateSchema = z.object({
  subjectType: z.enum(NOTE_SUBJECT_TYPES, { message: `Subject type must be one of: ${NOTE_SUBJECT_TYPES.join(', ')}` }).optional(),
  subjectId: positiveInt.optional(),
  note: z.string().trim().min(1, 'Write a note').max(1000, 'The note can be 1000 characters at most'),
  dueAt: isoDate('Due date'),
  assignedToId: positiveInt.optional(),
}).refine((b) => (b.subjectType === undefined) === (b.subjectId === undefined), { message: 'Send both subjectType and subjectId, or neither' });

/** PATCH /api/reminders/:id */
export const reminderPatchSchema = z.object({
  note: z.string().trim().min(1, 'Write a note').max(1000, 'The note can be 1000 characters at most').optional(),
  dueAt: isoDate('Due date').optional(),
  cancel: z.literal(true, { message: 'cancel must be true' }).optional(),
}).refine((b) => b.note !== undefined || b.dueAt !== undefined || b.cancel !== undefined, { message: 'Send note, dueAt or cancel' });

/** GET /api/reminders */
export const reminderListSchema = z.object({
  status: z.enum(['pending', 'sent', 'cancelled'], { message: 'Status must be pending, sent or cancelled' }).optional(),
  mine: z.enum(['1', 'true', '0', 'false']).optional(),
});
