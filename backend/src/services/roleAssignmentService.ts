import { randomBytes } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import prisma, { prismaBase, TransactionClient } from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { resolveTenantId } from '../utils/tenantContext';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { canManageRole } from '../utils/authUtils';
import { AppError } from '../middleware/errorHandler';
import { isOwnerRole } from '../config/defaultRoles';
import { evictKey } from '../mcp/auth';
import { createKeyIn } from './mcpKeyService';
import { SYSTEM_USER_PASSWORD } from './systemUserService';
import { RoleActor, assertMayTouchRole, holderView } from './roleService';
import type { AssignInput } from '../validators/roleSchema';

/**
 * M6-T03 (F-1152, F-1156): who holds a role. Three ways to add a holder (a person, an AI agent with an MCP key limited to the
 * role, a company), plus an existing user, and the end of an assignment. The invite token, the link and accept-invite are T06:
 * `createInvitedPerson` is the part of an invite that makes the user, for T06 to extend.
 */

const EMAIL_TAKEN = 'A user with this email already exists';

const isEmailTaken = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && String(e.meta?.target ?? '').includes('email');

/** The UserRole a new holder gets as base role: the role's own preset, else `manager` (as the Marketing role does). */
const baseRoleOf = (role: { presetRole: UserRole | null }): UserRole => role.presetRole ?? 'manager';

const roleOfTenant = async (roleId: number) => {
  const role = await prisma.role.findFirst({ where: { id: roleId }, select: { id: true, name: true, presetRole: true, tools: true } });
  if (!role) throw new AppError('Role not found', 404);
  return role;
};

const assignmentOut = (a: { id: number; roleId: number; holderId: number; fromDate: Date; toDate: Date | null }) => ({
  id: a.id, roleId: a.roleId, holderId: a.holderId, fromDate: a.fromDate, toDate: a.toDate,
});

const holderSelect = { id: true, firstName: true, lastName: true, email: true, kind: true, isActive: true, invitedAt: true, password: true } as const;

/** Person: the user record of an invited person. No password they could use, inactive until they accept (T06), kind person. */
export async function createInvitedPerson(
  tx: TransactionClient,
  p: { tenantId: string; name: string; email: string; phoneNumber?: string; role: UserRole },
) {
  const taken = await withSoftDeleted(() => tx.user.count({ where: { email: { equals: p.email, mode: 'insensitive' } } }));
  if (taken > 0) throw new AppError(EMAIL_TAKEN, 409, 'EMAIL_TAKEN');
  const [firstName, ...rest] = p.name.split(/\s+/);
  return tx.user.create({
    data: {
      tenantId: p.tenantId, email: p.email, password: SYSTEM_USER_PASSWORD, firstName, lastName: rest.join(' ') || firstName,
      phoneNumber: p.phoneNumber || undefined, role: p.role, kind: 'person', isActive: false, invitedAt: new Date(),
    },
    select: holderSelect,
  });
}

/** Company: a user of kind company with no login (no usable password, never kind person). */
async function createCompany(tx: TransactionClient, p: { tenantId: string; name: string; email?: string; phoneNumber?: string; role: UserRole }) {
  const email = p.email ?? `company+${randomBytes(8).toString('hex')}@company.codadmin.internal`;
  const taken = await withSoftDeleted(() => tx.user.count({ where: { email: { equals: email, mode: 'insensitive' } } }));
  if (taken > 0) throw new AppError(EMAIL_TAKEN, 409, 'EMAIL_TAKEN');
  return tx.user.create({
    data: {
      tenantId: p.tenantId, email, password: SYSTEM_USER_PASSWORD, firstName: p.name, lastName: 'Company',
      phoneNumber: p.phoneNumber || undefined, role: p.role, kind: 'company',
    },
    select: holderSelect,
  });
}

const assertNotHolding = async (db: { roleAssignment: { count(args: { where: Prisma.RoleAssignmentWhereInput }): Promise<number> } }, roleId: number, holderId: number) => {
  if ((await db.roleAssignment.count({ where: { roleId, holderId, toDate: null } })) > 0) {
    throw new AppError('This holder already has this role', 409, 'ALREADY_HOLDER');
  }
};

/**
 * Add a holder to a role. `input.type`:
 * - existing: a user of the tenant gets the role; no new account (not an AI agent: that needs a key, use ai_agent).
 * - person: an invited person (see createInvitedPerson).
 * - ai_agent: an ai_agent user (made, or `userId` reused), the assignment, and an MCP key whose tools are the role's tools.
 *   The raw key is in the result once. An AI agent never holds the Owner role.
 * - company: a company user with no login.
 */
