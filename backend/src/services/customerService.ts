import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { Requester } from '../utils/authUtils';

interface CreateCustomerData {
  firstName: string;
  lastName?: string;
  email?: string;
  phoneNumber: string;
  alternatePhone?: string;
  address: string;
  state: string;
  zipCode?: string;
  area: string;
  landmark?: string;
  tags?: string[];
  notes?: string;
}

interface CustomerFilters {
  search?: string;
  area?: string;
  tags?: string[];
  page?: number;
  limit?: number;
}

export class CustomerService {
  /**
   * Get all customers with filters and pagination
   */
  async getAllCustomers(filters: CustomerFilters, requester?: Requester) {
    const { search, area, tags, page = 1, limit = 20 } = filters;

    const where: Prisma.CustomerWhereInput = { isActive: true };

    // Role-based filtering for customers
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      // For sales reps and delivery agents, they can only see customers they have orders with
      where.orders = {
        some: {
          OR: [
            { customerRepId: requester.id },
            { deliveryAgentId: requester.id }
          ],
          deletedAt: null
        }
      };
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (area) where.area = area;
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }

    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          orders: {
            select: {
              id: true,
              totalAmount: true
            }
          }
        }
      }),
      prisma.customer.count({ where })
    ]);

    // Calculate totalOrders and totalSpent from actual orders
    const customersWithMetrics = customers.map(customer => {
      const totalOrders = customer.orders.length;
      const totalSpent = customer.orders.reduce((sum, order) => sum + order.totalAmount, 0);

      return {
        ...customer,
        totalOrders,
        totalSpent
      };
    });

    return {
      customers: customersWithMetrics,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Create new customer
   */
  async createCustomer(data: CreateCustomerData) {
    // Check if customer with phone number already exists
    const existingCustomer = await prisma.customer.findUnique({
      where: { phoneNumber: data.phoneNumber }
    });

    if (existingCustomer) {
      throw new AppError('Customer with this phone number already exists', 400);
    }

    const customer = await prisma.customer.create({
      data: {
        ...data,
        firstName: data.firstName || 'Unknown',
        lastName: data.lastName || ''
      }
    });

    logger.info('Customer created', {
      customerId: customer.id,
      phoneNumber: customer.phoneNumber
    });

    return customer;
  }

  /**
   * Get customer by ID
   */
  async getCustomerById(customerId: string, requester?: Requester) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            // orderNumber removed - using id
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

    // Role-based filtering of orders and ownership check
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      // For sales reps, check if they have any orders with this customer
      const hasOrder = await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          customerRepId: requester.id,
          deletedAt: null
        }
      });

      if (!hasOrder) {
        throw new AppError('You do not have permission to view this customer details', 403);
      }

      // Filter the orders in the result to only show the rep's orders
      // Use re-fetching with filter for accuracy
      const filteredOrders = await prisma.order.findMany({
        where: {
          customerId: customer.id,
          customerRepId: requester.id,
          deletedAt: null
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true
        }
      });
      (customer as any).orders = filteredOrders;
    }

    return customer;
  }

  /**
   * Get customer by phone number
   */
  async getCustomerByPhone(phoneNumber: string, requester?: Requester) {
    const customer = await prisma.customer.findUnique({
      where: { phoneNumber },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            customerRepId: true,
            deliveryAgentId: true
          }
        }
      }
    });

    if (!customer) return null;

    // Role-based filtering
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      const hasAccess = customer.orders.some(o => o.customerRepId === requester.id || o.deliveryAgentId === requester.id);
      if (!hasAccess) {
        throw new AppError('You do not have permission to view this customer', 403);
      }
    }

    return customer;
  }

  /**
   * Update customer details
   */
  async updateCustomer(customerId: string, updateData: Partial<CreateCustomerData>, requester?: Requester) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Role-based ownership check for update
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      const hasOrder = await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          customerRepId: requester.id,
          deletedAt: null
        }
      });

      if (!hasOrder) {
        throw new AppError('You do not have permission to update this customer', 403);
      }
    }

    // If updating phone number, check for duplicates
    if (updateData.phoneNumber && updateData.phoneNumber !== customer.phoneNumber) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { phoneNumber: updateData.phoneNumber }
      });

      if (existingCustomer) {
        throw new AppError('Phone number already in use', 400);
      }
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: updateData
    });

    if (requester) {
      await prisma.auditLog.create({
        data: {
          userId: requester.id,
          action: 'update',
          resource: 'customer',
          resourceId: customerId,
          metadata: { changes: Object.keys(updateData) }
        }
      });
    }

    logger.info('Customer updated', { customerId });
    return updated;
  }

  /**
   * Soft delete customer (deactivate)
   */
  async deleteCustomer(customerId: string, requester?: Requester) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Role-based ownership check for delete
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      throw new AppError('You do not have permission to delete customers', 403);
    }

    await prisma.customer.update({
      where: { id },
      data: { isActive: false }
    });

    if (requester) {
      await prisma.auditLog.create({
        data: {
          userId: requester.id,
          action: 'deactivate',
          resource: 'customer',
          resourceId: customerId
        }
      });
    }

    logger.info('Customer deactivated', { customerId: id });
    return { message: 'Customer deactivated successfully' };
  }

  /**
   * Update customer tags
   */
  async updateCustomerTags(customerId: string, tags: string[], requester?: Requester) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    // Role-based ownership check for updating tags
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      const hasOrder = await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          OR: [
            { customerRepId: requester.id },
            { deliveryAgentId: requester.id }
          ],
          deletedAt: null
        }
      });

      if (!hasOrder) {
        throw new AppError('You do not have permission to update tags for this customer', 403);
      }
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: { tags }
    });

    logger.info('Customer tags updated', { customerId: id, tags });
    return updated;
  }

  /**
   * Add tags to customer (merge with existing)
   */
  async addCustomerTags(customerId: string, newTags: string[]) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const uniqueTags = Array.from(new Set([...customer.tags, ...newTags]));

    const updated = await prisma.customer.update({
      where: { id },
      data: { tags: uniqueTags }
    });

    logger.info('Customer tags added', { customerId: id, newTags });
    return updated;
  }

  /**
   * Remove tags from customer
   */
  async removeCustomerTags(customerId: string, tagsToRemove: string[]) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const updatedTags = customer.tags.filter((tag) => !tagsToRemove.includes(tag));

    const updated = await prisma.customer.update({
      where: { id },
      data: { tags: updatedTags }
    });

    logger.info('Customer tags removed', { customerId: id, tagsToRemove });
    return updated;
  }

  /**
   * Get customer analytics
   */
  async getCustomerAnalytics(customerId: string, requester?: Requester) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

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

    // Role-based ownership check for analytics
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      const hasOrder = await prisma.order.findFirst({
        where: {
          customerId: customer.id,
          OR: [
            { customerRepId: requester.id },
            { deliveryAgentId: requester.id }
          ],
          deletedAt: null
        }
      });

      if (!hasOrder) {
        throw new AppError('You do not have permission to view analytics for this customer', 403);
      }
    }

    const analytics = {
      totalOrders: customer.orders.length,
      totalSpent: customer.orders.reduce((sum, order) => sum + order.totalAmount, 0),
      avgOrderValue:
        customer.orders.length > 0
          ? customer.orders.reduce((sum, order) => sum + order.totalAmount, 0) / customer.orders.length
          : 0,
      ordersByStatus: customer.orders.reduce((acc: Record<string, number>, order) => {
        acc[order.status] = (acc[order.status] || 0) + 1;
        return acc;
      }, {}),
      lastOrderDate:
        customer.orders.length > 0
          ? customer.orders.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0].createdAt
          : null,
      firstOrderDate:
        customer.orders.length > 0
          ? customer.orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0].createdAt
          : null
    };

    return analytics;
  }

  /**
   * Get customer order history with full details
   */
  async getCustomerOrderHistory(customerId: string, requester?: Requester, filters?: { page?: number; limit?: number }) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = { customerId: id };

    // Role-based filtering of order history
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      where.OR = [
        { customerRepId: requester.id },
        { deliveryAgentId: requester.id }
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { customerId: id },
        skip,
        take: limit,
        include: {
          orderItems: {
            include: {
              product: {
                select: {
                  name: true,
                  sku: true
                }
              }
            }
          },
          deliveryAgent: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.order.count({ where: { customerId: id } })
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Search customers by multiple criteria
   */
  async searchCustomers(query: string, requester?: Requester, filters?: { area?: string; limit?: number }) {
    const where: Prisma.CustomerWhereInput = {
      isActive: true,
      OR: [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { phoneNumber: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } }
      ]
    };

    // Role-based filtering for customer search
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      where.orders = {
        some: {
          OR: [
            { customerRepId: requester.id },
            { deliveryAgentId: requester.id }
          ],
          deletedAt: null
        }
      };
    }

    if (filters?.area) where.area = filters.area;

    const customers = await prisma.customer.findMany({
      where,
      take: filters?.limit || 10,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        email: true,
        area: true,
        totalOrders: true,
        totalSpent: true
      },
      orderBy: { totalSpent: 'desc' }
    });

    return customers;
  }

  /**
   * Get top customers by spending
   */
  async getTopCustomers(limit: number = 10, requester?: Requester, filters?: { area?: string }) {
    const where: Prisma.CustomerWhereInput = { isActive: true };

    // Role-based filtering for top customers
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      where.orders = {
        some: {
          OR: [
            { customerRepId: requester.id },
            { deliveryAgentId: requester.id }
          ],
          deletedAt: null
        }
      };
    }
    if (filters?.area) where.area = filters.area;

    const topCustomers = await prisma.customer.findMany({
      where,
      take: limit,
      orderBy: { totalSpent: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        email: true,
        area: true,
        totalOrders: true,
        totalSpent: true,
        createdAt: true
      }
    });

    return topCustomers;
  }

  /**
   * Get customers by area distribution
   */
  async getCustomerDistribution() {
    const byArea = await prisma.customer.groupBy({
      by: ['area'],
      where: { isActive: true },
      _count: true,
      orderBy: {
        _count: {
          area: 'desc'
        }
      },
      take: 20
    });

    return {
      byArea: byArea.map((a) => ({
        area: a.area,
        count: a._count
      }))
    };
  }

  /**
   * Merge duplicate customers
   */
  async mergeCustomers(primaryCustomerId: string, secondaryCustomerId: string, requester?: Requester) {
    const primaryId = parseInt(primaryCustomerId, 10);
    const secondaryId = parseInt(secondaryCustomerId, 10);

    if (isNaN(primaryId) || isNaN(secondaryId)) {
      throw new AppError('Invalid customer ID(s)', 400);
    }

    // Strict admin restriction for merging customers
    if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
      throw new AppError('You do not have permission to merge customers', 403);
    }

    const [primaryCustomer, secondaryCustomer] = await Promise.all([
      prisma.customer.findUnique({ where: { id: primaryId } }),
      prisma.customer.findUnique({
        where: { id: secondaryId },
        include: { orders: true }
      })
    ]);

    if (!primaryCustomer || !secondaryCustomer) {
      throw new AppError('One or both customers not found', 404);
    }

    await prisma.$transaction(async (tx) => {
      // Transfer all orders from secondary to primary
      await tx.order.updateMany({
        where: { customerId: secondaryId },
        data: { customerId: primaryId }
      });

      // Update primary customer stats
      await tx.customer.update({
        where: { id: primaryId },
        data: {
          totalOrders: primaryCustomer.totalOrders + secondaryCustomer.totalOrders,
          totalSpent: primaryCustomer.totalSpent + secondaryCustomer.totalSpent,
          tags: Array.from(new Set([...primaryCustomer.tags, ...secondaryCustomer.tags]))
        }
      });

      // Deactivate secondary customer
      await tx.customer.update({
        where: { id: secondaryId },
        data: { isActive: false }
      });
    });

    if (requester) {
      await prisma.auditLog.create({
        data: {
          userId: requester.id,
          action: 'merge',
          resource: 'customer',
          resourceId: primaryCustomerId,
          metadata: { secondaryCustomerId: secondaryCustomerId }
        }
      });
    }

    logger.info('Customers merged', {
      primaryCustomerId: primaryId,
      secondaryCustomerId: secondaryId
    });

    return { message: 'Customers merged successfully' };
  }
}

export default new CustomerService();
