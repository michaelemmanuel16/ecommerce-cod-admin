import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';

export const getAllDeliveries = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId, status, page = 1, limit = 20 } = req.query;

    const where: any = {};
    if (agentId) where.agentId = agentId;

    const skip = (Number(page) - 1) * Number(limit);

    const [deliveries, total] = await Promise.all([
      prisma.delivery.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          order: {
            include: {
              customer: {
                select: {
                  firstName: true,
                  lastName: true,
                  phoneNumber: true
                }
              }
            }
          },
          agent: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true
            }
          }
        },
        orderBy: { scheduledTime: 'asc' }
      }),
      prisma.delivery.count({ where })
    ]);

    res.json({
      deliveries,
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

export const getDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            customer: true,
            orderItems: {
              include: {
                product: true
              }
            }
          }
        },
        agent: true
      }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    res.json({ delivery });
  } catch (error) {
    throw error;
  }
};

export const uploadProofOfDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { proofType, proofData, recipientName, recipientPhone } = req.body;

    const delivery = await prisma.delivery.update({
      where: { id },
      data: {
        proofType,
        proofData,
        recipientName,
        recipientPhone
      }
    });

    res.json({ delivery });
  } catch (error) {
    throw error;
  }
};

export const completeDelivery = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { codAmount, proofType, proofData, recipientName } = req.body;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: { order: true }
    });

    if (!delivery) {
      throw new AppError('Delivery not found', 404);
    }

    // Update delivery
    await prisma.delivery.update({
      where: { id },
      data: {
        actualDeliveryTime: new Date(),
        proofType,
        proofData,
        recipientName
      }
    });

    // Update order status
    await prisma.order.update({
      where: { id: delivery.orderId },
      data: {
        status: 'delivered',
        paymentStatus: 'collected',
        orderHistory: {
          create: {
            status: 'delivered',
            notes: 'Order delivered successfully',
            changedBy: req.user?.id
          }
        }
      }
    });

    // Create transaction for COD collection
    await prisma.transaction.create({
      data: {
        orderId: delivery.orderId,
        type: 'cod_collection',
        amount: codAmount || delivery.order.codAmount || 0,
        paymentMethod: 'cash',
        status: 'collected',
        description: 'COD payment collected on delivery'
      }
    });

    res.json({ message: 'Delivery completed successfully' });
  } catch (error) {
    throw error;
  }
};

export const getAgentRoute = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { agentId } = req.params;
    const { date } = req.query;

    const targetDate = date ? new Date(date as string) : new Date();
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const deliveries = await prisma.delivery.findMany({
      where: {
        agentId,
        scheduledTime: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      include: {
        order: {
          include: {
            customer: {
              select: {
                firstName: true,
                lastName: true,
                phoneNumber: true
              }
            }
          }
        }
      },
      orderBy: { scheduledTime: 'asc' }
    });

    const route = deliveries.map(d => ({
      deliveryId: d.id,
      orderId: d.orderId,
      orderNumber: d.order.orderNumber,
      customer: d.order.customer,
      address: d.order.deliveryAddress,
      area: d.order.deliveryArea,
      scheduledTime: d.scheduledTime,
      status: d.order.status,
      codAmount: d.order.codAmount
    }));

    res.json({ route });
  } catch (error) {
    throw error;
  }
};
