import { UserRole } from '@prisma/client';
import { generateAccessToken, generateRefreshToken } from './jwt';
import { prismaBase } from './prisma';
import { pageOnCall } from './alerting';
import { AppError } from '../middleware/errorHandler';

/** Minimal user shape needed to mint a token. */
export interface MintableUser {
  id: number;
  email: string;
  role: UserRole;
  tenantId?: string | null;
}

/**
 * Resolve the "active store" for a token mint:
 *   explicit target (store switch / refresh preserving current store) wins,
 *   else the user's own tenantId (staff — behavior unchanged),
 *   else their default StoreMembership (owners, whose User.tenantId is nulled
 *   once the multi-store path is live).
 * Returns null only when NONE resolves. Read through prismaBase (StoreMembership
 * is not tenant-scoped, but the auth/identity layer stays off the ambient scope
 * on principle). Callers MUST fail closed on null — see resolveOrThrow.
 */
export async function resolveActiveTenantId(
  user: MintableUser,
  explicitTenantId?: string | null,
): Promise<string | null> {
  if (explicitTenantId) return explicitTenantId;
  if (user.tenantId) return user.tenantId;
  const def = await prismaBase.storeMembership.findFirst({
    where: { userId: user.id, isDefault: true },
    select: { tenantId: true },
  });
  return def?.tenantId ?? null;
}

async function resolveOrThrow(user: MintableUser, explicitTenantId?: string | null): Promise<string> {
  const tenantId = await resolveActiveTenantId(user, explicitTenantId);
  if (!tenantId) {
    // The fail-open crux: a null-tenant token makes auth.ts:162 run the request
    // UNSCOPED (the Prisma extension injects no filter on null context). Refuse
    // to mint and PAGE on-call (MAN-91) — this tripwire must reach a human, not
    // just sit in the error log.
    await pageOnCall('auth.null_tenant_context', {
      userId: user.id,
      email: user.email,
      detail: 'mintTokens could not resolve an active store; refused to mint a null-tenant token',
    });
    throw new AppError('No active store resolved', 403, 'TENANT_UNRESOLVED');
  }
  return tenantId;
}

/**
 * Single fail-closed access+refresh mint surface. Replaces the scattered
 * `tenantId: user.tenantId ?? null` sign calls (register/login/onboarding) so
 * there is ONE audited place a null-tenant token could ever be minted — and it
 * never is.
 */
export async function mintTokens(
  user: MintableUser,
  explicitTenantId?: string | null,
): Promise<{ accessToken: string; refreshToken: string; tenantId: string }> {
  const tenantId = await resolveOrThrow(user, explicitTenantId);
  const payload = { id: user.id, email: user.email, role: user.role, tenantId };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
    tenantId,
  };
}

/**
 * Access-token-only mint (refresh path — no refresh-token rotation). Same
 * fail-closed resolution; pass the current token's active store as
 * explicitTenantId so a refresh keeps the user on the same store.
 */
export async function mintAccessToken(
  user: MintableUser,
  explicitTenantId?: string | null,
): Promise<{ accessToken: string; tenantId: string }> {
  const tenantId = await resolveOrThrow(user, explicitTenantId);
  const payload = { id: user.id, email: user.email, role: user.role, tenantId };
  return { accessToken: generateAccessToken(payload), tenantId };
}
