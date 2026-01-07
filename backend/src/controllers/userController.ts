import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import bcrypt from 'bcrypt';
import { getRepPerformanceDetails } from '../services/repPerformanceService';

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
          country: true,
          commissionRate: true,
          vehicleType: true,
          vehicleId: true,
          deliveryRate: true,
          totalEarnings: true,
          location: true,
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
    const { id: idParam } = req.params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      throw new AppError('Invalid user ID', 400);
    }

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
        country: true,
        commissionRate: true,
        vehicleType: true,
        vehicleId: true,
        deliveryRate: true,
        totalEarnings: true,
        location: true,
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
    const { id: idParam } = req.params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      throw new AppError('Invalid user ID', 400);
    }

    const {
      firstName,
      lastName,
      phoneNumber,
      role,
      isActive,
      vehicleType,
      vehicleId,
      deliveryRate,
      totalEarnings,
      location
    } = req.body;

    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (vehicleType !== undefined) updateData.vehicleType = vehicleType;
    if (vehicleId !== undefined) updateData.vehicleId = vehicleId;
    if (deliveryRate !== undefined) updateData.deliveryRate = Number(deliveryRate);
    if (totalEarnings !== undefined) updateData.totalEarnings = Number(totalEarnings);
    if (location !== undefined) updateData.location = location;

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        role: true,
        isActive: true,
        isAvailable: true,
        country: true,
        commissionRate: true,
        vehicleType: true,
        vehicleId: true,
        deliveryRate: true,
        totalEarnings: true,
        location: true,
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
    const { id: idParam } = req.params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      throw new AppError('Invalid user ID', 400);
    }

    // Check if user has any active/pending orders assigned
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        role: true,
        assignedOrdersAsAgent: {
          where: {
            status: {
              notIn: ['delivered', 'cancelled', 'returned']
            }
          },
          select: { id: true }
        },
        assignedOrdersAsRep: {
          where: {
            status: {
              notIn: ['delivered', 'cancelled', 'returned']
            }
          },
          select: { id: true }
        }
      }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const hasActiveOrders =
      user.assignedOrdersAsAgent.length > 0 ||
      user.assignedOrdersAsRep.length > 0;

    if (hasActiveOrders) {
      throw new AppError(
        'Cannot delete user with active orders. Please reassign or complete orders first.',
        400
      );
    }

    // Deactivate instead of permanently delete
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
    throw error;
  }
};

export const getRepWorkload = async (_req: AuthRequest, res: Response): Promise<void> => {
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

    const agents = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        isAvailable: true,
        vehicleType: true,
        vehicleId: true,
        deliveryRate: true,
        commissionRate: true,
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
        successRate: total > 0 ? (delivered / total) * 100 : 0,
        vehicleType: agent.vehicleType,
        vehicleId: agent.vehicleId,
        deliveryRate: agent.deliveryRate || 0,
        totalEarnings: agent.totalEarnings || 0,
        location: agent.location
      };
    });

    res.json({ performance });
  } catch (error) {
    throw error;
  }
};

export const getRepPerformance = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { repId, startDate, endDate } = req.query;

    const performance = await getRepPerformanceDetails(
      repId as string | undefined,
      startDate as string | undefined,
      endDate as string | undefined
    );

    res.json({ performance });
  } catch (error) {
    throw error;
  }
};

export const updateRepDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id: idParam } = req.params;
    const id = parseInt(idParam, 10);

    if (isNaN(id)) {
      throw new AppError('Invalid user ID', 400);
    }

    const {
      firstName,
      lastName,
      phoneNumber,
      email,
      commissionRate,
      isActive,
      isAvailable
    } = req.body;

    // Validate that the user is a sales rep
    const existingUser = await prisma.user.findUnique({
      where: { id },
      select: { role: true }
    });

    if (!existingUser) {
      throw new AppError('Sales representative not found', 404);
    }

    if (existingUser.role !== 'sales_rep') {
      throw new AppError('User is not a sales representative', 400);
    }

    // Validate commission rate if provided (now it's a fixed amount, not a percentage)
    if (commissionRate !== undefined) {
      const amount = Number(commissionRate);
      if (isNaN(amount) || amount < 0) {
        throw new AppError('Commission amount must be a positive number', 400);
      }
    }

    // Build update data object
    const updateData: any = {};
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (email !== undefined) updateData.email = email;
    if (req.body.country !== undefined) updateData.country = req.body.country;
    if (commissionRate !== undefined) updateData.commissionRate = Number(commissionRate);
    if (isActive !== undefined) updateData.isActive = isActive;
    if (isAvailable !== undefined) updateData.isAvailable = isAvailable;

    // Update the rep
    const updatedRep = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        country: true,
        role: true,
        commissionRate: true,
        isActive: true,
        isAvailable: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({
      message: 'Sales representative updated successfully',
      rep: updatedRep
    });
  } catch (error) {
    throw error;
  }
};

export const getUserPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
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
    throw error;
  }
};

export const updateUserPreferences = async (req: AuthRequest, res: Response): Promise<void> => {
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
    throw error;
  }
};
