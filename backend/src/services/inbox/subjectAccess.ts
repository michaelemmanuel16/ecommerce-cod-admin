import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { customerScope, orderScope, Requester } from '../../utils/authUtils';
import { withSoftDeleted } from '../../utils/prismaExtensions';
import { hasPermission } from '../permissionService';

/** The subjects a reminder or a thread can point at (M9-T18, T19). */
export const NOTE_SUBJECT_TYPES = ['order', 'customer', 'payout', 'product'] as const;
export type NoteSubjectType = (typeof NOTE_SUBJECT_TYPES)[number];

export const isNoteSubjectType = (v: unknown): v is NoteSubjectType => (NOTE_SUBJECT_TYPES as readonly string[]).includes(v as string);

/**
 * The subject must exist in the caller's tenant (the scoped client adds the tenant; a deleted order and an
 * inactive customer or product do not exist) and the caller must be allowed to see it:
 * a rep or agent only sees the orders and customers `orderScope` and `customerScope` give them (the same rule as the
 * order and customer APIs), the role must hold `orders:view` or `customers:view`, a payout is for the payee and for people with `payouts:view`, a product for `products:view`.
 * Missing or other tenant: 404. Not allowed: 403. `includeDeleted` also finds a deleted order, customer or product (to read an archived thread).
 */
export function assertSubjectVisible(type: NoteSubjectType, id: number, user: Requester, opts: { includeDeleted?: boolean } = {}): Promise<void> {
  // An archived thread outlives its subject: it can still be read by whoever could see the subject
  return opts.includeDeleted ? withSoftDeleted(() => checkVisible(type, id, user)) : checkVisible(type, id, user);
}

async function checkVisible(type: NoteSubjectType, id: number, user: Requester): Promise<void> {
  switch (type) {
    case 'order': {
      const order = await prisma.order.findFirst({ where: { id }, select: { id: true } });
      if (!order) throw new AppError('Order not found', 404);
      if (!(await hasPermission(user, 'orders', 'view'))) throw new AppError('You do not have permission to view this order', 403);
      if ((await prisma.order.count({ where: { id, ...orderScope(user) } })) === 0) throw new AppError('You do not have permission to view this order', 403);
      return;
    }
    case 'customer': {
      const customer = await prisma.customer.findFirst({ where: { id }, select: { id: true } });
      if (!customer) throw new AppError('Customer not found', 404);
      if (!(await hasPermission(user, 'customers', 'view'))) throw new AppError('You do not have permission to view this customer', 403);
      const scope = customerScope(user);
      if (scope && (await prisma.customer.count({ where: { id, AND: [scope] } })) === 0) throw new AppError('You do not have permission to view this customer', 403);
      return;
    }
    case 'payout': {
      const payout = await prisma.payout.findFirst({ where: { id }, select: { id: true, payeeId: true } });
      if (!payout) throw new AppError('Payout not found', 404);
      if (payout.payeeId !== user.id && !(await hasPermission(user, 'payouts', 'view'))) throw new AppError('You do not have permission to view this payout', 403);
      return;
    }
    case 'product': {
      const product = await prisma.product.findFirst({ where: { id }, select: { id: true } });
      if (!product) throw new AppError('Product not found', 404);
      if (!(await hasPermission(user, 'products', 'view'))) throw new AppError('You do not have permission to view this product', 403);
      return;
    }
  }
}
