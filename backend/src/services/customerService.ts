import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';

interface CreateCustomerData {
  name: string;
  email?: string;
  phoneNumber: string;
  alternatePhone?: string;
  address: string;
  state: string;
  zipCode: string;
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
  async getAllCustomers(filters: CustomerFilters) {
    const { search, area, tags, page = 1, limit = 20 } = filters;

    const where: Prisma.CustomerWhereInput = { isActive: true };

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

    // Split name into firstName and lastName
    const nameParts = data.name.trim().split(' ');
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || '';

    const { name, ...restData } = data;

    const customer = await prisma.customer.create({
      data: {
        ...restData,
        firstName,
        lastName
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
  async getCustomerById(customerId: string) {
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

    return customer;
  }

  /**
   * Get customer by phone number
   */
  async getCustomerByPhone(phoneNumber: string) {
    const customer = await prisma.customer.findUnique({
      where: { phoneNumber },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
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

    return customer;
  }

  /**
   * Update customer details
   */
  async updateCustomer(customerId: string, updateData: Partial<CreateCustomerData>) {
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

    // If updating phone number, check for duplicates
    if (updateData.phoneNumber && updateData.phoneNumber !== customer.phoneNumber) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { phoneNumber: updateData.phoneNumber }
      });

      if (existingCustomer) {
        throw new AppError('Phone number already in use', 400);
      }
    }

    // If name is provided, split it into firstName and lastName
    const finalUpdateData: any = { ...updateData };
    if (updateData.name !== undefined) {
      const nameParts = updateData.name.trim().split(' ');
      finalUpdateData.firstName = nameParts[0] || 'Unknown';
      finalUpdateData.lastName = nameParts.slice(1).join(' ') || '';
      delete finalUpdateData.name;
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: finalUpdateData
    });

    logger.info('Customer updated', { customerId });
    return updated;
  }

  /**
   * Soft delete customer (deactivate)
   */
  async deleteCustomer(customerId: string) {
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

    await prisma.customer.update({
      where: { id },
      data: { isActive: false }
    });

    logger.info('Customer deactivated', { customerId: id });
    return { message: 'Customer deactivated successfully' };
  }

  /**
   * Update customer tags
   */
  async updateCustomerTags(customerId: string, tags: string[]) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: { tags }
    });

    logger.info('Customer tags updated', { customerId, tags });
    return updated;
  }

  /**
   * Add tags to customer (merge with existing)
   */
  async addCustomerTags(customerId: string, newTags: string[]) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const uniqueTags = Array.from(new Set([...customer.tags, ...newTags]));

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: { tags: uniqueTags }
    });

    logger.info('Customer tags added', { customerId, newTags });
    return updated;
  }

  /**
   * Remove tags from customer
   */
  async removeCustomerTags(customerId: string, tagsToRemove: string[]) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const updatedTags = customer.tags.filter((tag) => !tagsToRemove.includes(tag));

    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: { tags: updatedTags }
    });

    logger.info('Customer tags removed', { customerId, tagsToRemove });
    return updated;
  }

  /**
   * Get customer analytics
   */
  async getCustomerAnalytics(customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
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
  async getCustomerOrderHistory(customerId: string, filters?: { page?: number; limit?: number }) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const { page = 1, limit = 20 } = filters || {};
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { customerId },
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
      prisma.order.count({ where: { customerId } })
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
  async searchCustomers(query: string, filters?: { area?: string; limit?: number }) {
    const where: Prisma.CustomerWhereInput = {
      isActive: true,
      OR: [
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { phoneNumber: { contains: query } },
        { email: { contains: query, mode: 'insensitive' } }
      ]
    };

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
  async getTopCustomers(limit: number = 10, filters?: { area?: string }) {
    const where: Prisma.CustomerWhereInput = { isActive: true };
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
  async mergeCustomers(primaryCustomerId: string, secondaryCustomerId: string) {
    const [primaryCustomer, secondaryCustomer] = await Promise.all([
      prisma.customer.findUnique({ where: { id: primaryCustomerId } }),
      prisma.customer.findUnique({
        where: { id: secondaryCustomerId },
        include: { orders: true }
      })
    ]);

    if (!primaryCustomer || !secondaryCustomer) {
      throw new AppError('One or both customers not found', 404);
    }

    await prisma.$transaction(async (tx) => {
      // Transfer all orders from secondary to primary
      await tx.order.updateMany({
        where: { customerId: secondaryCustomerId },
        data: { customerId: primaryCustomerId }
      });

      // Update primary customer stats
      await tx.customer.update({
        where: { id: primaryCustomerId },
        data: {
          totalOrders: primaryCustomer.totalOrders + secondaryCustomer.totalOrders,
          totalSpent: primaryCustomer.totalSpent + secondaryCustomer.totalSpent,
          tags: Array.from(new Set([...primaryCustomer.tags, ...secondaryCustomer.tags]))
        }
      });

      // Deactivate secondary customer
      await tx.customer.update({
        where: { id: secondaryCustomerId },
        data: { isActive: false }
      });
    });

    logger.info('Customers merged', {
      primaryCustomerId,
      secondaryCustomerId
    });

    return { message: 'Customers merged successfully' };
  }
}

export default new CustomerService();
