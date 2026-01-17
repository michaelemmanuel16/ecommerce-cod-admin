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
      limit = 50
    } = req.query;

    // Parse status - can be a single value or array
    let parsedStatus: OrderStatus[] | undefined;
    if (status) {
      parsedStatus = Array.isArray(status) ? status as OrderStatus[] : [status as OrderStatus];
    }

    // ROLE-BASED FILTERING: Sales reps can only see their assigned orders
    let effectiveCustomerRepId = customerRepId ? Number(customerRepId) : undefined;
    if (req.user?.role === 'sales_rep') {
      effectiveCustomerRepId = req.user.id; // Override with user's own ID
    }

    // ROLE-BASED FILTERING: Delivery agents can only see their assigned orders
    let effectiveDeliveryAgentId = deliveryAgentId ? Number(deliveryAgentId) : undefined;
    if (req.user?.role === 'delivery_agent') {
      effectiveDeliveryAgentId = req.user.id; // Override with user's own ID
    }

    const result = await orderService.getAllOrders({
      status: parsedStatus,
      customerId: customerId ? Number(customerId) : undefined,
      customerRepId: effectiveCustomerRepId,
      deliveryAgentId: effectiveDeliveryAgentId,
      area: area as string | undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      search: search as string | undefined,
      page: Number(page),
      limit: Number(limit)
    }, req.user);

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
    const order = await orderService.getOrderById(Number(id), req.user);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const updateOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const order = await orderService.updateOrder(Number(id), updateData, req.user);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const deleteOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await orderService.deleteOrder(Number(id), req.user?.id, req.user);
    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const bulkDeleteOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = req.body;
    const result = await orderService.bulkDeleteOrders(ids, req.user?.id, req.user);
    res.json(result);
  } catch (error) {
    throw error;
  }
};

export const updateOrderStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const order = await orderService.updateOrderStatus(Number(id), {
      status: status as OrderStatus,
      notes,
      changedBy: req.user?.id
    }, req.user);

    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const assignCustomerRep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { customerRepId } = req.body;
    const order = await orderService.assignCustomerRep(Number(id), Number(customerRepId), req.user!);
    res.json({ order });
  } catch (error) {
    throw error;
  }
};

export const assignDeliveryAgent = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { deliveryAgentId } = req.body;
    const order = await orderService.assignDeliveryAgent(Number(id), Number(deliveryAgentId), req.user!);
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
    }, req.user);
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
    }, req.user);
    res.json({ stats });
  } catch (error) {
    throw error;
  }
};
