import { Prisma, UserRole, OrderStatus } from '@prisma/client';
import type { z } from 'zod';
import prisma, { prismaBase } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { resolveTenantId } from '../utils/tenantContext';
import { fullName } from '../utils/nameUtils';
import { isForeignKeyViolation } from '../utils/prismaErrors';
import { Requester, assertMayManage } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { adminService } from './adminService';
import { holderStatus } from './roleService';
import { assertNotLastOwner } from './systemRoleService';
import type { StaffStatus, staffQuerySchema, updateStaffSchema } from '../validators/staffSchema';

/**
 * M6-T05 (F-1157, F-1159 to F-1162, F-1165): the team table. Staff are the people and companies of the tenant (the system
 * user and AI agents are not staff). Call inside the tenant context. The invite flow is in inviteService (M6-T06).
 *
 * Status of a person:
 * - active: `isActive`.
 * - deleted: not active, with a `deletedAt` date.
 * - invited: not active, has an invite date (the T03 rule, `holderStatus`).
 * - deactivated: any other inactive person.
 */

export type { StaffStatus };
export type StaffQuery = z.infer<typeof staffQuerySchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

const STAFF_KINDS: Prisma.UserWhereInput = { kind: { in: ['person', 'company'] } };

/** Orders in these statuses are done; every other order is open work for its rep or partner. */
const CLOSED_ORDER_STATUSES: OrderStatus[] = ['delivered', 'digital_delivered', 'cancelled', 'returned'];

