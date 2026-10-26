import { Prisma } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import * as Money from '../utils/money';

/**
 * Open a Finding unless one for the same (type, subjectType, subjectId) already exists in the current tenant.
 * Default: an open one counts. `includeClosed`: any status counts, so a resolved Finding is not re-created.
 * `updateAmount`: an existing open Finding gets the new amount. Runs inside the tenant context.
 * `db`: pass a transaction client to write in the caller's transaction (stockService does).
 * Returns the id of the Finding that now stands for the key (the existing one, or the new one).
 */
export async function openFindingOnce(
  data: Prisma.FindingUncheckedCreateInput,
  opts: { includeClosed?: boolean; updateAmount?: boolean } = {},
  db: Pick<TransactionClient, 'finding'> = prisma,
): Promise<number> {
  const existing = await db.finding.findFirst({
    where: {
      type: data.type,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      ...(opts.includeClosed ? {} : { status: 'open' }),
    },
    select: { id: true, status: true, amount: true },
  });
  if (!existing) {
    return (await db.finding.create({ data, select: { id: true } })).id;
  }
  if (opts.updateAmount && existing.status === 'open' && data.amount !== undefined && data.amount !== null
    && !Money.orZero(existing.amount).eq(Money.parse(data.amount as Prisma.Decimal))) {
    await db.finding.update({ where: { id: existing.id }, data: { amount: data.amount } });
  }
  return existing.id;
}
