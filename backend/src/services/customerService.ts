import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { isManagerUp, Requester } from '../utils/authUtils';
import { fullName } from '../utils/nameUtils';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import { findCustomerByPhoneIncludingArchived } from '../utils/customerLookup';
import * as Money from '../utils/money';
import { normalizePhoneForStorage, phoneLookupVariants, phoneSearchConditions } from '../utils/phone';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { auditService } from './auditService';
import { getStoreTimeZone, localDate, startOfDay } from './kpi/dates';

/** The customer form fields (F-355). Opt-out flags and stats are not on the form, so they are never taken from the body. */
const FORM_FIELDS = ['firstName', 'lastName', 'email', 'phoneNumber', 'alternatePhone', 'address', 'state', 'area', 'landmark', 'notes'] as const;
type FormField = typeof FORM_FIELDS[number];

interface CreateCustomerData {
  firstName: string;
  lastName?: string;
  email?: string;
  phoneNumber: string;
  alternatePhone?: string;
  address: string;
  /** Region */
  state: string;
  /** Town */
  area: string;
  landmark?: string;
  notes?: string;
  /** Take back an archived customer who holds the phone number (F-355). */
  reactivate?: boolean;
}

export const CUSTOMER_SEGMENTS = ['all', 'repeat', 'first_time', 'refused_before', 'not_reachable'] as const;
export type CustomerSegment = typeof CUSTOMER_SEGMENTS[number];
export const CUSTOMER_RISKS = ['low', 'watch', 'high'] as const;
export type CustomerRisk = typeof CUSTOMER_RISKS[number];
/** `totalOrders` and `totalSpent` are the old names; `totalSpent` now sorts by delivered value. */
export const CUSTOMER_SORT_FIELDS = ['customer', 'orders', 'deliveredValue', 'lastOrder', 'totalOrders', 'totalSpent'] as const;
export type CustomerSortField = typeof CUSTOMER_SORT_FIELDS[number];

/** F-357: Low = 0 refusals, Watch = 1, High = 2 or more. */
export const riskOf = (refusedOrders: number): CustomerRisk => (refusedOrders >= 2 ? 'high' : refusedOrders === 1 ? 'watch' : 'low');
/** Refusals at which COD is off. The stored `codBlocked` and the owner override arrive with the refusal rule (M7); until then it is derived. */
export const COD_BLOCK_REFUSALS = 3;
/** The AI problem finder rule for "repeat refuser" (F-353); M11 moves it into the finder service. */
const FLAGGED_REFUSALS = 2;

interface CustomerFilters {
  search?: string;
  /** Town */
  area?: string;
  region?: string;
  risk?: CustomerRisk;
  blocked?: boolean;
  flagged?: boolean;
  segment?: CustomerSegment;
  tags?: string[];
  page?: number;
  limit?: number;
  sortBy?: CustomerSortField;
  sortOrder?: 'asc' | 'desc';
}

const isAdminRole = (requester?: Requester) => !requester || isManagerUp(requester);

export class CustomerService {
  /**
   * Row scope (F-350): owner, admin and manager see all. A call rep sees customers they created or have an order with.
   * A delivery agent sees customers of their own orders. Any other role keeps the old rule (an order of theirs).
   */
  private scopeWhere(requester?: Requester): Prisma.CustomerWhereInput | null {
    if (isAdminRole(requester)) return null;
    const { id, role } = requester!;
    if (role === 'sales_rep') {
      return { OR: [{ createdById: id }, { orders: { some: { customerRepId: id, deletedAt: null } } }] };
    }
    if (role === 'delivery_agent') return { orders: { some: { deliveryAgentId: id, deletedAt: null } } };
    return { orders: { some: { OR: [{ customerRepId: id }, { deliveryAgentId: id }], deletedAt: null } } };
  }

  /**
   * Ids (of `among`, or all in the tenant) whose newest call is not_reachable or no_answer. The newest call being
   * one of those also means no later `confirmed` call (F-351).
   */
  private async notReachableIds(among?: number[]): Promise<number[]> {
    if (among && !among.length) return [];
    const tenantId = getTenantId();
    const rows = await prisma.$queryRaw<Array<{ customer_id: number }>>(Prisma.sql`
      SELECT customer_id FROM (
        SELECT DISTINCT ON (customer_id) customer_id, outcome FROM calls
        WHERE ${tenantId ? Prisma.sql`tenant_id = ${tenantId}` : Prisma.sql`TRUE`}
          ${among ? Prisma.sql`AND customer_id = ANY(${among}::int[])` : Prisma.empty}
        ORDER BY customer_id, created_at DESC, id DESC
      ) newest
      WHERE outcome IN ('not_reachable', 'no_answer')`);
    return rows.map((r) => r.customer_id);
  }

