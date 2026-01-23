import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { getRepPerformanceDetails } from '../services/repPerformanceService';
import { adminService } from '../services/adminService';

export const getAllUsers = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { role, isActive, page = 1, limit = 20 } = req.query;
    const result = await adminService.getAllUsers(
      req.user!,
      Number(page),
      Number(limit),
      role as any,
      isActive === 'true' ? true : isActive === 'false' ? false : undefined
    );

    res.json({
      users: result.users,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        pages: result.totalPages
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await adminService.createUser(req.user!, req.body);
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
};

export const getUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid user ID', 400);

    const user = await adminService.getUserById(req.user!, id);
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

export const updateUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid user ID', 400);

    const user = await adminService.updateUser(req.user!, id, req.body);
    res.json({ user });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid user ID', 400);

    await adminService.deleteUser(req.user!, id);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    next(error);
  }
};

export const toggleAvailability = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: idParam } = req.params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      throw new AppError('Invalid user ID', 400);
    }

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
    next(error);
  }
};

export const getRepWorkload = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
    next(error);
  }
};

export const getAgentPerformance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const where: any = {
      role: 'delivery_agent',
      isActive: true
    };

    const orderWhere: any = {};
    if (startDate || endDate) {
      orderWhere.createdAt = {};
      if (startDate) {
        orderWhere.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        orderWhere.createdAt.lte = new Date(endDate as string);
      }
    }

    const agents = (await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAvailable: true,
        vehicleType: true,
        vehicleId: true,
        deliveryRate: true,
        commissionAmount: true,
        totalEarnings: true,
        location: true,
        country: true,
        assignedOrdersAsAgent: {
          where: orderWhere,
          select: {
            id: true,
            status: true
          }
        }
      } as any
    })) as any[];

    const performance = agents.map(agent => {
      const total = agent.assignedOrdersAsAgent.length;
      const delivered = agent.assignedOrdersAsAgent.filter((o: any) => o.status === 'delivered').length;
      const pending = agent.assignedOrdersAsAgent.filter((o: any) =>
        !['delivered', 'cancelled', 'returned'].includes(o.status)
      ).length;

      const rate = agent.deliveryRate || agent.commissionAmount || 0;
      const calculatedEarnings = delivered * rate;

      return {
        userId: agent.id,
        userName: `${agent.firstName} ${agent.lastName}`,
        isAvailable: agent.isAvailable,
        totalAssigned: total,
        completed: delivered,
        pending,
        successRate: total > 0 ? (delivered / total) * 100 : 0,
        vehicleType: agent.vehicleType,
        vehicleId: agent.vehicleId,
        deliveryRate: rate,
        totalEarnings: calculatedEarnings,
        location: agent.location
      };
    });

    res.json({ performance });
  } catch (error) {
    next(error);
  }
};

export const getRepPerformance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    let { repId, startDate, endDate } = req.query;

    // Safety check: Sales reps can only see their own performance
    if (req.user?.role === 'sales_rep') {
      repId = req.user.id.toString();
    }

    const performance = await getRepPerformanceDetails(
      repId as string | undefined,
      startDate as string | undefined,
      endDate as string | undefined
    );

    res.json({ performance });
  } catch (error) {
    next(error);
  }
};

export const updateRepDetails = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new AppError('Invalid user ID', 400);

    const user = await adminService.updateUser(req.user!, id, req.body);
    res.json({
      message: 'Sales representative updated successfully',
      rep: user
    });
  } catch (error) {
    next(error);
  }
};

export const getUserPreferences = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({ preferences: user.preferences || {} });
  } catch (error) {
    next(error);
  }
};

export const updateUserPreferences = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { preferences } = req.body;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    // Check if user exists first
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!userExists) {
      throw new AppError('User not found. Please log in again.', 401);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { preferences },
      select: { preferences: true }
    });

    res.json({ preferences: updatedUser.preferences });
  } catch (error) {
    next(error);
  }
};
