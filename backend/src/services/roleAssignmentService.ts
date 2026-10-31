import { randomBytes } from 'crypto';
import { UserRole } from '@prisma/client';
import prisma, { prismaBase, TransactionClient } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { resolveTenantId } from '../utils/tenantContext';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { Requester, canManageRole, isOwner } from '../utils/authUtils';
import { splitName } from '../utils/nameUtils';
import { AppError } from '../middleware/errorHandler';
import { isOwnerRole } from '../config/defaultRoles';
import { adminService } from './adminService';
import { createKeyIn, evictKeys, revokeKeysIn } from './mcpKeyService';
import { announceRelease, releasePersonTargets } from './targetService';
import { assertMayTouchRole, assignmentSelect, findRole, holderSelect, holderStatus, holderView } from './roleService';
import type { AssignInput } from '../validators/roleSchema';

/**
 * M6-T03 (F-1152, F-1156): who holds a role. Three ways to add a holder (a person, an AI agent with an MCP key limited to the
 * role, a company), plus an existing user, and the end of an assignment. The invite token, the link and accept-invite are T06:
 * a person is made through `adminService.createUser` with `access: 'invite'`, for T06 to extend.
 */

/** The UserRole a new holder gets as base role: the role's own preset, else `manager` (as the Marketing role does). */
const baseRoleOf = (role: { presetRole: UserRole | null }): UserRole => role.presetRole ?? 'manager';

/**
 * The one rank rule of this file: the actor must outrank (or be the Owner over) the base role of the role, and the holder's
 * own UserRole when the holder already exists. So an admin cannot hand out, or take away, a role at or above their own.
 */
function assertOutranks(actor: Requester, base: UserRole, holderRole?: UserRole): void {
  for (const target of holderRole ? [base, holderRole] : [base]) {
    if (!canManageRole(actor.role, target)) throw new AppError(`Access denied: Cannot manage a user with ${target} role.`, 403);
  }
}

const assertNotHolding = async (db: Pick<TransactionClient, 'roleAssignment'>, roleId: number, holderId: number) => {
  if ((await db.roleAssignment.count({ where: { roleId, holderId, toDate: null } })) > 0) {
    throw new AppError('This holder already has this role', 409, 'ALREADY_HOLDER');
  }
};

/**
 * Add a holder to a role. `input.type`:
 * - existing: a user of the tenant gets the role; no new account (not an AI agent: that needs a key, use ai_agent).
 * - person: an invited person (no password, inactive until they accept).
 * - ai_agent: Owner only. An ai_agent user (made, or `userId` reused), the assignment, and an MCP key whose tools are the
 *   role's tools. The raw key is in the result once. An AI agent never holds the Owner role.
 * - company: a company user with no login.
 */
