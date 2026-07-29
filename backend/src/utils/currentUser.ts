import { Prisma } from '@prisma/client';
import { prismaBase } from './prisma';

/**
 * Identity carve-out for the authenticated user's OWN row.
 *
 * Owners are null-tenant once multi-store is live, so the extended client would
 * inject the active-store tenant into these queries (User is tenant-scoped) and
 * either miss the owner (reads return nothing) or silently no-op (writes match
 * zero rows). Both go through prismaBase (unscoped) with an explicit id
 * predicate, so identity resolves the same for owners and staff.
 */
export async function getCurrentUser(userId: number, select?: Prisma.UserSelect) {
  return prismaBase.user.findFirst({ where: { id: userId, isActive: true }, select });
}

export async function updateCurrentUser(userId: number, data: Prisma.UserUpdateInput) {
  return prismaBase.user.update({ where: { id: userId }, data });
}
