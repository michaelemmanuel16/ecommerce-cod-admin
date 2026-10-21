import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId, withoutTenant } from '../utils/tenantContext';
import { withSoftDeleted } from '../utils/prismaExtensions';

/**
 * M2-T03: each tenant has one system user (kind = system). Background jobs and
 * integration actors with no person use it as the actor on GL entries. It has no
 * usable password (not a bcrypt hash), login refuses it, and staff lists hide it.
 */
export const SYSTEM_USER_PASSWORD = '!';

/** Filter for staff lists and recipient queries: the per-tenant system user is not a person. */
export const HUMAN_USERS_WHERE = { kind: { not: 'system' } } satisfies Prisma.UserWhereInput;

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
        email: `system+${tenantId}@system.codadmin.internal`,
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
    if (!raced) throw error;
    return { id: raced.id, created: false };
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
