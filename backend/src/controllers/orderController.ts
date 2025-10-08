import { Response } from 'express';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { OrderStatus } from '@prisma/client';

export const getAllOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      status,
      customerRepId,
      deliveryAgentId,
      area,
      city,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const where: any = {};

    if (status) where.status = status;
    if (customerRepId) where.customerRepId = customerRepId;
    if (deliveryAgentId) where.deliveryAgentId = deliveryAgentId;
    if (area) where.deliveryArea = area;
    if (city) where.deliveryCity = city;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search as string, mode: 'insensitive' } },
        { customer: { phoneNumber: { contains: search as string } } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip,
        take: Number(limit),
        include: {
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phoneNumber: true
            }
          },
          customerRep: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          deliveryAgent: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where })
    ]);

    res.json({
      orders,
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

export const createOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      customerId,
      orderItems,
      subtotal,
      shippingCost = 0,
      discount = 0,
      totalAmount,
      deliveryAddress,
      deliveryCity,
      deliveryState,
      deliveryZipCode,
      deliveryArea,
      notes,
      estimatedDelivery
    } = req.body;

    // Generate order number
    const orderCount = await prisma.order.count();
    const orderNumber = `ORD-${Date.now()}-${String(orderCount + 1).padStart(5, '0')}`;

    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId,
        subtotal,
        shippingCost,
        discount,
        totalAmount,
        codAmount: totalAmount,
        deliveryAddress,
        deliveryCity,
        deliveryState,
        deliveryZipCode,
        deliveryArea,
        notes,
        estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : null,
        createdById: req.user?.id,
        orderItems: {
          create: orderItems.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice
          }))
        },
        orderHistory: {
          create: {
            status: 'pending_confirmation',
            notes: 'Order created',
            changedBy: req.user?.id
          }
        }
      },
      include: {
        customer: true,
        orderItems: {
          include: {
            product: true
          }
        }
      }
    });

    // Update customer stats
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        totalOrders: { increment: 1 },
        totalSpent: { increment: totalAmount }
      }
    });

    res.status(201).json({ order });
  } catch (error) {
    throw error;
  }
};

export const bulkImportOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { orders } = req.body;

    if (!Array.isArray(orders) || orders.length === 0) {
      throw new AppError('Invalid orders data', 400);
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (const orderData of orders) {
      try {
        // Find or create customer
        let customer = await prisma.customer.findUnique({
          where: { phoneNumber: orderData.customerPhone }
        });

        if (!customer) {
          customer = await prisma.customer.create({
            data: {
              firstName: orderData.customerFirstName || 'Unknown',
              lastName: orderData.customerLastName || '',
              phoneNumber: orderData.customerPhone,
              address: orderData.deliveryAddress,
              city: orderData.deliveryCity,
              state: orderData.deliveryState,
              zipCode: orderData.deliveryZipCode,
              area: orderData.deliveryArea
            }
          });
        }

        const orderCount = await prisma.order.count();
        const orderNumber = `ORD-${Date.now()}-${String(orderCount + 1).padStart(5, '0')}`;

        await prisma.order.create({
          data: {
            orderNumber,
            customerId: customer.id,
            subtotal: orderData.subtotal,
            totalAmount: orderData.totalAmount,
            codAmount: orderData.totalAmount,
            deliveryAddress: orderData.deliveryAddress,
            deliveryCity: orderData.deliveryCity,
            deliveryState: orderData.deliveryState,
            deliveryZipCode: orderData.deliveryZipCode,
            deliveryArea: orderData.deliveryArea,
            source: 'bulk_import',
            createdById: req.user?.id,
            orderHistory: {
              create: {
                status: 'pending_confirmation',
                notes: 'Order imported via bulk CSV',
                changedBy: req.user?.id
              }
            }
          }
        });

        results.success++;
      } catch (err: any) {
        results.failed++;
        results.errors.push({
          order: orderData,
          error: err.message
        });
      }
    }

    res.json({ results });
  } catch (error) {
    throw error;
  }
};

export const getOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        customerRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        deliveryAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        },
        orderItems: {
          include: {
            product: true
          }
        },
        orderHistory: {
          orderBy: { createdAt: 'desc' }
        },
        delivery: true,
        transaction: true
      }
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const updateOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        orderItems: {
          include: {
            product: true
          }
        }
      }
    });

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const deleteOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.order.update({
      where: { id },
      data: {
        status: 'cancelled',
        orderHistory: {
          create: {
            status: 'cancelled',
            notes: 'Order cancelled',
            changedBy: req.user?.id
          }
        }
      }
    });

    res.json({ message: 'Order cancelled successfully' });
  } catch (error) {
    throw error;
  }
};

export const updateOrderStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const order = await prisma.order.update({
      where: { id },
      data: {
        status: status as OrderStatus,
        orderHistory: {
          create: {
            status: status as OrderStatus,
            notes: notes || `Status changed to ${status}`,
            changedBy: req.user?.id
          }
        }
      },
      include: {
        customer: true
      }
    });

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const assignCustomerRep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { customerRepId } = req.body;

    const order = await prisma.order.update({
      where: { id },
      data: {
        customerRepId,
        orderHistory: {
          create: {
            status: prisma.order.fields.status,
            notes: 'Customer rep assigned',
            changedBy: req.user?.id,
            metadata: { assignedRepId: customerRepId }
          }
        }
      },
      include: {
        customerRep: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const assignDeliveryAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { deliveryAgentId } = req.body;

    const order = await prisma.order.update({
      where: { id },
      data: {
        deliveryAgentId,
        orderHistory: {
          create: {
            status: prisma.order.fields.status,
            notes: 'Delivery agent assigned',
            changedBy: req.user?.id,
            metadata: { assignedAgentId: deliveryAgentId }
          }
        }
      },
      include: {
        deliveryAgent: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const getKanbanView = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { area, agentId } = req.query;

    const where: any = {};
    if (area) where.deliveryArea = area;
    if (agentId) where.deliveryAgentId = agentId;

    const orders = await prisma.order.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true
          }
        },
        orderItems: {
          include: {
            product: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: { priority: 'desc' }
    });

    const kanban = {
      pending_confirmation: orders.filter(o => o.status === 'pending_confirmation'),
      confirmed: orders.filter(o => o.status === 'confirmed'),
      preparing: orders.filter(o => o.status === 'preparing'),
      ready_for_pickup: orders.filter(o => o.status === 'ready_for_pickup'),
      out_for_delivery: orders.filter(o => o.status === 'out_for_delivery'),
      delivered: orders.filter(o => o.status === 'delivered'),
      cancelled: orders.filter(o => o.status === 'cancelled'),
      returned: orders.filter(o => o.status === 'returned'),
      failed_delivery: orders.filter(o => o.status === 'failed_delivery')
    };

    res.json({ kanban });
  } catch (error) {
    throw error;
  }
};

export const getOrderStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;

    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [
      totalOrders,
      ordersByStatus,
      totalRevenue,
      avgOrderValue
    ] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true
      }),
      prisma.order.aggregate({
        where: { ...where, status: 'delivered' },
        _sum: { totalAmount: true }
      }),
      prisma.order.aggregate({
        where,
        _avg: { totalAmount: true }
      })
    ]);

    const stats = {
      totalOrders,
      ordersByStatus: ordersByStatus.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as any),
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      avgOrderValue: avgOrderValue._avg.totalAmount || 0
    };

    res.json({ stats });
  } catch (error) {
    throw error;
  }
};
