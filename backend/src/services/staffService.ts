import { Prisma, UserRole, OrderStatus } from '@prisma/client';
import prisma, { prismaBase } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { resolveTenantId } from '../utils/tenantContext';
import { fullName } from '../utils/nameUtils';
import { Requester, canManageRole } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { adminService } from './adminService';
import { sessionService } from './sessionService';
import { assertNotLastOwner } from './systemRoleService';
import { SYSTEM_USER_PASSWORD } from './systemUserService';
import type { z } from 'zod';
import type { staffQuerySchema, updateStaffSchema } from '../validators/staffSchema';

/**
 * M6-T05 (F-1157, F-1159 to F-1162, F-1165): the team table. Staff are the people and companies of the tenant (the system
 * user and AI agents are not staff). Call inside the tenant context. The invite and accept-invite flow is M6-T06.
 *
 * Status of a person:
 * - active: `isActive`.
 * - invited: not active, has an invite date (the T03 rule, `holderStatus`).
 * - deleted: not active, soft-deleted. The User table has no deleted column, so the delete date is `preferences.deletedAt`.
 * - deactivated: any other inactive person.
 */

export type StaffStatus = 'active' | 'invited' | 'deactivated' | 'deleted';

export type StaffQuery = z.infer<typeof staffQuerySchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

const STAFF_KINDS = ['person', 'company'] as const;

/** Orders in these statuses are done; every other order is open work for its rep or partner. */
const CLOSED_ORDER_STATUSES: OrderStatus[] = ['delivered', 'digital_delivered', 'cancelled', 'returned'];

