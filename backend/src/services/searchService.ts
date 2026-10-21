import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { hasPermission } from '../middleware/auth';
import { Requester } from '../utils/authUtils';
import { looksLikePhone, phoneSearchConditions } from '../utils/phone';

/** M3-T08: command palette search (F-105). Orders and customers, 5 each, tenant-scoped and permission-filtered. */

const LIMIT = 5;
const MIN_LENGTH = 2;
const MAX_LENGTH = 100;
/** Order ids are Int4; this many digits always fit. */
const MAX_ID_DIGITS = 9;

type PhoneConditions = ReturnType<typeof phoneSearchConditions>;

interface Query {
  /** Order number to match, from `#23001` or a short run of digits. */
  orderId: number | null;
  phone: PhoneConditions;
  /** Every word must be in the first or last name. Empty when the term looks like a phone number. */
  nameWords: string[];
}

/**
 * `#23001` is an order number only. Digits with 7 or more characters are a phone first (F-105).
 * Shorter digit runs are both: an order number and the start of a phone. Anything else is a name.
 */
export function classifyQuery(raw: string): Query {
  const term = raw.trim();
  const hashed = term.startsWith('#');
  const body = hashed ? term.slice(1).trim() : term;
  const idLike = /^\d+$/.test(body) && body.length <= MAX_ID_DIGITS;
  const orderId = idLike && (hashed || !looksLikePhone(body) || body.length < 7) ? Number(body) : null;
  if (hashed) return { orderId, phone: [], nameWords: [] };
  return {
    orderId,
    phone: phoneSearchConditions(body),
    nameWords: looksLikePhone(body) ? [] : body.split(/\s+/).filter(Boolean),
  };
}

export const nameMatch = (words: string[]): Prisma.CustomerWhereInput => ({
  AND: words.map((w) => ({
    OR: [
      { firstName: { contains: w, mode: 'insensitive' as const } },
      { lastName: { contains: w, mode: 'insensitive' as const } },
    ],
  })),
});

class SearchService {
  async search(q: string, requester: Requester) {
    const term = q.trim().slice(0, MAX_LENGTH);
    if (term.length < MIN_LENGTH) return { orders: [], customers: [] };
    const query = classifyQuery(term);

    const customerMatch: Prisma.CustomerWhereInput[] = [
      ...query.phone.map((p) => p as Prisma.CustomerWhereInput),
      ...(query.nameWords.length ? [nameMatch(query.nameWords)] : []),
    ];

    const [canOrders, canCustomers] = await Promise.all([
      hasPermission(requester, 'orders', 'view'),
      hasPermission(requester, 'customers', 'view'),
    ]);

    const [orders, customers] = await Promise.all([
      canOrders ? this.findOrders(query, customerMatch, requester) : [],
      canCustomers ? this.findCustomers(customerMatch, requester) : [],
    ]);
    return { orders, customers };
  }

  private findOrders(query: Query, customerMatch: Prisma.CustomerWhereInput[], requester: Requester) {
    const or: Prisma.OrderWhereInput[] = [
      ...(query.orderId !== null ? [{ id: query.orderId }] : []),
      ...(customerMatch.length ? [{ customer: { OR: customerMatch } }] : []),
    ];
    if (!or.length) return [];

    // Same row scope as the orders list: a rep sees own orders, an agent own deliveries.
    const scope: Prisma.OrderWhereInput = requester.role === 'sales_rep' ? { customerRepId: requester.id }
      : requester.role === 'delivery_agent' ? { deliveryAgentId: requester.id }
      : {};

    return prisma.order.findMany({
      where: { deletedAt: null, ...scope, OR: or },
      orderBy: { createdAt: 'desc' },
      take: LIMIT,
      select: {
        id: true, status: true, totalAmount: true, createdAt: true,
        customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      },
    });
  }

  private findCustomers(customerMatch: Prisma.CustomerWhereInput[], requester: Requester) {
    if (!customerMatch.length) return [];

    // Same row scope as the customers list: below manager, only customers with an order of theirs.
    const scoped = !['super_admin', 'admin', 'manager'].includes(requester.role);
    const scope: Prisma.CustomerWhereInput = scoped
      ? { orders: { some: { deletedAt: null, OR: [{ customerRepId: requester.id }, { deliveryAgentId: requester.id }] } } }
      : {};

    return prisma.customer.findMany({
      where: { ...scope, OR: customerMatch },
      orderBy: [{ totalOrders: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: { id: true, firstName: true, lastName: true, phoneNumber: true, area: true, state: true, totalOrders: true },
    });
  }
}

export default new SearchService();
