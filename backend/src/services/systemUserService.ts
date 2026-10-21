import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId, withoutTenant } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { SYSTEM_EMAIL_DOMAIN, isReservedSystemEmail } from '../utils/systemEmail';
import logger from '../utils/logger';

export { SYSTEM_EMAIL_DOMAIN, isReservedSystemEmail };

/**
 * M2-T03: each tenant has one system user (kind = system). Background jobs and
 * integration actors with no person use it as the actor on GL entries. It has no
 * usable password (not a bcrypt hash), login refuses it, and staff lists hide it.
 */
export const SYSTEM_USER_PASSWORD = '!';

/** Filter for staff lists and recipient queries: only people; the system user and AI agents are not staff. */
export const HUMAN_USERS_WHERE = { kind: 'person' } satisfies Prisma.UserWhereInput;

/** Create an ai_agent user (the actor behind an MCP key) with no usable password. `tx` is a client or a transaction. */
export function createAiAgentUser(
  tx: Prisma.TransactionClient,
  { tenantId, name, email }: { tenantId: string; name: string; email: string },
): Promise<{ id: number }> {
  return tx.user.create({
    data: {
      email,
      password: SYSTEM_USER_PASSWORD,
      firstName: name,
      lastName: 'AI agent',
      // The base role is the ceiling and 'admin' holds every cell the 14 tools need (the same role as the system user);
      // the key's role tool list is what narrows it. Never super_admin: that role passes every permission check.
      role: 'admin',
      kind: 'ai_agent',
      tenantId,
    },
    select: { id: true },
  });
}

const systemUserEmail = (tenantId: string) => `system+${tenantId}@${SYSTEM_EMAIL_DOMAIN}`;

const systemUserIds = new Map<string, number>();

/** Forget the cached ids. Tests that delete or recreate system users call this. */
export function clearSystemUserIdCache(): void {
  systemUserIds.clear();
}

/** The tenant's system user id, creating the user if it is missing. `created` is true only if this call made it. */
export async function ensureSystemUser(tenantId: string): Promise<{ id: number; created: boolean }> {
  // A deactivated system user still counts, so the soft-delete filter must not hide it.
  const find = () => withoutTenant('system-user-ensure', () => withSoftDeleted(() =>
    prisma.user.findFirst({ where: { tenantId, kind: 'system' }, select: { id: true } })));
  const existing = await find();
  if (existing) return { id: existing.id, created: false };
  try {
    const user = await withoutTenant('system-user-ensure', () => prisma.user.create({
      data: {
        email: systemUserEmail(tenantId),
        password: SYSTEM_USER_PASSWORD,
        firstName: 'System',
        lastName: 'User',
        role: 'admin',
        kind: 'system',
        tenantId,
      },
      select: { id: true },
    }));
    return { id: user.id, created: true };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    // a concurrent call made it first (email is unique)
    const raced = await find();
    if (raced) return { id: raced.id, created: false };
    // The re-find missed, so another user holds the reserved email. Name the conflict; never continue silently.
    const email = systemUserEmail(tenantId);
    const holder = await withoutTenant('system-user-ensure', () => withSoftDeleted(() =>
      prisma.user.findFirst({ where: { email }, select: { id: true, kind: true } })));
    const message = `system user email for tenant ${tenantId} is held by user id ${holder?.id ?? 'unknown'} (kind ${holder?.kind ?? 'unknown'})`;
    logger.error(message, { tenantId, holderId: holder?.id, holderKind: holder?.kind });
    throw new Error(message);
  }
}

/** The tenant's system user id (default: the current tenant). Creates the user if an old tenant has none yet. */
export async function getSystemUserId(tenantId?: string | null): Promise<number> {
  const id = resolveTenantId(tenantId);
  const cached = systemUserIds.get(id);
  if (cached !== undefined) return cached;
  const { id: userId } = await ensureSystemUser(id);
  systemUserIds.set(id, userId);
  return userId;
}

/** The actor for every order write a workflow makes: the tenant's system user (M2-T16). Resolve it once per action. */
export async function systemActor(): Promise<{ kind: 'system'; userId: number }> {
  return { kind: 'system', userId: await getSystemUserId() };
}
