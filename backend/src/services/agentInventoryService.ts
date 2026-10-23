import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, TransferType } from '@prisma/client';
import * as Money from '../utils/money';


export class AgentInventoryService {
  /**
   * Get all agent stock holdings for a specific product
   */
  async getProductAgentStock(productId: number) {


    const product = await prisma.product.findUnique({
      where: { id: productId,  },
      select: { id: true, name: true, sku: true, price: true },
    });

    if (!product) throw new AppError('Product not found', 404);

    const agentStocks = await prisma.agentStock.findMany({
      where: { productId, OR: [{ quantity: { gt: 0 } }, { totalInTransit: { gt: 0 } }],  },
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
        value: Money.mul(as.quantity, product.price),
      })),
      totalWithAgents: agentStocks.reduce((sum, as) => sum + as.quantity, 0),
      totalValue: Money.sum(agentStocks.map((as) => Money.mul(as.quantity, product.price))),
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
      where: { agentId, OR: [{ quantity: { gt: 0 } }, { totalInTransit: { gt: 0 } }],  },
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
        value: Money.mul(s.quantity, s.product.price),
      })),
      totalValue: Money.sum(stocks.map((s) => Money.mul(s.quantity, s.product.price))),
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

    const where: Prisma.InventoryTransferWhereInput = {};
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


    // NOTE: this loads all agent stock into memory for in-process grouping.
    // At large fleet scale (1000+ agents × many products) consider replacing with
    // a $queryRaw GROUP BY query. Current limit prevents unbounded memory growth.
    const agentStocks = await prisma.agentStock.findMany({
      where: { OR: [{ quantity: { gt: 0 } }, { totalInTransit: { gt: 0 } }],  },
      include: {
        agent: { select: { id: true, firstName: true, lastName: true } },
        product: { select: { id: true, name: true, price: true } },
      },
      take: 5000,
    });

    // Group by agent
    const byAgent: Record<number, { name: string; items: number; totalQuantity: number; totalValue: Money.Money }> = {};
    let grandTotalValue = Money.ZERO;
    let grandTotalQuantity = 0;

    for (const stock of agentStocks) {
      const agentId = stock.agent.id;
      if (!byAgent[agentId]) {
        byAgent[agentId] = {
          name: `${stock.agent.firstName} ${stock.agent.lastName}`,
          items: 0,
          totalQuantity: 0,
          totalValue: Money.ZERO,
        };
      }
      const value = Money.mul(stock.quantity, stock.product.price);
      byAgent[agentId].items += 1;
      byAgent[agentId].totalQuantity += stock.quantity;
      byAgent[agentId].totalValue = Money.add(byAgent[agentId].totalValue, value);
      grandTotalValue = Money.add(grandTotalValue, value);
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
