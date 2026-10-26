import { FindingStatus, FindingType, Prisma } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import * as Money from '../utils/money';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { resolveTenantId } from '../utils/tenantContext';
import { fullName } from '../utils/nameUtils';
import { OPEN_COLLECTION_STATUSES } from '../utils/collectionCash';
import { auditService } from './auditService';

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

// ---- M5-T08: the Findings list and its work (F-909) ----

/** The statuses a person can move an open Finding to. `closed` is for the system (a settlement cleared the cause). */
const RESOLVE_STATUSES = ['explained', 'written_off'] as const;
type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

export interface FindingFilters {
  type?: FindingType;
  status?: FindingStatus;
  /** A user id, or `none` for Findings nobody works on. */
  assigneeId?: number | 'none';
  page?: number;
  limit?: number;
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
export async function listFindings(filters: FindingFilters = {}) {
  const page = Math.max(filters.page ?? 1, 1);
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 200);
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
 * a write-off is the owner's call. The status is claimed with a conditional update, so two people resolving at once
 * cannot both win. Posting the write-off to the ledger is not done here.
 */
export async function updateFinding(requester: Requester, id: number, change: FindingChange) {
  const tenantId = resolveTenantId();
  if (change.assigneeId === undefined && change.status === undefined) throw new AppError('Nothing to change', 400, 'NOTHING_TO_CHANGE');
  if (change.status !== undefined && !RESOLVE_STATUSES.includes(change.status)) {
    throw new AppError('Status must be explained or written_off', 400, 'INVALID_STATUS');
  }
  const explanation = change.explanation?.trim();
  if (change.status && !explanation) throw new AppError('A note is required to explain or write off a Finding', 400, 'NOTE_REQUIRED');
  if (change.status === 'written_off' && requester.role !== 'super_admin') {
    throw new AppError('Only the owner can write off a Finding', 403, 'OWNER_ONLY');
  }

  const finding = await prisma.finding.findFirst({ where: { id }, select: { id: true, status: true, assigneeId: true } });
  if (!finding) throw new AppError('Finding not found', 404);
  if (finding.status !== 'open') throw new AppError(`This Finding is already ${finding.status.replace('_', ' ')}`, 409, 'FINDING_CLOSED');

  if (change.assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: change.assigneeId, isActive: true, kind: { in: ['person', 'company'] } }, select: { id: true } });
    if (!assignee) throw new AppError('Assignee must be an active user of this account', 400, 'INVALID_ASSIGNEE');
  }

  await prisma.$transaction(async (tx) => {
    const claim = await tx.finding.updateMany({
      where: { id, status: 'open' },
      data: {
        ...(change.assigneeId !== undefined ? { assigneeId: change.assigneeId } : {}),
        ...(change.status ? { status: change.status, explanation, resolvedAt: new Date(), resolvedById: requester.id } : {}),
      },
    });
    if (claim.count === 0) throw new AppError('This Finding was changed by someone else. Reload and try again.', 409, 'FINDING_CHANGED');
    await auditService.record({
      tenantId, actorId: requester.id, actorKind: 'person', channel: 'app',
      action: 'update', resource: 'finding', resourceId: String(id),
      before: { status: finding.status, assigneeId: finding.assigneeId },
      after: { ...change, explanation },
      tx,
    });
  });
  return findingView(await prisma.finding.findFirstOrThrow({ where: { id }, select: findingSelect }));
}

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
  const open = await db.finding.findMany({
    where: { type: 'short_pay', subjectType: 'partner_settlement', status: 'open' },
    select: { id: true, subjectId: true },
  });
  const settlementIds = open.map((f) => Number(f.subjectId)).filter((n) => Number.isInteger(n));
  if (settlementIds.length === 0) return [];

  const settlements = await db.partnerSettlement.findMany({
    where: { id: { in: settlementIds }, partnerId },
    select: { id: true, lines: { where: { orderId: { not: null } }, select: { orderId: true } } },
  });
  const closed: number[] = [];
  for (const settlement of settlements) {
    const orderIds = settlement.lines.map((l) => l.orderId!);
    const stillOpen = await db.agentCollection.count({ where: { orderId: { in: orderIds }, status: { in: [...OPEN_COLLECTION_STATUSES] } } });
    if (stillOpen > 0) continue;
    const finding = open.find((f) => Number(f.subjectId) === settlement.id)!;
    const res = await db.finding.updateMany({
      where: { id: finding.id, status: 'open' },
      data: { status: 'explained', explanation: `Cleared by settlement ${clearedByReference}`, resolvedAt: new Date() },
    });
    if (res.count === 1) closed.push(finding.id);
  }
  return closed;
}
