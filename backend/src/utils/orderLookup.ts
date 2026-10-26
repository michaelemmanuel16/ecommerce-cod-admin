/**
 * One order lookup for the places that name orders by text: a settlement line and a partner CSV row (M5-T11, T17).
 * Reads only, in the current tenant. The callers decide which orders may take the row; the wording of the two shared
 * refusals lives here so both say it the same way.
 */
import { CollectionStatus, OrderStatus, Prisma } from '@prisma/client';
import prisma, { TransactionClient } from './prisma';
import { looksLikePhone, phoneLookupVariants } from './phone';

export const OTHER_PARTNER_NOTE = 'This order is assigned to another delivery partner';
export const moreThanOneOrder = (what: string) => `More than one order has ${what}`;

export interface LookupOrder {
  id: number;
  status: OrderStatus;
  deliveryAgentId: number | null;
  orderType: string | null;
  customerRepId: number | null;
  externalOrderId: string | null;
  codAmount: Prisma.Decimal | null;
  totalAmount: Prisma.Decimal;
  deliveryFee: Prisma.Decimal | null;
  customer: { phoneNumber: string } | null;
  agentCollection: { id: number; status: CollectionStatus; amount: Prisma.Decimal; allocatedAmount: Prisma.Decimal; collectionDate: Date } | null;
}

export interface OrderRefs {
  ids: Iterable<number>;
  externalIds: Iterable<string>;
  /** Phones as written; every stored form of each is searched. */
  phones: Iterable<string>;
}

/**
 * Orders named by id, by external order id, or by customer phone, in one query. `externalPartnerId` limits the external
 * id match to one partner. `phoneStatuses` are the statuses a phone match may have; `phonePartnerId` limits it to one partner.
 */
export async function loadOrdersByRefs(
  db: Pick<TransactionClient, 'order'> | typeof prisma,
  refs: OrderRefs,
  opts: { externalPartnerId?: number; phoneStatuses: OrderStatus[]; phonePartnerId?: number },
): Promise<LookupOrder[]> {
  const ids = [...new Set(refs.ids)];
  const externalIds = [...new Set(refs.externalIds)];
  const variants = new Set<string>();
  for (const phone of refs.phones) if (looksLikePhone(phone)) phoneLookupVariants(phone).forEach((v) => variants.add(v));
  if (!ids.length && !externalIds.length && !variants.size) return [];

  return db.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(externalIds.length ? [{ externalOrderId: { in: externalIds }, ...(opts.externalPartnerId !== undefined ? { deliveryAgentId: opts.externalPartnerId } : {}) }] : []),
        ...(variants.size ? [{
          status: { in: opts.phoneStatuses }, customer: { phoneNumber: { in: [...variants] } },
          ...(opts.phonePartnerId !== undefined ? { deliveryAgentId: opts.phonePartnerId } : {}),
        }] : []),
      ],
    },
    select: {
      id: true, status: true, deliveryAgentId: true, orderType: true, customerRepId: true, externalOrderId: true,
      codAmount: true, totalAmount: true, deliveryFee: true, customer: { select: { phoneNumber: true } },
      agentCollection: { select: { id: true, status: true, amount: true, allocatedAmount: true, collectionDate: true } },
    },
  });
}
