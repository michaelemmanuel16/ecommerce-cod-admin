import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { customerScope, orderScope, Requester } from '../../utils/authUtils';
import { withSoftDeleted } from '../../utils/prismaExtensions';
import { hasPermission } from '../permissionService';

/** The subjects a reminder or a thread can point at (M9-T18, T19). */
export const NOTE_SUBJECT_TYPES = ['order', 'customer', 'payout', 'product'] as const;
export type NoteSubjectType = (typeof NOTE_SUBJECT_TYPES)[number];

/**
 * The subject must exist in the caller's tenant (the scoped client adds the tenant; a deleted order and an
 * inactive customer or product do not exist) and the caller must be allowed to see it:
 * a rep or agent only sees the orders and customers `orderScope` and `customerScope` give them (the same rule as the
 * order and customer APIs), the role must hold `orders:view` or `customers:view`, a payout is for the payee and for people with `payouts:view`, a product for `products:view`.
 * Missing or other tenant: 404. Not allowed: 403. `includeDeleted` also finds a deleted order, customer or product (to read an archived thread).
 */
export function assertSubjectVisible(type: NoteSubjectType, id: number, user: Requester, opts: { includeDeleted?: boolean } = {}): Promise<void> {
  // An archived thread outlives its subject: it can still be read by whoever could see the subject
  const check = async () => checkAllowed(type, id, user, await loadSubject(type, id));
  return opts.includeDeleted ? withSoftDeleted(check) : check();
}

/**
 * The people (in the order given) who may open the subject: the same rule as `assertSubjectVisible` for each of them,
 * with the subject read once. A subject that does not exist gives nobody. Any error other than 403 is thrown.
 */
export async function filterVisible<P extends Requester>(type: NoteSubjectType, id: number, people: P[], opts: { includeDeleted?: boolean } = {}): Promise<P[]> {
  const run = async () => {
    if (people.length === 0) return [];
    let subject: Subject;
    try {
      subject = await loadSubject(type, id);
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return [];
      throw error;
    }
    const allowed = await Promise.all(people.map(async (person) => {
      try {
        await checkAllowed(type, id, person, subject);
        return true;
      } catch (error) {
        if (error instanceof AppError && error.statusCode === 403) return false;
        throw error;
      }
    }));
    return people.filter((_, index) => allowed[index]);
  };
  return opts.includeDeleted ? withSoftDeleted(run) : run();
}

type Subject = { id: number; payeeId?: number };

/** The subject row, or a 404 when it is missing (or in another tenant). */
async function loadSubject(type: NoteSubjectType, id: number): Promise<Subject> {
  switch (type) {
    case 'order': {
      const order = await prisma.order.findFirst({ where: { id }, select: { id: true } });
      if (!order) throw new AppError('Order not found', 404);
      return order;
    }
    case 'customer': {
      const customer = await prisma.customer.findFirst({ where: { id }, select: { id: true } });
      if (!customer) throw new AppError('Customer not found', 404);
      return customer;
    }
    case 'payout': {
      const payout = await prisma.payout.findFirst({ where: { id }, select: { id: true, payeeId: true } });
      if (!payout) throw new AppError('Payout not found', 404);
      return payout;
    }
    case 'product': {
      const product = await prisma.product.findFirst({ where: { id }, select: { id: true } });
      if (!product) throw new AppError('Product not found', 404);
      return product;
    }
  }
}

/** Permission and row scope of one person for a subject that exists (403 when refused). */
async function checkAllowed(type: NoteSubjectType, id: number, user: Requester, subject: Subject): Promise<void> {
  switch (type) {
    case 'order': {
      if (!(await hasPermission(user, 'orders', 'view'))) throw new AppError('You do not have permission to view this order', 403);
      const scope = orderScope(user);
      // An unscoped role sees every order, and the order was just found: no second query
      if (Object.keys(scope).length > 0 && (await prisma.order.count({ where: { id, ...scope } })) === 0) throw new AppError('You do not have permission to view this order', 403);
      return;
    }
    case 'customer': {
      if (!(await hasPermission(user, 'customers', 'view'))) throw new AppError('You do not have permission to view this customer', 403);
      const scope = customerScope(user);
      if (scope && (await prisma.customer.count({ where: { id, AND: [scope] } })) === 0) throw new AppError('You do not have permission to view this customer', 403);
      return;
    }
    case 'payout': {
      if (subject.payeeId !== user.id && !(await hasPermission(user, 'payouts', 'view'))) throw new AppError('You do not have permission to view this payout', 403);
      return;
    }
    case 'product': {
      if (!(await hasPermission(user, 'products', 'view'))) throw new AppError('You do not have permission to view this product', 403);
      return;
    }
  }
}
