import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { getTenantId, runInTenant } from '../utils/tenantContext';
import { isPositionRole } from '../config/defaultRoles';
import { gridOfRole, hasOwnGrid, grants } from '../config/roleToolRules';
import { PermissionGrid, defaultRolePermissions, mergeRolePermissions, unionPermissions } from '../config/defaultRolePermissions';

/**
 * What a user may do, per tenant (M6-T04, F-1154, F-1155). Two caches, both per tenant so one tenant's change never drops
 * another's: the tenant matrix (one grid per base role) and the union of the roles a user holds. Both live a minute and are
 * dropped at once by `clearPermissionsCache` when a role, an assignment or a grid changes (see accessService).
 */

type Matrix = Record<string, PermissionGrid>;

const CACHE_TTL = 60_000;
const MAX_TENANTS = 100;
const MAX_USERS_PER_TENANT = 2000;
const GLOBAL = '__global__';

/** The matrix per tenant. The promise is cached, so concurrent requests of a tenant share one read. */
const matrixCache = new Map<string, { promise: Promise<Matrix>; timestamp: number }>();
/** The union of each user's held role grids per tenant; `null` = the user holds no role that gives a grid. */
const heldCache = new Map<string, Map<number, { grid: PermissionGrid | null; timestamp: number }>>();
/** Reads in flight per (epoch, tenant, user, kind): concurrent misses share one read, as `matrixCache` does for the matrix. */
const inflight = new Map<string, Promise<unknown>>();
/**
 * Bumped by every `clearPermissionsCache`. A read that started before a clear may finish after it; it carries the epoch it
 * started in and stores nothing if the epoch moved, so old data never lands in the cache after an invalidation.
 */
let epoch = 0;

/** O(1) eviction of the oldest entry when a map is full (insertion order). */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (!map.has(key) && map.size >= max) map.delete(map.keys().next().value as K);
  map.set(key, value);
}

async function loadMatrix(tenantId: string | null): Promise<Matrix> {
  // A failed read throws. It must not fall back to the defaults: a default grid is a real-looking answer (a role the tenant
  // narrowed would get its old cells back, a role they widened would be refused with a 403). The caller answers 500, the failed
  // promise is not cached (getTenantMatrix), and the next request reads again.
  // The tenant's own row only (SystemConfig.tenantId is unique). No tenant reads the tenantId-null row.
  const [config, mapped] = await Promise.all([
    prisma.systemConfig.findFirst({ where: { tenantId } }),
    // The grid of the position role mapped from a UserRole is the one store; the saved matrix and the defaults only fill a role
    // that has no grid yet. So a user with no role of their own (an AI agent, the system user) follows the same grid as the people with one.
    tenantId ? prisma.role.findMany({ where: { presetRole: { not: null } }, select: { name: true, presetRole: true, permissions: true } }) : [],
  ]);
  const matrix: Matrix = config?.rolePermissions ? mergeRolePermissions(config.rolePermissions) : defaultRolePermissions();
  if (tenantId) {
    for (const r of mapped) {
      if (r.presetRole && isPositionRole(r) && hasOwnGrid(r)) matrix[r.presetRole] = r.permissions as PermissionGrid;
    }
  }
  return matrix;
}

/** The tenant's matrix per base role: saved matrix over the defaults, position-role grids over both. `null` = no tenant (platform). */
export function getTenantMatrix(tenantId: string | null): Promise<Matrix> {
  const key = tenantId ?? GLOBAL;
  const cached = matrixCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.promise;
  const promise = (tenantId ? runInTenant(tenantId, () => loadMatrix(tenantId)) : loadMatrix(null)).catch((error) => {
    if (matrixCache.get(key)?.promise === promise) matrixCache.delete(key); // a failed read is not cached; a newer read stays
    throw error;
  });
  setBounded(matrixCache, key, { promise, timestamp: Date.now() }, MAX_TENANTS);
  return promise;
}

/** The role's permissions as the checks see them. */
export async function getEffectivePermissions(role: UserRole | string): Promise<Record<string, string[]>> {
  return (await getTenantMatrix(getTenantId() ?? null))[role] ?? {};
}

const heldOf = (tenantId: string) => {
  let users = heldCache.get(tenantId);
  if (!users) { users = new Map(); setBounded(heldCache, tenantId, users, MAX_TENANTS); }
  return users;
};

const freshHeld = (tenantId: string, userId: number) => {
  const entry = heldCache.get(tenantId)?.get(userId);
  return entry && Date.now() - entry.timestamp < CACHE_TTL ? entry : undefined;
};

