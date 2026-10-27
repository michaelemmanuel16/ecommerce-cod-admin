import { FindingStatus, FindingType, Prisma } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import * as Money from '../utils/money';
import { AppError } from '../middleware/errorHandler';
import { isOwner, Requester } from '../utils/authUtils';
import { resolveTenantId } from '../utils/tenantContext';
import { fullName } from '../utils/nameUtils';
import { OPEN_COLLECTION_STATUSES } from '../utils/collectionCash';
import { auditService } from './auditService';
import { GLAutomationService } from './glAutomationService';
import { createNotification } from './notificationService';
import logger from '../utils/logger';
import { ResolveStatus } from '../validators/findingSchema';

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

/**
 * `openFindingOnce` for many Findings in one go (a settlement opens several): one read for the keys, one createMany for
 * the missing, one read for the new ids. Same rule: a Finding with the key in any status counts, so a resolved one is not
 * re-created. Returns the id for each item, in order.
 */
export async function openFindingsOnce(
  items: Prisma.FindingUncheckedCreateInput[],
  db: Pick<TransactionClient, 'finding'> = prisma,
): Promise<number[]> {
  if (items.length === 0) return [];
  const keyOf = (f: { type: string; subjectType: string; subjectId: string }) => `${f.type}|${f.subjectType}|${f.subjectId}`;
  const groups = new Map<string, { type: Prisma.FindingUncheckedCreateInput['type']; subjectType: string; ids: string[] }>();
  for (const item of items) {
    const g = groups.get(`${item.type}|${item.subjectType}`) ?? { type: item.type, subjectType: item.subjectType, ids: [] };
    g.ids.push(item.subjectId);
    groups.set(`${item.type}|${item.subjectType}`, g);
  }
  const where = { OR: [...groups.values()].map((g) => ({ type: g.type, subjectType: g.subjectType, subjectId: { in: g.ids } })) };
  const read = () => db.finding.findMany({ where, select: { id: true, type: true, subjectType: true, subjectId: true } });

  const have = new Set((await read()).map(keyOf));
  const missing = items.filter((i, at) => !have.has(keyOf(i)) && items.findIndex((j) => keyOf(j) === keyOf(i)) === at);
  if (missing.length > 0) await db.finding.createMany({ data: missing });
  const idOf = new Map((await read()).map((f) => [keyOf(f), f.id]));
  return items.map((i) => idOf.get(keyOf(i))!);
}

// ---- M5-T08: the Findings list and its work (F-909) ----

export interface FindingFilters {
  type?: FindingType;
  status?: FindingStatus;
  /** A user id, or `none` for Findings nobody works on. */
  assigneeId?: number | 'none';
  page: number;
  limit: number;
}

