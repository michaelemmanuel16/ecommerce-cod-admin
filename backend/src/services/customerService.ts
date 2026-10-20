import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { Requester } from '../utils/authUtils';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import { findCustomerByPhoneIncludingArchived } from '../utils/customerLookup';
import * as Money from '../utils/money';
import { looksLikePhone, normalizePhoneForStorage, phoneLookupVariants, phonePartialDigits, phoneSearchConditions } from '../utils/phone';

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
  sortBy?: 'totalOrders' | 'totalSpent';
  sortOrder?: 'asc' | 'desc';
}

export class CustomerService {
  /**
   * Get all customers with filters and pagination
   */
  async getAllCustomers(filters: CustomerFilters, requester?: Requester) {
    const { search, area, tags, page = 1, limit = 20, sortBy, sortOrder = 'desc' } = filters;

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
        ...phoneSearchConditions(search),
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (area) where.area = area;
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }

    const skip = (page - 1) * limit;

    // When sorting by computed fields (totalOrders/totalSpent), use raw SQL
    // to sort and paginate at the database level instead of loading all records
    if (sortBy) {
      // Build WHERE conditions for raw SQL
      const conditions: string[] = ['c.is_active = true'];
      const params: any[] = [];
      let paramIdx = 1;

      // Tenant isolation for raw SQL (Prisma extension does not intercept $queryRawUnsafe)
      const tenantId = getTenantId();
      if (tenantId) {
        conditions.push(`c.tenant_id = $${paramIdx}`);
        params.push(tenantId);
        paramIdx++;
      }

      if (search) {
        // A phone-like term also matches every stored format of the number (normalized or old).
        // A partly typed local number (024 55) also matches the normalized form.
        const partial = phonePartialDigits(search);
        const phoneLike = partial ? `%${partial}%` : `%${search}%`;
        conditions.push(`(c.first_name ILIKE $${paramIdx} OR c.last_name ILIKE $${paramIdx} OR c.phone_number LIKE $${paramIdx + 1} OR c.phone_number = ANY($${paramIdx + 2}::text[]) OR c.email ILIKE $${paramIdx})`);
        params.push(`%${search}%`, phoneLike, looksLikePhone(search) ? phoneLookupVariants(search) : []);
        paramIdx += 3;
      }
      if (area) {
        conditions.push(`c.area = $${paramIdx}`);
        params.push(area);
        paramIdx++;
      }
      if (tags && tags.length > 0) {
        conditions.push(`c.tags && $${paramIdx}::text[]`);
        params.push(tags);
        paramIdx++;
      }
      if (requester && requester.role !== 'super_admin' && requester.role !== 'admin' && requester.role !== 'manager') {
        conditions.push(`EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = c.id AND o2.deleted_at IS NULL AND (o2.customer_rep_id = $${paramIdx} OR o2.delivery_agent_id = $${paramIdx}))`);
        params.push(requester.id);
        paramIdx++;
      }

      const whereClause = conditions.join(' AND ');
      // Aggregate expressions, not the aliases: customers has its own total_orders / total_spent columns (c.*), so the alias is ambiguous in ORDER BY.
      const orderCol = sortBy === 'totalOrders' ? 'COUNT(o.id)' : 'COALESCE(SUM(o.total_amount), 0)';
      const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

      // Count total
      const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*)::bigint as count FROM customers c WHERE ${whereClause}`,
        ...params
      );
      const total = Number(countResult[0].count);

      // Fetch sorted page with aggregated metrics
      const rawCustomers = await prisma.$queryRawUnsafe<any[]>(
        `SELECT c.*,
          COUNT(o.id)::int AS total_orders,
          COALESCE(SUM(o.total_amount), 0)::text AS total_spent
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
        WHERE ${whereClause}
        GROUP BY c.id
        ORDER BY ${orderCol} ${orderDir}, c.created_at DESC
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        ...params, limit, skip
      );

      // Map raw results to match Prisma output shape
      const customersWithMetrics = rawCustomers.map((c: any) => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
        email: c.email,
        phoneNumber: c.phone_number,
        alternatePhone: c.alternate_phone,
        address: c.address,
        state: c.state,
        area: c.area,
        zipCode: c.zip_code,
        landmark: c.landmark,
        tags: c.tags || [],
        notes: c.notes,
        isActive: c.is_active,
        totalOrders: c.total_orders,
        totalSpent: Money.parse(c.total_spent),
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        orders: [], // not needed for list view
      }));

      return {
        customers: customersWithMetrics,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      };
    }

    // Default: no computed sort — use standard Prisma query
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          orders: {
            where: { deletedAt: null },
            select: { id: true, totalAmount: true }
          }
        }
      }),
      prisma.customer.count({ where })
    ]);

    const customersWithMetrics = customers.map(customer => ({
      ...customer,
      totalOrders: customer.orders.length,
      totalSpent: Money.sum(customer.orders.map(order => order.totalAmount))
    }));

    return {
      customers: customersWithMetrics,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    };
  }

  /**
   * Create new customer
   */
  async createCustomer(data: CreateCustomerData) {
    // Check if customer with phone number already exists. Archived customers
    // count: they still hold the number in the unique index, so missing one here
    // turns a clean 400 into a constraint-violation 500.
    const phoneNumber = normalizePhoneForStorage(data.phoneNumber);
    const alternatePhone = normalizePhoneForStorage(data.alternatePhone);
    const existingCustomer = await findCustomerByPhoneIncludingArchived(prisma, phoneNumber);

    if (existingCustomer) {
      throw new AppError(
        existingCustomer.isActive === false
          ? 'An archived customer already uses this phone number. Restore that customer instead.'
          : 'Customer with this phone number already exists',
        400
      );
    }

    const customer = await prisma.customer.create({
      data: {
        ...data,
        phoneNumber,
        alternatePhone,
        firstName: data.firstName || 'Unknown',
        lastName: data.lastName || '',
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
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
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
    const customer = await prisma.customer.findFirst({
      where: { phoneNumber: { in: phoneLookupVariants(phoneNumber) } },
      include: {
        orders: {
          where: { deletedAt: null },
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

    // Store phones normalized (unparseable input stays as typed).
    if (updateData.phoneNumber) updateData = { ...updateData, phoneNumber: normalizePhoneForStorage(updateData.phoneNumber) };
    if (updateData.alternatePhone) updateData = { ...updateData, alternatePhone: normalizePhoneForStorage(updateData.alternatePhone) };

    // If updating phone number, check for duplicates
    if (updateData.phoneNumber && updateData.phoneNumber !== customer.phoneNumber) {
      // Archived customers included — see createCustomer.
      const existingCustomer = await findCustomerByPhoneIncludingArchived(
        prisma,
        updateData.phoneNumber
      );

      // The customer's own old-format number matches too; that is not a duplicate.
      if (existingCustomer && existingCustomer.id !== id) {
        throw new AppError(
          existingCustomer.isActive === false
            ? 'Phone number already in use by an archived customer'
            : 'Phone number already in use',
          400
        );
      }
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: updateData
    });

    if (requester) {
      await prisma.auditLog.create({
        data: {
          tenantId: resolveTenantId(updated.tenantId),
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
          tenantId: resolveTenantId(customer.tenantId),
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
}

export default new CustomerService();