const staffSelect = {
  id: true, firstName: true, lastName: true, email: true, phoneNumber: true, kind: true, role: true, isActive: true,
  invitedAt: true, lastLogin: true, createdAt: true, commissionAmount: true, vehicleType: true, vehicleId: true, preferences: true, password: true,
  roleAssignments: { where: { toDate: null }, select: { role: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

type StaffRow = Prisma.UserGetPayload<{ select: typeof staffSelect }>;

const deletedAtOf = (preferences: Prisma.JsonValue | null): string | null => {
  const value = preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? preferences.deletedAt : null;
  return typeof value === 'string' ? value : null;
};

export function staffStatus(u: { isActive: boolean; invitedAt: Date | null; preferences: Prisma.JsonValue | null }): StaffStatus {
  if (u.isActive) return 'active';
  if (deletedAtOf(u.preferences) !== null) return 'deleted';
  return u.invitedAt !== null ? 'invited' : 'deactivated';
}

/** A delivery partner's fee is a fee rule (M5), not a field of the person (F-1161). */
const feeRuleOf = (u: { id: number; role: UserRole }) =>
  u.role === 'delivery_agent' ? { editable: false, url: `/api/delivery-partners/${u.id}/fee-rules` } : null;

const staffView = ({ password: _password, roleAssignments, preferences, commissionAmount, ...u }: StaffRow) => ({
  ...u,
  name: fullName(u),
  status: staffStatus({ ...u, preferences }),
  deletedAt: deletedAtOf(preferences),
  commissionAmount: commissionAmount?.toString() ?? null,
  positions: roleAssignments.map((a) => a.role),
  feeRule: feeRuleOf(u),
});

export type StaffView = ReturnType<typeof staffView>;

const loadRow = (id: number) =>
  withSoftDeleted(() => prisma.user.findFirst({ where: { id, kind: { in: [...STAFF_KINDS] } }, select: staffSelect }));

/** A person of the tenant (any status), or 404. */
async function findStaff(id: number): Promise<StaffRow> {
  const row = await loadRow(id);
  if (!row) throw new AppError('Staff member not found', 404);
  return row;
}

const present = async (id: number) => staffView(await findStaff(id));

/** The actor may not act on themselves, and must outrank the person (the Owner outranks everyone). */
function assertMayManage(actor: Requester, target: StaffRow, selfMessage: string): void {
  if (actor.id === target.id) throw new AppError(selfMessage, 403);
  if (!canManageRole(actor.role, target.role)) throw new AppError('Access denied: Cannot manage a user with a higher role.', 403);
}

/**
 * GET /api/staff. The tab counts cover the role and search filters but not the status filter, so every tab shows its own
 * number. Without a status the list is everyone except the deleted.
 */
export async function listStaff(query: StaffQuery) {
  const role = query.role;
  const where: Prisma.UserWhereInput = {
    kind: { in: [...STAFF_KINDS] },
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
  const rows = await withSoftDeleted(() => prisma.user.findMany({ where, select: staffSelect, orderBy: [{ firstName: 'asc' }, { id: 'asc' }] }));
  const counts: Record<StaffStatus, number> = { active: 0, invited: 0, deactivated: 0, deleted: 0 };
  const staff = rows.map(staffView);
  for (const s of staff) counts[s.status]++;
  return { counts, staff: staff.filter((s) => (query.status ? s.status === query.status : s.status !== 'deleted')) };
}

/** Edit a person. The commission applies to deliveries made after the change; earlier commission entries are not touched. */
export async function updateStaff(actor: Requester, id: number, input: UpdateStaffInput) {
  const target = await findStaff(id);
  if (staffStatus(target) === 'deleted') throw new AppError('Restore this person before editing', 409, 'STAFF_DELETED');
  if ((input.role ?? target.role) === 'delivery_agent' && input.commissionAmount !== undefined) {
    throw new AppError('A delivery partner has no commission here. Their fee is set in the partner fee rule.', 400, 'FEE_NOT_EDITABLE');
  }
  await adminService.updateUser(actor, id, input);
  return present(id);
}

/** An admin sets a new password; every session of the person ends. A company, an invited or a deleted person has no login to reset. */
export async function resetStaffPassword(actor: Requester, id: number, password: string) {
  const target = await findStaff(id);
  assertMayManage(actor, target, 'Change your own password in your profile');
  const status = staffStatus(target);
  if (target.kind === 'company') throw new AppError('A company has no login', 400, 'NO_LOGIN');
  if (status === 'invited') throw new AppError('This person has not accepted the invite yet. They choose their own password.', 409, 'STAFF_INVITED');
  if (status === 'deleted') throw new AppError('Restore this person first', 409, 'STAFF_DELETED');
  await adminService.resetUserPassword(actor, id, password);
}

/** Active to deactivated. The person is signed out everywhere. */
export async function deactivateStaff(actor: Requester, id: number) {
  const target = await findStaff(id);
  assertMayManage(actor, target, 'You cannot deactivate yourself');
  const status = staffStatus(target);
  if (status === 'invited') throw new AppError('This person has not accepted the invite yet. Delete the invite instead.', 409, 'STAFF_INVITED');
  if (status !== 'active') throw new AppError(`This person is already ${status}`, 409, 'NOT_ACTIVE');
  await assertNotLastOwner(prisma, id);
  // invitedAt goes: an accepted invite must not read as "invited" once the person is inactive (the T03 status rule).
  await withSoftDeleted(() => prisma.user.update({ where: { id }, data: { isActive: false, invitedAt: null } }));
  await sessionService.revokeAll(id);
  return present(id);
}

/** Deactivated or deleted back to active. A person deleted before they accepted an invite goes back to invited. */
export async function reactivateStaff(actor: Requester, id: number) {
  const target = await findStaff(id);
  assertMayManage(actor, target, 'You cannot reactivate yourself');
  const status = staffStatus(target);
  if (status === 'active') throw new AppError('This person is already active', 409, 'ALREADY_ACTIVE');
  if (status === 'invited') throw new AppError('This person has not accepted the invite yet', 409, 'STAFF_INVITED');
  const neverAccepted = status === 'deleted' && target.invitedAt !== null && target.password === SYSTEM_USER_PASSWORD;
  const { deletedAt: _deletedAt, ...preferences } = (target.preferences as Record<string, unknown> | null) ?? {};
  await withSoftDeleted(() => prisma.user.update({
    where: { id },
    data: { isActive: !neverAccepted, preferences: preferences as Prisma.InputJsonObject },
  }));
  return present(id);
}

/** Soft delete: the person leaves the table (Deleted tab), cannot sign in, and can be restored. History keeps their name. */
export async function deleteStaff(actor: Requester, id: number) {
  const target = await findStaff(id);
  assertMayManage(actor, target, 'You cannot delete yourself');
  if (staffStatus(target) === 'deleted') throw new AppError('This person is already deleted', 409, 'ALREADY_DELETED');
  await assertNotLastOwner(prisma, id);
  const preferences = { ...((target.preferences as Record<string, unknown> | null) ?? {}), deletedAt: new Date().toISOString() };
  await withSoftDeleted(() => prisma.user.update({
    where: { id },
    // The invite link dies with the delete.
    data: { isActive: false, inviteTokenHash: null, preferences: preferences as Prisma.InputJsonObject },
  }));
  await sessionService.revokeAll(id);
  return present(id);
}

/**
 * Erase a soft-deleted person for good (Owner only; the controller checks the typed token). Their orders, deliveries and
 * expenses stay with no owner, their notifications go. A person with records that must keep a user (payouts, ledger entries)
 * cannot be erased: the answer is 409 and the person stays in the Deleted tab.
 */
export async function permanentlyDeleteStaff(id: number) {
  const target = await findStaff(id);
  if (staffStatus(target) !== 'deleted') throw new AppError('Delete the person first. Permanent delete works from the Deleted tab.', 409, 'NOT_DELETED');
  const tenantId = resolveTenantId();
  try {
    // The un-extended client: the extension would turn a delete into a soft delete. Every write names the tenant.
    await prismaBase.$transaction(async (tx) => {
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
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new AppError('This person has payouts or ledger records and cannot be erased. They stay in the Deleted tab.', 409, 'HAS_RECORDS');
    }
    throw error;
  }
}

/** Open orders per active person (F-1165): orders as call rep plus orders as delivery partner, busiest first. */
export async function staffWorkload() {
  const open = { tenantId: resolveTenantId(), deletedAt: null, status: { notIn: CLOSED_ORDER_STATUSES } };
  const [people, asRep, asAgent] = await Promise.all([
    prisma.user.findMany({
      where: { kind: { in: [...STAFF_KINDS] }, isActive: true },
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
