import { Response } from 'express';
import { AuthRequest } from '../types';
import { OrderStatus } from '@prisma/client';
import orderService from '../services/orderService';

export const getAllOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      status,
      customerId,
      customerRepId,
      deliveryAgentId,
      area,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const result = await orderService.getAllOrders({
      status: status as OrderStatus | undefined,
      customerId: customerId as string | undefined,
      customerRepId: customerRepId as string | undefined,
      deliveryAgentId: deliveryAgentId as string | undefined,
      area: area as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      search: search as string | undefined,
      page: Number(page),
      limit: Number(limit)
    });

    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const createOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      customerId,
      customerPhone,
      customerEmail,
      customerName,
      alternatePhone,
      orderItems,
      subtotal,
      shippingCost,
      discount,
      totalAmount,
      deliveryAddress,
      deliveryState,
      deliveryArea,
      notes,
      estimatedDelivery
    } = req.body;

    const order = await orderService.createOrder({
      customerId,
      customerPhone,
      customerEmail,
      customerName,
      alternatePhone,
      orderItems,
      subtotal,
      shippingCost,
      discount,
      totalAmount,
      deliveryAddress,
      deliveryState,
      deliveryArea,
      notes,
      estimatedDelivery: estimatedDelivery ? new Date(estimatedDelivery) : undefined,
      createdById: req.user?.id
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
      throw new Error('Invalid orders data');
    }

    const results = await orderService.bulkImportOrders(orders, req.user?.id);

    res.json({ results });
  } catch (error) {
    throw error;
  }
};

export const getOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const order = await orderService.getOrderById(id);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const updateOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const order = await orderService.updateOrder(id, updateData);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const deleteOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await orderService.cancelOrder(id, req.user?.id, 'Order cancelled');
    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const updateOrderStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const order = await orderService.updateOrderStatus(id, {
      status: status as OrderStatus,
      notes,
      changedBy: req.user?.id
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
    const order = await orderService.assignCustomerRep(id, customerRepId, req.user?.id);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const assignDeliveryAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { deliveryAgentId } = req.body;
    const order = await orderService.assignDeliveryAgent(id, deliveryAgentId, req.user?.id);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const getKanbanView = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { area, agentId } = req.query;
    const kanban = await orderService.getKanbanView({
      area: area as string | undefined,
      agentId: agentId as string | undefined
    });
    res.json({ kanban });
  } catch (error) {
    throw error;
  }
};

export const getOrderStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await orderService.getOrderStats({
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined
    });
    res.json({ stats });
  } catch (error) {
    throw error;
  }
};
