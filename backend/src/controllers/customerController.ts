import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

export const getAllCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, city, area, page = 1, limit = 20 } = req.query;

    const where: any = { isActive: true };

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { phoneNumber: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (city) where.city = city;
    if (area) where.area = area;

    const skip = (Number(page) - 1) * Number(limit);

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.customer.count({ where })
    ]);

    res.json({
      customers,
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

export const createCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const customerData = req.body;

    const existingCustomer = await prisma.customer.findUnique({
      where: { phoneNumber: customerData.phoneNumber }
    });

    if (existingCustomer) {
      throw new AppError('Customer with this phone number already exists', 400);
    }

    const customer = await prisma.customer.create({
      data: customerData
    });

    res.status(201).json({ customer });
  } catch (error) {
    throw error;
  }
};

export const getCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true
          }
        }
      }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const customer = await prisma.customer.update({
      where: { id },
      data: updateData
    });

    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.customer.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ message: 'Customer deactivated successfully' });
  } catch (error) {
    throw error;
  }
};

export const updateCustomerTags = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { tags } = req.body;

    const customer = await prisma.customer.update({
      where: { id },
      data: { tags }
    });

    res.json({ customer });
  } catch (error) {
    throw error;
  }
};

export const getCustomerAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          select: {
            id: true,
            totalAmount: true,
            status: true,
            createdAt: true
          }
        }
      }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const analytics = {
      totalOrders: customer.orders.length,
      totalSpent: customer.orders.reduce((sum, order) => sum + order.totalAmount, 0),
      avgOrderValue: customer.orders.length > 0
        ? customer.orders.reduce((sum, order) => sum + order.totalAmount, 0) / customer.orders.length
        : 0,
      ordersByStatus: customer.orders.reduce((acc: any, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {}),
      lastOrderDate: customer.orders.length > 0
        ? customer.orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt
        : null
    };

    res.json({ analytics });
  } catch (error) {
    throw error;
  }
};