const heldAssignmentSelect = { role: { select: { permissions: true, presetRole: true } } } as const;
type HeldAssignment = { role: { permissions: unknown; presetRole: UserRole | null } };

/** The union of the grids of the held roles, by the one rule (gridOfRole); null when none gives a grid (the Legacy role gives none). */
function unionOf(assignments: HeldAssignment[], matrix: Matrix): PermissionGrid | null {
  const grids = assignments.filter(({ role }) => hasOwnGrid(role) || role.presetRole).map(({ role }) => gridOfRole(role, matrix));
  return grids.length ? unionPermissions(grids) : null;
}

const cacheHeld = (tenantId: string, userId: number, grid: PermissionGrid | null, startedIn: number) => {
  if (startedIn !== epoch) return; // the cache was cleared while this read ran: its data may be old
  setBounded(heldOf(tenantId), userId, { grid, timestamp: Date.now() }, MAX_USERS_PER_TENANT);
};

/** One read per key at a time. The epoch is in the key, so a read that started before a clear is never shared with a later caller. */
function once<T>(kind: string, tenantId: string, userId: number, read: () => Promise<T>): Promise<T> {
  const key = `${epoch}|${kind}|${tenantId}|${userId}`;
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = read().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/**
 * `authenticate`: is the user still active (not deactivated, not soft-deleted)? The default user filter hides an inactive row, so
 * no row means no. The answer is never cached (another process cannot see this process's cache clear, so a cached "active" would
 * outlive a deactivation there): every call reads. With a fresh held-grid entry the read is a bare id check; on a miss the same
 * read brings the held roles, which fill the grid cache the checks use next. Concurrent calls for one user share the read while it
 * runs. Call inside the tenant context.
 */
export async function isUserActive(tenantId: string, userId: number): Promise<boolean> {
  return once('active', tenantId, userId, async () => {
    if (freshHeld(tenantId, userId)) {
      return (await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } })) !== null;
    }
    const startedIn = epoch;
    const [user, matrix] = await Promise.all([
      prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { roleAssignments: { where: { toDate: null }, select: heldAssignmentSelect } } }),
      getTenantMatrix(tenantId),
    ]);
    if (!user) return false;
    cacheHeld(tenantId, userId, unionOf(user.roleAssignments, matrix), startedIn);
    return true;
  });
}

async function heldGrid(tenantId: string, userId: number): Promise<PermissionGrid | null> {
  const cached = freshHeld(tenantId, userId);
  if (cached) return cached.grid;
  return once('grid', tenantId, userId, async () => {
    const startedIn = epoch;
    const [assignments, matrix] = await Promise.all([
      prisma.roleAssignment.findMany({ where: { holderId: userId, toDate: null }, select: heldAssignmentSelect }),
      getTenantMatrix(tenantId),
    ]);
    const grid = unionOf(assignments, matrix);
    cacheHeld(tenantId, userId, grid, startedIn);
    return grid;
  });
}

/**
 * What a user may do (F-1155): the union of the grids of the roles they hold. A user with no such role (an AI agent on a key,
 * the system user, a caller that passes only a base role) gets the matrix of their base role, as before.
 */
export async function getUserPermissions(user: { id?: number; role: UserRole | string }): Promise<Record<string, string[]>> {
  const tenantId = getTenantId();
  if (tenantId && user.id !== undefined) {
    const grid = await heldGrid(tenantId, user.id);
    if (grid) return grid;
  }
  return getEffectivePermissions(user.role);
}

/** Permission check used by the middleware and the services: super_admin always passes. */
export async function hasPermission(user: { id?: number; role: UserRole | string }, resource: string, action: string): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  return grants(await getUserPermissions(user), resource, action);
}

/**
 * Drop one user's cached grids (the user was deactivated, deleted or erased), in the current tenant; with no tenant, from every
 * tenant. The epoch moves too, so a read that is already running stores nothing after this. This process only: the active check
 * itself is never cached, so it does not depend on this.
 */
export function forgetUser(userId: number, tenantId: string | null | undefined = getTenantId()): void {
  epoch++;
  if (tenantId) { heldCache.get(tenantId)?.delete(userId); return; }
  for (const users of heldCache.values()) users.delete(userId);
}

/**
 * Drop the cached permissions of one tenant (default: the current one). Without a tenant (a test, a platform path) every
 * tenant's cache goes.
 */
export function clearPermissionsCache(tenantId: string | null | undefined = getTenantId()): void {
  epoch++;
  if (!tenantId) {
    matrixCache.clear();
    heldCache.clear();
    return;
  }
  matrixCache.delete(tenantId);
  heldCache.delete(tenantId);
}