export const staffSelect = {
  id: true, firstName: true, lastName: true, email: true, phoneNumber: true, kind: true, role: true, isActive: true,
  invitedAt: true, deletedAt: true, lastLogin: true, createdAt: true, commissionAmount: true, vehicleType: true, vehicleId: true,
  roleAssignments: { where: { toDate: null }, select: { role: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

export const staffStatus = (u: { isActive: boolean; invitedAt: Date | null; deletedAt: Date | null }): StaffStatus =>
  !u.isActive && u.deletedAt ? 'deleted' : holderStatus(u);

/** The rows of each status, as a `where` (the same rule as `staffStatus`). */
const STATUS_WHERE: Record<StaffStatus, Prisma.UserWhereInput> = {
  active: { isActive: true },
  invited: { isActive: false, deletedAt: null, invitedAt: { not: null } },
  deactivated: { isActive: false, deletedAt: null, invitedAt: null },
  deleted: { isActive: false, deletedAt: { not: null } },
};

/** A delivery partner's fee is a fee rule (M5), not a field of the person (F-1161). */
const feeRuleOf = (u: { id: number; role: UserRole }) =>
  u.role === 'delivery_agent' ? { editable: false, url: `/api/delivery-partners/${u.id}/fee-rules` } : null;

export const staffView = ({ roleAssignments, commissionAmount, ...u }: StaffRow) => ({
  ...u,
  name: fullName(u),
  status: staffStatus(u),
  commissionAmount: commissionAmount?.toString() ?? null,
  positions: roleAssignments.map((a) => a.role),
  feeRule: feeRuleOf(u),
});

export type StaffView = ReturnType<typeof staffView>;

/** A person of the tenant (any status), or 404. */
export async function findStaff(id: number): Promise<StaffRow> {
  const row = await withSoftDeleted(() => prisma.user.findFirst({ where: { id, ...STAFF_KINDS }, select: staffSelect }));
  if (!row) throw new AppError('Staff member not found', 404);
  return row;
}

/**
 * The guard sequence every status change shares: find the person, check the actor may act on them (not themselves, and only
 * a lower rank), let `run` check the status and write, answer with the new row.
 */
async function transition(
  actor: Requester,
  id: number,
  selfMessage: string,
  run: (target: StaffRow, status: StaffStatus) => Promise<StaffRow>,
): Promise<StaffView> {
  const target = await findStaff(id);
  assertMayManage(actor, target, { self: selfMessage });
  return staffView(await run(target, staffStatus(target)));
}

/**
 * GET /api/staff. The tab counts cover the role and search filters but not the status filter, so every tab shows its own
 * number. Without a status the list is everyone except the deleted.
 */
export async function listStaff(query: StaffQuery) {
  const role = query.role;
  const base: Prisma.UserWhereInput = {
    ...STAFF_KINDS,
    ...(role !== undefined && (/^\d+$/.test(role)
      ? { roleAssignments: { some: { roleId: Number(role), toDate: null } } }
      : { role: role as UserRole })),
    ...(query.q && {
      OR: [
        { firstName: { contains: query.q, mode: 'insensitive' } },
        { lastName: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { phoneNumber: { contains: query.q } },
      ],
    }),
  };
  // Every status `where` names isActive, so the soft-delete filter stays out of the way; the default list names deletedAt.
  const listWhere = query.status ? STATUS_WHERE[query.status] : { deletedAt: null };
  const [active, invited, deactivated, deleted, rows] = await withSoftDeleted(() => Promise.all([
    ...(['active', 'invited', 'deactivated', 'deleted'] as const).map((s) => prisma.user.count({ where: { AND: [base, STATUS_WHERE[s]] } })),
    prisma.user.findMany({ where: { AND: [base, listWhere] }, select: staffSelect, orderBy: [{ firstName: 'asc' }, { id: 'asc' }] }),
  ] as const)) as [number, number, number, number, StaffRow[]];
  return { counts: { active, invited, deactivated, deleted } satisfies Record<StaffStatus, number>, staff: rows.map(staffView) };
}

/**
 * Edit a person. The commission applies to deliveries made after the change; earlier commission entries are not touched.
 * Two reads: the person here, their role in `updateUser`, which also writes the row and returns it.
 */
export async function updateStaff(actor: Requester, id: number, input: UpdateStaffInput): Promise<StaffView> {
  const target = await findStaff(id);
  if (staffStatus(target) === 'deleted') throw new AppError('Restore this person before editing', 409, 'STAFF_DELETED');
  if ((input.role ?? target.role) === 'delivery_agent' && input.commissionAmount !== undefined) {
    throw new AppError('A delivery partner has no commission here. Their fee is set in the partner fee rule.', 400, 'FEE_NOT_EDITABLE');
  }
  return staffView(await adminService.updateUser(actor, id, input, { select: staffSelect }) as StaffRow);
}

/** An admin sets a new password; every session of the person ends. A company, an invited or a deleted person has no login to reset. */
export async function resetStaffPassword(actor: Requester, id: number, password: string): Promise<void> {
  const target = await findStaff(id);
  assertMayManage(actor, target, { self: 'Change your own password in your profile' });
  const status = staffStatus(target);
  if (target.kind === 'company') throw new AppError('A company has no login', 400, 'NO_LOGIN');
  if (status === 'invited') throw new AppError('This person has not accepted the invite yet. They choose their own password.', 409, 'STAFF_INVITED');
  if (status === 'deleted') throw new AppError('Restore this person first', 409, 'STAFF_DELETED');
  await adminService.resetUserPassword(actor, id, password);
}

/** Active to deactivated. The person is signed out everywhere. */
export const deactivateStaff = (actor: Requester, id: number) =>
  transition(actor, id, 'You cannot deactivate yourself', (target, status) => {
    if (status === 'invited') throw new AppError('This person has not accepted the invite yet. Delete the invite instead.', 409, 'STAFF_INVITED');
    if (status !== 'active') throw new AppError(`This person is already ${status}`, 409, 'NOT_ACTIVE');
    // invitedAt goes: an accepted invite must not read as "invited" once the person is inactive (the T03 status rule).
    return adminService.writeWithOwnerGuard(target, 'deactivated', (tx) =>
      tx.user.update({ where: { id: target.id }, data: { isActive: false, invitedAt: null }, select: staffSelect }), true);
  });

/** Deactivated or deleted back to active. A person deleted before they accepted an invite goes back to invited. */
export const reactivateStaff = (actor: Requester, id: number) =>
  transition(actor, id, 'You cannot reactivate yourself', (target, status) => {
    if (status === 'active') throw new AppError('This person is already active', 409, 'ALREADY_ACTIVE');
    if (status === 'invited') throw new AppError('This person has not accepted the invite yet', 409, 'STAFF_INVITED');
    // Deactivating clears invitedAt, so a deleted row that still has it never accepted.
    const neverAccepted = status === 'deleted' && target.invitedAt !== null;
    return prisma.user.update({ where: { id: target.id }, data: { isActive: !neverAccepted, deletedAt: null }, select: staffSelect });
  });

/** Soft delete: the person leaves the table (Deleted tab), cannot sign in, and can be restored. History keeps their name. */
export const deleteStaff = (actor: Requester, id: number) =>
  transition(actor, id, 'You cannot delete yourself', (target, status) => {
    if (status === 'deleted') throw new AppError('This person is already deleted', 409, 'ALREADY_DELETED');
    // The invite link dies with the delete.
    return adminService.writeWithOwnerGuard(target, 'deleted', (tx) =>
      tx.user.update({ where: { id: target.id }, data: { isActive: false, deletedAt: new Date(), inviteTokenHash: null }, select: staffSelect }), true);
  });

/**
 * Erase a user for good. Their orders, deliveries and expenses stay with no owner, their notifications go. The last Owner
 * cannot be erased. A user with records that must keep them (payouts, ledger entries) cannot be erased: 409 HAS_RECORDS and
 * nothing changes. The one place that erases a user; `adminService.permanentlyDeleteUser` calls it too.
 */
export async function eraseUser(target: { id: number; role: UserRole }): Promise<void> {
  const tenantId = resolveTenantId();
  const { id } = target;
  try {
    // The un-extended client: the extension would turn a delete into a soft delete. Every write names the tenant.
    await prismaBase.$transaction(async (tx) => {
      await assertNotLastOwner(tx, target, 'erased');
      await tx.order.updateMany({ where: { tenantId, customerRepId: id }, data: { customerRepId: null } });
      await tx.order.updateMany({ where: { tenantId, deliveryAgentId: id }, data: { deliveryAgentId: null } });
      await tx.order.updateMany({ where: { tenantId, createdById: id }, data: { createdById: null } });
      await tx.order.updateMany({ where: { tenantId, confirmedById: id }, data: { confirmedById: null } });
      await tx.delivery.updateMany({ where: { tenantId, agentId: id }, data: { agentId: null } });
      await tx.expense.updateMany({ where: { tenantId, recordedBy: id }, data: { recordedBy: null } });
      await tx.notification.deleteMany({ where: { tenantId, userId: id } });
      await tx.user.deleteMany({ where: { tenantId, id } });
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      throw new AppError('This person has payouts or ledger records and cannot be erased. They stay in the Deleted tab.', 409, 'HAS_RECORDS');
    }
    throw error;
  }
}

/** Permanent delete from the Deleted tab (Owner only; the route checks). `confirm` is the person's email, typed. */
export async function permanentlyDeleteStaff(id: number, confirm: string): Promise<void> {
  const target = await findStaff(id);
  if (staffStatus(target) !== 'deleted') throw new AppError('Delete the person first. Permanent delete works from the Deleted tab.', 409, 'NOT_DELETED');
  if (confirm.toLowerCase() !== target.email.toLowerCase()) throw new AppError("Type the person's email to confirm", 400, 'CONFIRM_MISMATCH');
  await eraseUser(target);
}

/** Open orders per active person (F-1165): orders as call rep plus orders as delivery partner, busiest first. */
export async function staffWorkload() {
  const open = { tenantId: resolveTenantId(), deletedAt: null, status: { notIn: CLOSED_ORDER_STATUSES } };
  const [people, asRep, asAgent] = await Promise.all([
    prisma.user.findMany({
      where: { ...STAFF_KINDS, isActive: true },
      select: { id: true, firstName: true, lastName: true, kind: true, role: true },
    }),
    prisma.order.groupBy({ by: ['customerRepId'], where: { ...open, customerRepId: { not: null } }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ['deliveryAgentId'], where: { ...open, deliveryAgentId: { not: null } }, _count: { _all: true } }),
  ]);
  const rep = new Map(asRep.map((r) => [r.customerRepId, r._count._all]));
  const agent = new Map(asAgent.map((r) => [r.deliveryAgentId, r._count._all]));
  const workload = people.map((p) => {
    const repOrders = rep.get(p.id) ?? 0;
    const agentOrders = agent.get(p.id) ?? 0;
    return { id: p.id, name: fullName(p), kind: p.kind, role: p.role, openOrders: repOrders + agentOrders, asRep: repOrders, asAgent: agentOrders };
  });
  return workload.sort((a, b) => b.openOrders - a.openOrders || a.name.localeCompare(b.name));
}
