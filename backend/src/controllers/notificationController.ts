import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';

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