export async function assignToRole(actor: RoleActor, roleId: number, input: AssignInput) {
  const tenantId = resolveTenantId();
  const role = await roleOfTenant(roleId);
  if (input.type === 'ai_agent' && isOwnerRole(role)) throw new AppError('An AI agent cannot hold the Owner role', 400, 'AGENT_NOT_OWNER');
  assertMayTouchRole(actor, role);
  const fromDate = startOfUtcDay();
  const mayCreate = (base: UserRole) => {
    if (!canManageRole(actor.role, base)) throw new AppError(`Access denied: Cannot create a user with ${base} role.`, 403);
  };

  try {
    if (input.type === 'ai_agent') {
      // One un-extended transaction, so the agent, the key and the assignment commit together (every write names the tenant).
      const result = await prismaBase.$transaction(async (tx) => {
        const created = await createKeyIn(tx, { tenantId, label: input.name, roleId, userId: input.userId, expiresInDays: input.expiresInDays });
        if (input.userId !== undefined) await assertNotHolding(tx, roleId, created.key.userId!);
        const assignment = await tx.roleAssignment.create({ data: { tenantId, roleId, holderId: created.key.userId!, fromDate } });
        const holder = await tx.user.findUniqueOrThrow({ where: { id: created.key.userId! }, select: holderSelect });
        return { ...created, assignment, holder };
      });
      const { key, rawKey, toolCount } = result;
      return {
        assignment: assignmentOut(result.assignment),
        holder: holderView(result.holder),
        // The raw key is shown once; only its hash is stored.
        apiKey: { id: key.id, key: rawKey, keyPrefix: key.keyPrefix, label: key.label, expiresAt: key.expiresAt, toolCount, roleId },
      };
    }

    const { assignment, holder } = await prisma.$transaction(async (tx) => {
      let holder: Prisma.UserGetPayload<{ select: typeof holderSelect }>;
      if (input.type === 'existing') {
        const found = await withSoftDeleted(() => tx.user.findFirst({ where: { id: input.holderId }, select: holderSelect }));
        if (!found) throw new AppError('User not found', 404);
        if (found.kind === 'system') throw new AppError('The system user cannot hold a role', 400);
        if (found.kind === 'ai_agent') throw new AppError('Connect an AI agent to give it a role', 400);
        await assertNotHolding(tx, roleId, found.id);
        holder = found;
      } else if (input.type === 'person') {
        mayCreate(baseRoleOf(role));
        holder = await createInvitedPerson(tx, { tenantId, name: input.name, email: input.email, phoneNumber: input.phoneNumber, role: baseRoleOf(role) });
      } else {
        mayCreate(baseRoleOf(role));
        holder = await createCompany(tx, { tenantId, name: input.name, email: input.email, phoneNumber: input.phoneNumber, role: baseRoleOf(role) });
      }
      const assignment = await tx.roleAssignment.create({ data: { tenantId, roleId, holderId: holder.id, fromDate } });
      return { assignment, holder };
    });
    return { assignment: assignmentOut(assignment), holder: holderView(holder) };
  } catch (e) {
    // The email is unique across all tenants: a clash with another tenant's user lands here.
    if (isEmailTaken(e)) throw new AppError(EMAIL_TAKEN, 409, 'EMAIL_TAKEN');
    throw e;
  }
}

/**
 * End an assignment today. The row stays (history); the person leaves the role card. An AI agent also loses its active keys
 * for this role, so it stops acting under a role it no longer holds.
 */
export async function unassign(actor: RoleActor, roleId: number, assignmentId: number) {
  const tenantId = resolveTenantId();
  const role = await roleOfTenant(roleId);
  assertMayTouchRole(actor, role);
  const current = await prisma.roleAssignment.findFirst({ where: { id: assignmentId, roleId } });
  if (!current) throw new AppError('Assignment not found', 404);
  if (current.toDate !== null) throw new AppError('This assignment has already ended', 409, 'ALREADY_ENDED');

  const { ended, keys } = await prismaBase.$transaction(async (tx) => {
    const ended = await tx.roleAssignment.update({ where: { id: current.id }, data: { toDate: startOfUtcDay() } });
    const keys = await tx.mcpApiKey.findMany({ where: { tenantId, userId: current.holderId, roleId, revokedAt: null }, select: { id: true, keyHash: true } });
    if (keys.length) await tx.mcpApiKey.updateMany({ where: { id: { in: keys.map((k) => k.id) } }, data: { revokedAt: new Date() } });
    return { ended, keys };
  });
  keys.forEach((k) => evictKey(k.keyHash));
  return { assignment: assignmentOut(ended), revokedKeys: keys.length };
}