  /** The list filters as a `where`, shared by the list, the tiles and the export (F-361). */
  private async listWhere(filters: CustomerFilters, requester?: Requester): Promise<Prisma.CustomerWhereInput> {
    const { search, area, region, risk, blocked, flagged, segment, tags } = filters;
    const and: Prisma.CustomerWhereInput[] = [];

    const scope = this.scopeWhere(requester);
    if (scope) and.push(scope);

    // One character is too little to search on (F-352)
    const term = search?.trim();
    if (term && term.length >= 2) {
      const phone = phoneSearchConditions(term);
      const words = term.split(/\s+/);
      and.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          // "Abena Owusu": every word is in the first or last name
          ...(words.length > 1
            ? [{ AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }] })) }]
            : []),
          ...phone,
          ...phone.map((c) => ({ alternatePhone: c.phoneNumber })),
          { email: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (area) and.push({ area });
    if (region) and.push({ state: region });
    if (tags && tags.length > 0) and.push({ tags: { hasSome: tags } });

    if (risk === 'low') and.push({ refusedOrders: 0 });
    if (risk === 'watch') and.push({ refusedOrders: 1 });
    if (risk === 'high') and.push({ refusedOrders: { gte: 2 } });
    if (blocked !== undefined) and.push({ refusedOrders: blocked ? { gte: COD_BLOCK_REFUSALS } : { lt: COD_BLOCK_REFUSALS } });

    if (segment === 'repeat') and.push({ totalOrders: { gte: 2 } });
    if (segment === 'first_time') and.push({ totalOrders: 1 });
    if (segment === 'refused_before') and.push({ refusedOrders: { gte: 1 } });

    if (segment === 'not_reachable' || flagged) {
      const ids = await this.notReachableIds();
      if (segment === 'not_reachable') and.push({ id: { in: ids } });
      if (flagged) and.push({ OR: [{ refusedOrders: { gte: FLAGGED_REFUSALS } }, { id: { in: ids } }] });
    }

    return { isActive: true, AND: and };
  }

  /** Rows the export would write (F-361). */
  async exportCount(filters: CustomerFilters, requester?: Requester) {
    return prisma.customer.count({ where: await this.listWhere(filters, requester) });
  }

  /** The export rows in batches of `size`, newest id first, one cursor read per batch (never the whole set at once). */
  async *exportBatches(filters: CustomerFilters, requester?: Requester, size = 1000) {
    const where = await this.listWhere(filters, requester);
    let last: number | undefined;
    for (;;) {
      const rows = await prisma.customer.findMany({
        where: last === undefined ? where : { AND: [where, { id: { lt: last } }] },
        orderBy: { id: 'desc' },
        take: size,
      });
      if (rows.length === 0) return;
      yield rows;
      last = rows[rows.length - 1].id;
      if (rows.length < size) return;
    }
  }

  private orderBy(sortBy: CustomerSortField | undefined, dir: 'asc' | 'desc'): Prisma.CustomerOrderByWithRelationInput[] {
    switch (sortBy) {
      case 'customer': return [{ firstName: dir }, { lastName: dir }, { id: 'desc' }];
      case 'orders':
      case 'totalOrders': return [{ totalOrders: dir }, { id: 'desc' }];
      case 'deliveredValue':
      case 'totalSpent': return [{ deliveredValue: dir }, { id: 'desc' }];
      case 'lastOrder': return [{ lastOrderAt: { sort: dir, nulls: 'last' } }, { id: 'desc' }];
      default: return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
  }

  /** The stored stats plus the derived risk, COD block and "not reachable" tag of one customer row. */
  private withDerived<T extends { id: number; refusedOrders: number; deliveredValue: Prisma.Decimal; unsubscribeToken?: string | null }>(
    customer: T, notReachable: Set<number>
  ) {
    const { unsubscribeToken, ...row } = customer;
    return {
      ...row,
      // The old "Total spent" column; the list now shows delivered value
      totalSpent: customer.deliveredValue,
      risk: riskOf(customer.refusedOrders),
      codBlocked: customer.refusedOrders >= COD_BLOCK_REFUSALS,
      notReachable: notReachable.has(customer.id),
    };
  }

  /**
   * Get all customers with filters and pagination. Counts come from the stored stats (F-357), not from joins per row.
   */
  async getAllCustomers(filters: CustomerFilters, requester?: Requester) {
    const { page = 1, limit = 25, sortBy, sortOrder = 'desc' } = filters;
    const where = await this.listWhere(filters, requester);

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: this.orderBy(sortBy, sortOrder),
      }),
      prisma.customer.count({ where }),
    ]);

    const unreachable = new Set(await this.notReachableIds(customers.map((c) => c.id)));
    return {
      customers: customers.map((c) => this.withDerived(c, unreachable)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Tiles and segment tabs (F-351). One query per number, all from `listWhere`, so each count equals the list total
   * for the same filters. `segment` is ignored: every tab is counted under the other filters.
   */
  async getSummary(filters: CustomerFilters, requester?: Requester) {
    const base = { ...filters, segment: undefined };
    const baseWhere = await this.listWhere(base, requester);
    const count = async (extra: Partial<CustomerFilters>) =>
      prisma.customer.count({ where: await this.listWhere({ ...base, ...extra }, requester) });

    const zone = getStoreTimeZone(getTenantId());
    const monthStart = startOfDay(`${localDate(new Date(), zone).slice(0, 7)}-01`, zone);
    const [all, repeat, firstTime, refusedBefore, notReachable, blocked, newThisMonth] = await Promise.all([
      prisma.customer.count({ where: baseWhere }),
      count({ segment: 'repeat' }),
      count({ segment: 'first_time' }),
      count({ segment: 'refused_before' }),
      count({ segment: 'not_reachable' }),
      count({ blocked: true }),
      prisma.customer.count({ where: { AND: [baseWhere, { createdAt: { gte: monthStart } }] } }),
    ]);

    // First-time plus repeat are the customers with orders; the two percentages add up to 100
    const withOrders = firstTime + repeat;
    const firstTimePct = withOrders ? Math.round((firstTime / withOrders) * 100) : 0;
    return {
      tiles: {
        total: all,
        newThisMonth,
        firstTime,
        firstTimePct,
        repeat,
        repeatPct: withOrders ? 100 - firstTimePct : 0,
        blocked,
      },
      segments: { all, repeat, first_time: firstTime, refused_before: refusedBefore, not_reachable: notReachable } as Record<CustomerSegment, number>,
    };
  }

  /** The towns in use, for the City filter (F-353). Active customers inside the row scope only. */
  async getTowns(requester?: Requester): Promise<string[]> {
    const scope = this.scopeWhere(requester);
    const rows = await prisma.customer.findMany({
      where: { isActive: true, area: { not: '' }, ...(scope ? { AND: [scope] } : {}) },
      distinct: ['area'],
      select: { area: true },
      orderBy: { area: 'asc' },
    });
    return rows.map((r) => r.area);
  }

  /** A phone that already belongs to a customer blocks the save (F-355, F-362). `exceptId` is the customer being edited. */
  private async assertPhoneFree(phoneNumber: string, requester: Requester | undefined, exceptId?: number, reactivate = false) {
    // Archived customers included: they still hold the number in the unique index
    const owner = await findCustomerByPhoneIncludingArchived(prisma, phoneNumber);
    // The customer's own old-format number matches too; that is not a duplicate.
    if (!owner || owner.id === exceptId) return null;
    // Only the roles that can see deleted customers may restore one
    if (owner.isActive === false && reactivate && isAdminRole(requester)) return owner;
    const archived = owner.isActive === false;
    const err = new AppError(
      archived ? `${fullName(owner)} was deleted and has this number. Restore that customer instead.` : `This number belongs to ${fullName(owner)}`,
      409,
      archived ? 'CUSTOMER_ARCHIVED' : 'PHONE_BELONGS_TO_OTHER_CUSTOMER'
    );
    // The name is in the message (F-355); the id (the link) only goes to a requester who can open that customer
    const scope = this.scopeWhere(requester);
    const canSee = !scope || (await prisma.customer.count({ where: { id: owner.id, AND: [scope] } })) > 0;
    err.details = canSee ? { customerId: owner.id, customerName: fullName(owner) } : { customerName: fullName(owner) };
    throw err;
  }

  private async audit(requester: Requester, action: string, customer: { id: number; tenantId: string | null }, before: object, after: object) {
    await auditService.record({
      tenantId: resolveTenantId(customer.tenantId),
      actorId: requester.id,
      actorKind: 'person',
      channel: 'app',
      action,
      resource: 'customer',
      resourceId: String(customer.id),
      before,
      after,
    });
  }

  /**
   * Create new customer. `createdById` is set so a rep sees the customer they added (F-355).
   */
  async createCustomer(data: CreateCustomerData, requester?: Requester) {
    const phoneNumber = normalizePhoneForStorage(data.phoneNumber);
    const alternatePhone = normalizePhoneForStorage(data.alternatePhone);
    const archived = await this.assertPhoneFree(phoneNumber, requester, undefined, data.reactivate === true);

    const fields = {
      firstName: data.firstName || 'Unknown',
      lastName: data.lastName || '',
      email: data.email,
      phoneNumber,
      alternatePhone,
      address: data.address,
      state: data.state,
      area: data.area,
      landmark: data.landmark,
      notes: data.notes,
    };
    const customer = archived
      ? await withSoftDeleted(() => prisma.customer.update({ where: { id: archived.id }, data: { ...fields, isActive: true } }))
      : await prisma.customer.create({ data: { ...fields, createdById: requester?.id } });

    if (requester) {
      await this.audit(requester, archived ? 'reactivate' : 'create', customer, archived ? { isActive: false } : {}, fields);
    }
    logger.info('Customer created', { customerId: customer.id, phoneNumber: customer.phoneNumber });
    return customer;
  }

  /**
   * Get customer by ID, with stats, risk and block state (F-354). A deleted customer opens for the owner roles only.
   */
  async getCustomerById(customerId: string, requester?: Requester) {
    const id = parseInt(customerId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid customer ID', 400);
    }

    const customer = await withSoftDeleted(() => prisma.customer.findUnique({ where: { id } }));
    if (!customer || (customer.isActive === false && !isAdminRole(requester))) {
      throw new AppError('Customer not found', 404);
    }

    const scope = this.scopeWhere(requester);
    if (scope && (await prisma.customer.count({ where: { id, AND: [scope] } })) === 0) {
      throw new AppError('You do not have permission to view this customer details', 403);
    }

    // A rep or agent sees only their own orders of this customer
    const orderScope: Prisma.OrderWhereInput = !scope ? {}
      : requester!.role === 'delivery_agent' ? { deliveryAgentId: requester!.id }
      : { customerRepId: requester!.id };
    const orders = await prisma.order.findMany({
      where: { customerId: id, deletedAt: null, ...orderScope },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, status: true, totalAmount: true, createdAt: true },
    });

    const unreachable = new Set(await this.notReachableIds([id]));
    return {
      ...this.withDerived(customer, unreachable),
      // Delivered value divided by delivered orders
      averageOrderValue: customer.deliveredOrders > 0 ? Money.toApi(Money.div(customer.deliveredValue, customer.deliveredOrders)) : null,
      orders,
    };
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
   * Update customer details. A rep can edit a customer they can see (F-355). The audit row holds the changed fields
   * before and after.
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

    const scope = this.scopeWhere(requester);
    if (scope && (await prisma.customer.count({ where: { id, AND: [scope] } })) === 0) {
      throw new AppError('You do not have permission to update this customer', 403);
    }

    // Only the form fields; phones are stored normalized (unparseable input stays as typed).
    const changes: Partial<Record<FormField, string | undefined>> = {};
    for (const field of FORM_FIELDS) {
      if (updateData[field] !== undefined) changes[field] = updateData[field];
    }
    if (changes.phoneNumber) changes.phoneNumber = normalizePhoneForStorage(changes.phoneNumber);
    if (changes.alternatePhone) changes.alternatePhone = normalizePhoneForStorage(changes.alternatePhone);

    if (changes.phoneNumber && changes.phoneNumber !== customer.phoneNumber) {
      await this.assertPhoneFree(changes.phoneNumber, requester, id);
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: changes
    });

    if (requester) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const field of Object.keys(changes) as FormField[]) {
        if (customer[field] !== updated[field]) {
          before[field] = customer[field];
          after[field] = updated[field];
        }
      }
      await this.audit(requester, 'update', updated, before, after);
    }

    logger.info('Customer updated', { customerId });
    return updated;
  }

  /**
   * Soft delete customer (deactivate). Owner, admin and manager only. Their orders stay; a customer with an order
   * out for delivery cannot be deleted (F-356).
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
    if (!isAdminRole(requester)) {
      throw new AppError('You do not have permission to delete customers', 403);
    }

    const inFlight = await prisma.order.count({ where: { customerId: id, status: 'out_for_delivery', deletedAt: null } });
    if (inFlight > 0) {
      throw new AppError('This customer has an order out for delivery. Delete them after it is delivered or returned.', 409, 'CUSTOMER_HAS_ORDER_IN_FLIGHT');
    }

    await prisma.customer.update({
      where: { id },
      data: { isActive: false }
    });

    if (requester) {
      await this.audit(requester, 'deactivate', customer, { isActive: true }, { isActive: false });
    }

    logger.info('Customer deactivated', { customerId: id });
    return { message: 'Customer deactivated successfully' };
  }
}

export default new CustomerService();