const findingSelect = {
  id: true, type: true, status: true, subjectType: true, subjectId: true, amount: true, note: true,
  explanation: true, assigneeId: true, resolvedById: true, resolvedAt: true, createdAt: true,
  assignee: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.FindingSelect;

type FindingRow = Prisma.FindingGetPayload<{ select: typeof findingSelect }>;

/** One Finding as the API returns it. */
function findingView(f: FindingRow) {
  const { assignee, ...rest } = f;
  return { ...rest, assignee: assignee ? { id: assignee.id, name: fullName(assignee) } : null };
}

/** Findings of the current tenant, newest first, with the type, status and assignee filters. */
export async function listFindings(filters: FindingFilters) {
  const { page, limit } = filters;
  const where: Prisma.FindingWhereInput = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.assigneeId === 'none' ? { assigneeId: null } : filters.assigneeId !== undefined ? { assigneeId: filters.assigneeId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.finding.findMany({ where, select: findingSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.finding.count({ where }),
  ]);
  return { findings: rows.map(findingView), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export interface FindingChange {
  /** A user id to work the Finding; null clears it. */
  assigneeId?: number | null;
  /** explained or written_off; both need `explanation`. */
  status?: ResolveStatus;
  explanation?: string;
}

/**
 * Assign and resolve in one PATCH (F-909). Only an open Finding changes. Explained and written off need a note;
 * a write-off is the owner's call and posts through GLAutomationService.createFindingWriteOffEntry, in the same
 * transaction. The status is claimed with a conditional update, so two people resolving at once cannot both win and
 * the write-off posts once.
 */
export async function updateFinding(requester: Requester, id: number, change: FindingChange) {
  const tenantId = resolveTenantId();
  if (change.assigneeId === undefined && change.status === undefined) throw new AppError('Nothing to change', 400, 'NOTHING_TO_CHANGE');
  const explanation = change.explanation?.trim();
  if (change.status && !explanation) throw new AppError('A note is required to explain or write off a Finding', 400, 'NOTE_REQUIRED');
  if (change.status === 'written_off' && !isOwner(requester)) throw new AppError('Only the owner can write off a Finding', 403, 'OWNER_ONLY');

  const [finding, assignee] = await Promise.all([
    prisma.finding.findFirst({ where: { id }, select: findingSelect }),
    change.assigneeId
      ? prisma.user.findFirst({ where: { id: change.assigneeId, isActive: true, kind: { in: ['person', 'company'] } }, select: { id: true, firstName: true, lastName: true } })
      : null,
  ]);
  if (!finding) throw new AppError('Finding not found', 404);
  if (finding.status !== 'open') throw new AppError(`This Finding is already ${finding.status.replace('_', ' ')}`, 409, 'FINDING_CLOSED');
  if (change.assigneeId && !assignee) throw new AppError('Assignee must be an active user of this account', 400, 'INVALID_ASSIGNEE');

  const resolved = change.status ? resolveData(change.status, explanation!, requester.id) : {};
  await prisma.$transaction(async (tx) => {
    const claim = await tx.finding.updateMany({
      where: { id, status: 'open' },
      data: { ...(change.assigneeId !== undefined ? { assigneeId: change.assigneeId } : {}), ...resolved },
    });
    if (claim.count === 0) throw new AppError('This Finding was changed by someone else. Reload and try again.', 409, 'FINDING_CHANGED');
    if (change.status === 'written_off') {
      await GLAutomationService.createFindingWriteOffEntry(tx as unknown as Prisma.TransactionClient, finding, requester.id, explanation!);
    }
    await auditService.record({
      tenantId, actorId: requester.id, actorKind: 'person', channel: 'app',
      action: 'update', resource: 'finding', resourceId: String(id),
      before: { status: finding.status, assigneeId: finding.assigneeId },
      after: { ...change, explanation },
      tx,
    });
  });

  // The new assignee gets an in-app notification (the per-user inbox the app has). Not for a self-assignment, and a failure here never undoes the assignment.
  const shouldNotify = !!change.assigneeId && change.assigneeId !== finding.assigneeId && change.assigneeId !== requester.id;
  if (shouldNotify) {
    try {
      await createNotification(String(change.assigneeId), 'finding', 'Finding assigned to you',
        `A ${finding.type.replace(/_/g, ' ')} Finding was assigned to you.`, { findingId: id, type: finding.type });
    } catch (error) {
      logger.warn('Finding assigned but the notification failed', { findingId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return findingView({
    ...finding,
    ...resolved,
    ...(change.assigneeId !== undefined ? { assigneeId: change.assigneeId, assignee } : {}),
  });
}

/** What closing a Finding writes: its status, the note, and when and by whom (null for the system). The one place for every close. */
const resolveData = (status: FindingStatus, explanation: string, resolvedById: number | null) =>
  ({ status, explanation, resolvedAt: new Date(), resolvedById });

/**
 * A later payout cleared the cause of short_pay Findings: close each open one of this partner whose settlement has
 * no unpaid cash left on the orders it matched, as explained with "Cleared by settlement <reference>" (F-909).
 * Runs in the settlement's transaction, after its collections are claimed. Returns the ids it closed.
 */
export async function closeClearedShortPays(
  db: Pick<TransactionClient, 'finding' | 'partnerSettlement' | 'agentCollection'>,
  partnerId: number,
  clearedByReference: string,
): Promise<number[]> {
  const settlements = await db.partnerSettlement.findMany({
    where: { partnerId, shortAmount: { gt: 0 } },
    select: { id: true, lines: { where: { orderId: { not: null } }, select: { orderId: true } } },
  });
  if (settlements.length === 0) return [];
  const open = await db.finding.findMany({
    where: { type: 'short_pay', subjectType: 'partner_settlement', status: 'open', subjectId: { in: settlements.map((s) => String(s.id)) } },
    select: { id: true, subjectId: true },
  });
  if (open.length === 0) return [];

  const settlementOf = new Map(settlements.map((s) => [String(s.id), s]));
  const orderIds = open.flatMap((f) => settlementOf.get(f.subjectId)!.lines.map((l) => l.orderId!));
  const stillOpen = new Set((await db.agentCollection.findMany({
    where: { orderId: { in: orderIds }, status: { in: [...OPEN_COLLECTION_STATUSES] } },
    select: { orderId: true },
  })).map((c) => c.orderId));
  const cleared = open.filter((f) => !settlementOf.get(f.subjectId)!.lines.some((l) => stillOpen.has(l.orderId!)));
  if (cleared.length === 0) return [];

  await db.finding.updateMany({
    where: { id: { in: cleared.map((f) => f.id) }, status: 'open' },
    data: resolveData('explained', `Cleared by settlement ${clearedByReference}`, null),
  });
  return cleared.map((f) => f.id);
}
