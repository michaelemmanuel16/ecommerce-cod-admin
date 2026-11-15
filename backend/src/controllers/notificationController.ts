import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { preferencesPutSchema, roleDefaultsPutSchema, roleDefaultsQuerySchema } from '../validators/inboxSchema';
import * as inboxPreferences from '../services/inbox/inboxPreferences';
import * as feed from '../services/inbox/inboxFeedService';
import { pushInboxCounts } from '../services/inbox/inboxRealtime';

export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = 1, limit = 20, unreadOnly } = req.query;

    const where: any = {
      userId: req.user!.id
    };

    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          userId: req.user!.id,
          isRead: false
        }
      })
    ]);

    res.json({
      notifications,
      unreadCount,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    throw error;
  }
};

/** Unread count of the signed-in user (F-106): the inbox's "all" count, from the database. The bell reads this; the socket event `notification` tells it to refresh. */
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  const counts = await feed.getCounts(req.user!.id);
  res.json({ unreadCount: counts.all });
};

export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new AppError('Notification ID must be a whole number', 400);
  const notification = await feed.patchRow(req.user!.id, id, { read: true });
  await pushInboxCounts(req.user!.id, req.user!.tenantId!);
  res.json({ notification });
};

export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  await feed.markAll(req.user!.id, 'all');
  await pushInboxCounts(req.user!.id, req.user!.tenantId!);
  res.json({ message: 'All notifications marked as read' });
};

/** GET /api/notifications/preferences: my channels for every event, merged with the role defaults. */
export const getPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  res.json({ preferences: await inboxPreferences.getMyPreferences({ id: req.user!.id, role: req.user!.role }) });
};

/** PUT /api/notifications/preferences { preferences: [{ event, inApp?, email?, sms?, whatsapp? }] } */
export const putPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = preferencesPutSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json({ preferences: await inboxPreferences.savePreferences({ id: req.user!.id, role: req.user!.role }, parsed.data.preferences) });
};

/**
 * Which roles' defaults a caller may read and change. Owner (super_admin) edits all of them; an admin edits all but Owner;
 * a manager edits the other roles (Manager included) but never Owner or Admin. Anyone else gets none.
 */
const PROTECTED_FROM: Record<string, UserRole[]> = {
  super_admin: [],
  admin: ['super_admin'],
  manager: ['super_admin', 'admin'],
};
const canEditRole = (caller: UserRole, target: UserRole): boolean => caller in PROTECTED_FROM && !PROTECTED_FROM[caller].includes(target);

/** GET /api/notifications/role-defaults?role= (owner, admin and manager; a manager never sees Owner or Admin) */
export const getRoleDefaults = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = roleDefaultsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  const caller = req.user!.role;
  if (parsed.data.role && !canEditRole(caller, parsed.data.role)) throw new AppError('You cannot manage notification defaults for this role', 403);
  const roles = await inboxPreferences.getRoleDefaults(parsed.data.role);
  res.json({ roles: roles.filter((r) => canEditRole(caller, r.role)) });
};

/** PUT /api/notifications/role-defaults { role, defaults: [...] } (same role rule as the read) */
export const putRoleDefaults = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = roleDefaultsPutSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  if (!canEditRole(req.user!.role, parsed.data.role)) throw new AppError('You cannot manage notification defaults for this role', 403);
  res.json({ roles: await inboxPreferences.saveRoleDefaults(parsed.data.role, parsed.data.defaults) });
};
