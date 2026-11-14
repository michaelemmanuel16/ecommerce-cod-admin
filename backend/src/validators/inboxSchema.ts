import { UserRole } from '@prisma/client';
import { z } from 'zod';

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
