import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import * as Money from '../utils/money';

/**
 * Open a Finding unless one for the same (type, subjectType, subjectId) already exists in the current tenant.
 * Default: an open one counts. `includeClosed`: any status counts, so a resolved Finding is not re-created.
 * `updateAmount`: an existing open Finding gets the new amount. Runs inside the tenant context.
 */
export async function openFindingOnce(
  data: Prisma.FindingUncheckedCreateInput,
  opts: { includeClosed?: boolean; updateAmount?: boolean } = {},
): Promise<void> {
  const existing = await prisma.finding.findFirst({
    where: {
      type: data.type,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      ...(opts.includeClosed ? {} : { status: 'open' }),
    },
    select: { id: true, status: true, amount: true },
  });
  if (!existing) {
    await prisma.finding.create({ data });
    return;
  }
  if (opts.updateAmount && existing.status === 'open' && data.amount !== undefined && data.amount !== null
    && !Money.orZero(existing.amount).eq(Money.parse(data.amount as Prisma.Decimal))) {
    await prisma.finding.update({ where: { id: existing.id }, data: { amount: data.amount } });
  }
}
