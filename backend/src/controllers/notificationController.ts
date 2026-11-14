import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { formatIssues } from '../tools/shared';
import { preferencesPutSchema, roleDefaultsPutSchema, roleDefaultsQuerySchema } from '../validators/inboxSchema';
import * as inboxPreferences from '../services/inbox/inboxPreferences';

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

/** Unread rows of the signed-in user (F-106). The bell reads this; the socket event `notification` tells it to refresh. */
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  const unreadCount = await prisma.notification.count({
    where: { userId: req.user!.id, isRead: false }
  });
  res.json({ unreadCount });
};

export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const notification = await prisma.notification.update({
      where: {
        id: parseInt(id, 10),
        userId: req.user!.id
      },
      data: {
        isRead: true
      }
    });

    res.json({ notification });
  } catch (error) {
    throw error;
  }
};

export const markAllAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.notification.updateMany({
      where: {
        userId: req.user!.id,
        isRead: false
      },
      data: {
        isRead: true
      }
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    throw error;
  }
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

/** GET /api/notifications/role-defaults?role= (owner and admin) */
export const getRoleDefaults = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = roleDefaultsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json({ roles: await inboxPreferences.getRoleDefaults(parsed.data.role) });
};

/** PUT /api/notifications/role-defaults { role, defaults: [...] } (owner and admin) */
export const putRoleDefaults = async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = roleDefaultsPutSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw new AppError(formatIssues(parsed.error), 400);
  res.json({ roles: await inboxPreferences.saveRoleDefaults(parsed.data.role, parsed.data.defaults) });
};
