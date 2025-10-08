import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import bcrypt from 'bcrypt';

export const getAllUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { role, isActive, page = 1, limit = 20 } = req.query;

    const where: any = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const skip = (Number(page) - 1) * Number(limit);

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: Number(limit),
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          role: true,
          isActive: true,
          isAvailable: true,
          lastLogin: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      users,
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

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password, firstName, lastName, phoneNumber, role } = req.body;

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError('User already exists', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        phoneNumber,
        role
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        createdAt: true
      }
    });

    res.status(201).json({ user });
  } catch (error) {
    throw error;
  }
};

export const getUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        isAvailable: true,
        lastLogin: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({ user });
  } catch (error) {
    throw error;
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { firstName, lastName, phoneNumber, role, isActive } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: {
        firstName,
        lastName,
        phoneNumber,
        role,
        isActive
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        updatedAt: true
      }
    });

    res.json({ user });
  } catch (error) {
    throw error;
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.user.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    throw error;
  }
};

export const toggleAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { isAvailable },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAvailable: true
      }
    });

    res.json({ user });
  } catch (error) {
    throw error;
  }
};

export const getRepWorkload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reps = await prisma.user.findMany({
      where: {
        role: 'sales_rep',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAvailable: true,
        assignedOrdersAsRep: {
          where: {
            status: {
              notIn: ['delivered', 'cancelled', 'returned']
            }
          },
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    const workload = reps.map(rep => ({
      userId: rep.id,
      userName: `${rep.firstName} ${rep.lastName}`,
      isAvailable: rep.isAvailable,
      activeOrders: rep.assignedOrdersAsRep.length,
      byStatus: rep.assignedOrdersAsRep.reduce((acc: any, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {})
    }));

    res.json({ workload });
  } catch (error) {
    throw error;
  }
};

export const getAgentPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const agents = await prisma.user.findMany({
      where: {
        role: 'delivery_agent',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAvailable: true,
        assignedOrdersAsAgent: {
          select: {
            id: true,
            status: true
          }
        }
      }
    });

    const performance = agents.map(agent => {
      const total = agent.assignedOrdersAsAgent.length;
      const delivered = agent.assignedOrdersAsAgent.filter(o => o.status === 'delivered').length;
      const pending = agent.assignedOrdersAsAgent.filter(o =>
        !['delivered', 'cancelled', 'returned'].includes(o.status)
      ).length;

      return {
        userId: agent.id,
        userName: `${agent.firstName} ${agent.lastName}`,
        isAvailable: agent.isAvailable,
        totalAssigned: total,
        completed: delivered,
        pending,
        successRate: total > 0 ? (delivered / total) * 100 : 0
      };
    });

    res.json({ performance });
  } catch (error) {
    throw error;
  }
};
