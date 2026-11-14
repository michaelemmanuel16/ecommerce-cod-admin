import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { INBOX_STATUSES, INBOX_VIEWS } from '../services/inbox/inboxFeedService';

const channelItem = z.object({
  event: z.string().min(1),
  inApp: z.boolean().optional(),
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  whatsapp: z.boolean().optional(),
});

/** PUT /api/notifications/preferences */
export const preferencesPutSchema = z.object({ preferences: z.array(channelItem).min(1).max(100) });

/** GET /api/notifications/role-defaults?role= */
export const roleDefaultsQuerySchema = z.object({
  role: z.enum(Object.values(UserRole) as [UserRole, ...UserRole[]], { message: 'Unknown role' }).optional(),
});

/** PUT /api/notifications/role-defaults */
export const roleDefaultsPutSchema = z.object({
  role: z.enum(Object.values(UserRole) as [UserRole, ...UserRole[]], { message: 'Unknown role' }),
  defaults: z.array(channelItem).min(1).max(100),
});

const positiveInt = z.coerce.number().int().positive();

/** GET /api/inbox */
export const inboxFeedQuerySchema = z.object({
  view: z.enum(INBOX_VIEWS, { message: `View must be one of: ${INBOX_VIEWS.join(', ')}` }).default('all'),
  status: z.enum(INBOX_STATUSES, { message: `Status must be one of: ${INBOX_STATUSES.join(', ')}` }).default('open'),
  scope: z.enum(['mine', 'all'], { message: 'Scope must be mine or all' }).default('mine'),
  cursor: z.string().min(1).max(200).optional(),
  limit: positiveInt.max(100).optional(),
});

/** PATCH /api/inbox/:id */
export const inboxPatchSchema = z.object({
  read: z.boolean().optional(),
  done: z.boolean().optional(),
  snoozedUntil: z.string().datetime({ offset: true, message: 'snoozedUntil must be an ISO date and time' }).nullable().optional(),
}).refine((b) => b.read !== undefined || b.done !== undefined || b.snoozedUntil !== undefined, { message: 'Send read, done or snoozedUntil' });

/** POST /api/inbox/mark-all */
export const inboxMarkAllSchema = z.object({
  view: z.enum(INBOX_VIEWS, { message: `View must be one of: ${INBOX_VIEWS.join(', ')}` }).default('all'),
});
