import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { TransferType } from '@prisma/client';
import logger from '../utils/logger';

export class AgentInventoryService {
  /**
   * Allocate stock from warehouse to an agent
   */
  async allocateStock(
    productId: number,
    agentId: number,
    quantity: number,
    createdById: number,
    notes?: string
  ) {
    if (quantity <= 0) {
      throw new AppError('Quantity must be greater than zero', 400);
    }

    const [product, agent] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.user.findUnique({ where: { id: agentId } }),
    ]);

    if (!product) throw new AppError('Product not found', 404);
    if (!agent) throw new AppError('Agent not found', 404);
    if (agent.role !== 'delivery_agent') {
      throw new AppError('User is not a delivery agent', 400);
    }

    return await prisma.$transaction(async (tx) => {
      // Re-read inside transaction to prevent TOCTOU race condition
      const lockedProduct = await tx.product.findUnique({ where: { id: productId } });
      if (!lockedProduct || lockedProduct.stockQuantity < quantity) {
        throw new AppError(
          `Insufficient warehouse stock. Available: ${lockedProduct?.stockQuantity ?? 0}, Requested: ${quantity}`,
          400
        );
      }

      // Deduct warehouse stock
      await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: { decrement: quantity } },
      });

      // Upsert agent stock
      await tx.agentStock.upsert({
        where: { agentId_productId: { agentId, productId } },
        create: {
          agentId,
          productId,
          quantity,
          totalAllocated: quantity,
        },
        update: {
          quantity: { increment: quantity },
          totalAllocated: { increment: quantity },
        },
      });

      // Create transfer record
      const transfer = await tx.inventoryTransfer.create({
        data: {
          productId,
          quantity,
          transferType: TransferType.allocation,
          fromAgentId: null,
          toAgentId: agentId,
          notes,
          createdById,
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          toAgent: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      logger.info(`Stock allocated: ${quantity} of product ${productId} to agent ${agentId}`, {
        transferId: transfer.id,
        productId,
        agentId,
        quantity,
      });

      return transfer;
    });
  }

  /**
   * Transfer stock between two agents
   */
  async transferStock(
    productId: number,
    fromAgentId: number,
    toAgentId: number,
    quantity: number,
    createdById: number,
    notes?: string
  ) {
    if (quantity <= 0) {
      throw new AppError('Quantity must be greater than zero', 400);
    }
    if (fromAgentId === toAgentId) {
      throw new AppError('Cannot transfer to the same agent', 400);
    }

    const [fromAgent, toAgent] = await Promise.all([
      prisma.user.findUnique({ where: { id: fromAgentId } }),
      prisma.user.findUnique({ where: { id: toAgentId } }),
    ]);

    if (!fromAgent) throw new AppError('Source agent not found', 404);
    if (!toAgent) throw new AppError('Destination agent not found', 404);
    if (fromAgent.role !== 'delivery_agent') {
      throw new AppError('Source user is not a delivery agent', 400);
    }
    if (toAgent.role !== 'delivery_agent') {
      throw new AppError('Destination user is not a delivery agent', 400);
    }

    return await prisma.$transaction(async (tx) => {
      // Re-read inside transaction to prevent TOCTOU race condition
      const sourceStock = await tx.agentStock.findUnique({
        where: { agentId_productId: { agentId: fromAgentId, productId } },
      });

      if (!sourceStock || sourceStock.quantity < quantity) {
        throw new AppError(
          `Insufficient agent stock. Available: ${sourceStock?.quantity ?? 0}, Requested: ${quantity}`,
          400
        );
      }

      // Decrement source agent
      await tx.agentStock.update({
        where: { agentId_productId: { agentId: fromAgentId, productId } },
        data: {
          quantity: { decrement: quantity },
          totalTransferOut: { increment: quantity },
        },
      });

      // Upsert destination agent
      await tx.agentStock.upsert({
        where: { agentId_productId: { agentId: toAgentId, productId } },
        create: {
          agentId: toAgentId,
          productId,
          quantity,
          totalTransferIn: quantity,
        },
        update: {
          quantity: { increment: quantity },
          totalTransferIn: { increment: quantity },
        },
      });

      // Create transfer record
      const transfer = await tx.inventoryTransfer.create({
        data: {
          productId,
          quantity,
          transferType: TransferType.agent_transfer,
          fromAgentId,
          toAgentId,
          notes,
          createdById,
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          fromAgent: { select: { id: true, firstName: true, lastName: true } },
          toAgent: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      logger.info(`Stock transferred: ${quantity} of product ${productId} from agent ${fromAgentId} to agent ${toAgentId}`, {
        transferId: transfer.id,
      });

      return transfer;
    });
  }

  /**
   * Return stock from agent back to warehouse
   */
  async returnStock(
    productId: number,
    agentId: number,
    quantity: number,
    createdById: number,
    notes?: string
  ) {
    if (quantity <= 0) {
      throw new AppError('Quantity must be greater than zero', 400);
    }

    const agentStock = await prisma.agentStock.findUnique({
      where: { agentId_productId: { agentId, productId } },
    });

    if (!agentStock || agentStock.quantity < quantity) {
      throw new AppError(
        `Insufficient agent stock. Available: ${agentStock?.quantity ?? 0}, Requested: ${quantity}`,
        400
      );
    }

    return await prisma.$transaction(async (tx) => {
      // Decrement agent stock
      await tx.agentStock.update({
        where: { agentId_productId: { agentId, productId } },
        data: {
          quantity: { decrement: quantity },
          totalReturned: { increment: quantity },
        },
      });

      // Increment warehouse stock
      await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: { increment: quantity } },
      });

      // Create transfer record
      const transfer = await tx.inventoryTransfer.create({
        data: {
          productId,
          quantity,
          transferType: TransferType.return_to_warehouse,
          fromAgentId: agentId,
          toAgentId: null,
          notes,
          createdById,
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          fromAgent: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      logger.info(`Stock returned: ${quantity} of product ${productId} from agent ${agentId} to warehouse`, {
        transferId: transfer.id,
      });

      return transfer;
    });
  }

  /**
   * Record order fulfillment from agent stock.
   * Called when a delivered order's agent has allocated stock.
   * Returns which items were fulfilled from agent stock.
   */
  async recordOrderFulfillment(
    tx: TransactionClient,
    orderId: number,
    agentId: number,
    items: Array<{ productId: number; quantity: number }>,
    createdById: number
  ): Promise<number[]> {
    const fulfilledProductIds: number[] = [];

    for (const item of items) {
      const agentStock = await tx.agentStock.findUnique({
        where: { agentId_productId: { agentId, productId: item.productId } },
      });

      if (agentStock && agentStock.quantity >= item.quantity) {
        // Agent has sufficient stock - mark as in transit (not yet fulfilled)
        await tx.agentStock.update({
          where: { agentId_productId: { agentId, productId: item.productId } },
          data: {
            quantity: { decrement: item.quantity },
            totalInTransit: { increment: item.quantity },
          },
        });

        await tx.inventoryTransfer.create({
          data: {
            productId: item.productId,
            quantity: item.quantity,
            transferType: TransferType.order_fulfillment,
            fromAgentId: agentId,
            toAgentId: null,
            orderId,
            createdById,
          },
        });

        fulfilledProductIds.push(item.productId);
      }
      // If agent doesn't have stock, skip - warehouse deduction will handle it
    }

    if (fulfilledProductIds.length > 0) {
      logger.info(`Order ${orderId} marked ${fulfilledProductIds.length} items in-transit from agent ${agentId} stock`, {
        orderId,
        agentId,
        fulfilledProductIds,
      });
    }

    return fulfilledProductIds;
  }

  /**
   * Confirm delivery of an order from agent stock.
   * Called when order transitions to `delivered`.
   * Moves items from totalInTransit → totalFulfilled.
   */
  async confirmOrderDelivery(
    tx: TransactionClient,
    orderId: number,
    agentId: number,
    items: Array<{ productId: number; quantity: number }>,
    _createdById: number
  ): Promise<number[]> {
    const confirmedProductIds: number[] = [];

    for (const item of items) {
      const agentStock = await tx.agentStock.findUnique({
        where: { agentId_productId: { agentId, productId: item.productId } },
      });

      if (agentStock && agentStock.totalInTransit >= item.quantity) {
        await tx.agentStock.update({
          where: { agentId_productId: { agentId, productId: item.productId } },
          data: {
            totalInTransit: { decrement: item.quantity },
            totalFulfilled: { increment: item.quantity },
          },
        });
        confirmedProductIds.push(item.productId);
      }
    }

    if (confirmedProductIds.length > 0) {
      logger.info(`Order ${orderId} delivery confirmed for ${confirmedProductIds.length} items from agent ${agentId} stock`, {
        orderId,
        agentId,
        confirmedProductIds,
      });
    }

    return confirmedProductIds;
  }

  /**
   * Reverse an order fulfillment from agent stock.
   * Called when an in-transit or delivered order is cancelled, fails delivery, is returned, or deleted.
   * Restores agent quantity and decrements totalInTransit or totalFulfilled accordingly.
   * Returns the product IDs reversed (so orderService can skip warehouse restock for those).
   */
  async reverseOrderFulfillment(
    tx: TransactionClient,
    orderId: number,
    agentId: number,
    createdById: number,
    wasDelivered: boolean = false
  ): Promise<number[]> {
    // Find all order_fulfillment transfers for this order from this agent
    const transfers = await tx.inventoryTransfer.findMany({
      where: {
        orderId,
        transferType: TransferType.order_fulfillment,
        fromAgentId: agentId,
      },
    });

    if (transfers.length === 0) return [];

    const reversedProductIds: number[] = [];

    for (const transfer of transfers) {
      const qty = transfer.quantity;

      await tx.agentStock.update({
        where: { agentId_productId: { agentId, productId: transfer.productId } },
        data: {
          quantity: { increment: qty },
          ...(wasDelivered
            ? { totalFulfilled: { decrement: qty } }
            : { totalInTransit: { decrement: qty } }),
        },
      });

      // Create adjustment record to document the reversal
      await tx.inventoryTransfer.create({
        data: {
          productId: transfer.productId,
          quantity: qty,
          transferType: TransferType.adjustment,
          fromAgentId: null,
          toAgentId: agentId,
          orderId,
          notes: `Reversed: order #${orderId} ${wasDelivered ? 'returned' : 'cancelled/failed'}`,
          createdById,
        },
      });

      reversedProductIds.push(transfer.productId);
    }

    logger.info(`Order ${orderId} fulfillment reversed for agent ${agentId}: ${reversedProductIds.length} products`, {
      orderId,
      agentId,
      reversedProductIds,
      wasDelivered,
    });

    return reversedProductIds;
  }

  /**
   * Adjust agent stock for reconciliation (shrinkage/correction)
   */
  async adjustStock(
    productId: number,
    agentId: number,
    newQuantity: number,
    createdById: number,
    notes: string
  ) {
    if (newQuantity < 0) {
      throw new AppError('Quantity cannot be negative', 400);
    }
    if (!notes || notes.trim().length === 0) {
      throw new AppError('Notes are required for stock adjustments', 400);
    }

    const agentStock = await prisma.agentStock.findUnique({
      where: { agentId_productId: { agentId, productId } },
    });

    const currentQuantity = agentStock?.quantity ?? 0;
    const difference = newQuantity - currentQuantity;

    if (difference === 0) {
      throw new AppError('New quantity is the same as current quantity', 400);
    }

    return await prisma.$transaction(async (tx) => {
      if (difference > 0) {
        // Upward: deduct from warehouse
        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product || product.stockQuantity < difference) {
          throw new AppError(
            `Insufficient warehouse stock for adjustment. Available: ${product?.stockQuantity ?? 0}, Needed: ${difference}`,
            400
          );
        }
        await tx.product.update({
          where: { id: productId },
          data: { stockQuantity: { decrement: difference } },
        });
      } else {
        // Downward: return units to warehouse
        await tx.product.update({
          where: { id: productId },
          data: { stockQuantity: { increment: Math.abs(difference) } },
        });
      }

      // Upsert agent stock to new quantity; update running counters to match warehouse direction
      await tx.agentStock.upsert({
        where: { agentId_productId: { agentId, productId } },
        create: {
          agentId,
          productId,
          quantity: newQuantity,
          // create only fires when currentQuantity === 0, so difference === newQuantity (always upward)
          totalAllocated: newQuantity,
        },
        update: {
          quantity: newQuantity,
          ...(difference > 0
            ? { totalAllocated: { increment: difference } }
            : { totalReturned: { increment: Math.abs(difference) } }),
        },
      });

      // Create adjustment transfer record
      const transfer = await tx.inventoryTransfer.create({
        data: {
          productId,
          quantity: Math.abs(difference),
          transferType: TransferType.adjustment,
          fromAgentId: difference < 0 ? agentId : null,
          toAgentId: difference > 0 ? agentId : null,
          notes: `Adjustment: ${currentQuantity} → ${newQuantity}. ${notes}`,
          createdById,
        },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          fromAgent: { select: { id: true, firstName: true, lastName: true } },
          toAgent: { select: { id: true, firstName: true, lastName: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
      });

      logger.info(`Stock adjusted for agent ${agentId}, product ${productId}: ${currentQuantity} → ${newQuantity}`, {
        transferId: transfer.id,
        difference,
      });

      return transfer;
    });
  }

  /**
   * Get all agent stock holdings for a specific product
   */
  async getProductAgentStock(productId: number) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, sku: true, price: true },
    });

    if (!product) throw new AppError('Product not found', 404);

    const agentStocks = await prisma.agentStock.findMany({
      where: { productId, quantity: { gt: 0 } },
      include: {
        agent: {
          select: { id: true, firstName: true, lastName: true, email: true, phoneNumber: true },
        },
      },
      orderBy: { quantity: 'desc' },
    });

    return {
      product,
      agents: agentStocks.map((as) => ({
        agentId: as.agent.id,
        agentName: `${as.agent.firstName} ${as.agent.lastName}`,
        email: as.agent.email,
        phoneNumber: as.agent.phoneNumber,
        quantity: as.quantity,
        totalAllocated: as.totalAllocated,
        totalInTransit: as.totalInTransit,
        totalFulfilled: as.totalFulfilled,
        totalReturned: as.totalReturned,
        totalTransferIn: as.totalTransferIn,
        totalTransferOut: as.totalTransferOut,
        value: as.quantity * product.price,
      })),
      totalWithAgents: agentStocks.reduce((sum, as) => sum + as.quantity, 0),
      totalValue: agentStocks.reduce((sum, as) => sum + as.quantity * product.price, 0),
    };
  }

  /**
   * Get all stock held by a specific agent
   */
  async getAgentInventory(agentId: number) {
    const agent = await prisma.user.findUnique({
      where: { id: agentId },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    if (!agent) throw new AppError('Agent not found', 404);

    const stocks = await prisma.agentStock.findMany({
      where: { agentId, quantity: { gt: 0 } },
      include: {
        product: {
          select: { id: true, name: true, sku: true, price: true, imageUrl: true },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });

    return {
      agent: {
        id: agent.id,
        name: `${agent.firstName} ${agent.lastName}`,
      },
      items: stocks.map((s) => ({
        productId: s.product.id,
        productName: s.product.name,
        sku: s.product.sku,
        imageUrl: s.product.imageUrl,
        quantity: s.quantity,
        totalAllocated: s.totalAllocated,
        totalInTransit: s.totalInTransit,
        totalFulfilled: s.totalFulfilled,
        totalReturned: s.totalReturned,
        totalTransferIn: s.totalTransferIn,
        totalTransferOut: s.totalTransferOut,
        unitPrice: s.product.price,
        value: s.quantity * s.product.price,
      })),
      totalValue: stocks.reduce((sum, s) => sum + s.quantity * s.product.price, 0),
    };
  }

  /**
   * Get transfer history with filters
   */
  async getTransferHistory(filters: {
    productId?: number;
    agentId?: number;
    type?: TransferType;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const { productId, agentId, type, startDate, endDate, page = 1, limit = 50 } = filters;

    const where: any = {};
    if (productId) where.productId = productId;
    if (type) where.transferType = type;
    if (agentId) {
      where.OR = [{ fromAgentId: agentId }, { toAgentId: agentId }];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [transfers, total] = await Promise.all([
      prisma.inventoryTransfer.findMany({
        where,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          fromAgent: { select: { id: true, firstName: true, lastName: true } },
          toAgent: { select: { id: true, firstName: true, lastName: true } },
          order: { select: { id: true, status: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventoryTransfer.count({ where }),
    ]);

    return {
      transfers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get summary of all agent-held inventory
   */
  async getSummary() {
    const agentStocks = await prisma.agentStock.findMany({
      where: { quantity: { gt: 0 } },
      include: {
        agent: { select: { id: true, firstName: true, lastName: true } },
        product: { select: { id: true, name: true, price: true } },
      },
    });

    // Group by agent
    const byAgent: Record<number, { name: string; items: number; totalQuantity: number; totalValue: number }> = {};
    let grandTotalValue = 0;
    let grandTotalQuantity = 0;

    for (const stock of agentStocks) {
      const agentId = stock.agent.id;
      if (!byAgent[agentId]) {
        byAgent[agentId] = {
          name: `${stock.agent.firstName} ${stock.agent.lastName}`,
          items: 0,
          totalQuantity: 0,
          totalValue: 0,
        };
      }
      const value = stock.quantity * stock.product.price;
      byAgent[agentId].items += 1;
      byAgent[agentId].totalQuantity += stock.quantity;
      byAgent[agentId].totalValue += value;
      grandTotalValue += value;
      grandTotalQuantity += stock.quantity;
    }

    return {
      agents: Object.entries(byAgent).map(([id, data]) => ({
        agentId: parseInt(id),
        ...data,
      })),
      totalAgents: Object.keys(byAgent).length,
      totalQuantity: grandTotalQuantity,
      totalValue: grandTotalValue,
    };
  }
}

const agentInventoryService = new AgentInventoryService();
export default agentInventoryService;