export async function assignToRole(actor: Requester, roleId: number, input: AssignInput) {
  const tenantId = resolveTenantId();
  const role = await findRole(roleId);
  const base = baseRoleOf(role);
  const fromDate = startOfUtcDay();

  if (input.type === 'ai_agent') {
    if (!isOwner(actor)) throw new AppError('Only the Owner can connect an AI agent', 403);
    if (isOwnerRole(role)) throw new AppError('An AI agent cannot hold the Owner role', 400, 'AGENT_NOT_OWNER');
    if (input.userId !== undefined) await assertNotHolding(prisma, roleId, input.userId);
    // One un-extended transaction, so the agent, the key and the assignment commit together (every write names the tenant).
    const { created, assignment } = await prismaBase.$transaction(async (tx) => {
      const created = await createKeyIn(tx, { tenantId, label: input.name, roleId, userId: input.userId, expiresInDays: input.expiresInDays }, role);
      const assignment = await tx.roleAssignment.create({ data: { tenantId, roleId, holderId: created.agent.id, fromDate }, select: assignmentSelect });
      return { created, assignment };
    });
    const { key } = created;
    return {
      assignment,
      holder: holderView(created.agent),
      // The raw key is shown once; only its hash is stored.
      apiKey: { id: key.id, key: created.rawKey, keyPrefix: key.keyPrefix, label: key.label, expiresAt: key.expiresAt, toolCount: created.toolCount, roleId },
    };
  }

  assertMayTouchRole(actor, role);

  if (input.type === 'existing') {
    const found = await withSoftDeleted(() => prisma.user.findFirst({ where: { id: input.holderId }, select: { ...holderSelect, role: true } }));
    if (!found) throw new AppError('User not found', 404);
    if (found.kind === 'system') throw new AppError('The system user cannot hold a role', 400);
    if (found.kind === 'ai_agent') throw new AppError('Connect an AI agent to give it a role', 400);
    if (holderStatus(found) === 'deactivated') throw new AppError('A deactivated user cannot be given a role', 400);
    assertOutranks(actor, base, found.role);
    await assertNotHolding(prisma, roleId, found.id);
    const assignment = await prisma.roleAssignment.create({ data: { tenantId, roleId, holderId: found.id, fromDate }, select: assignmentSelect });
    return { assignment, holder: holderView(found) };
  }

  assertOutranks(actor, base);
  const person = input.type === 'person';
  const user = await adminService.createUser(actor, {
    email: input.email ?? `company+${randomBytes(8).toString('hex')}@company.codadmin.internal`,
    // A company keeps the name whole in firstName, as other company users do.
    ...(person ? splitName(input.name) : { firstName: input.name, lastName: 'Company' }),
    phoneNumber: input.phoneNumber || undefined,
    role: base,
    kind: person ? 'person' : 'company',
    access: person ? 'invite' : 'none',
    roleId,
  });
  const { roleAssignments, ...holder } = user;
  return { assignment: roleAssignments[0], holder: holderView(holder) };
}

/**
 * End an assignment today. The row stays (history); the person leaves the role card. The last holder of the Owner role cannot
 * go. An AI agent also loses its active keys for this role, so it stops acting under a role it no longer holds.
 */
export async function unassign(actor: Requester, roleId: number, assignmentId: number) {
  const tenantId = resolveTenantId();
  const [role, current] = await Promise.all([
    findRole(roleId),
    prisma.roleAssignment.findFirst({ where: { id: assignmentId, roleId }, include: { holder: { select: { role: true } } } }),
  ]);
  assertMayTouchRole(actor, role);
  if (!current) throw new AppError('Assignment not found', 404);
  if (current.toDate !== null) throw new AppError('This assignment has already ended', 409, 'ALREADY_ENDED');
  assertOutranks(actor, baseRoleOf(role), current.holder.role);

  const { assignment, keys, released } = await prismaBase.$transaction(async (tx) => {
    // Lock the role's active assignments first, so two unassigns at once take turns and the count below is true. The check
    // before the transaction is only the fast path; this one counts.
    const live = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM role_assignments WHERE tenant_id = ${tenantId} AND role_id = ${roleId} AND to_date IS NULL ORDER BY id FOR UPDATE`;
    if (!live.some((a) => a.id === current.id)) throw new AppError('This assignment has already ended', 409, 'ALREADY_ENDED');
    if (isOwnerRole(role) && live.length <= 1) throw new AppError('The Owner role needs at least one holder', 409, 'LAST_OWNER');
    return {
      assignment: await tx.roleAssignment.update({ where: { id: current.id }, data: { toDate: startOfUtcDay() }, select: assignmentSelect }),
      keys: await revokeKeysIn(tx, { tenantId, userId: current.holderId, roleId }),
      // M6-T07: the person's open targets go back to the role pool in the same transaction.
      released: await releasePersonTargets(tx, { tenantId, roleId, roleName: role.name, userId: current.holderId }),
    };
  });
  evictKeys(keys);
  if (released) await announceRelease(actor.id, released);
  return { assignment, revokedKeys: keys.length, targetReturned: released && { notice: released.notice, returned: released.returned } };
}
