import { randomUUID } from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { redis } from '../middleware/cache.middleware';
import { resolveTenantId } from '../utils/tenantContext';

/**
 * M6-T13 (F-513): the assignment cursor, a smooth weighted round robin (nginx style) kept in Redis with
 * `AssignmentCursor` as the database fallback.
 *
 * Concurrency: a pick runs under a short Redis lock on the cursor key (SET NX PX, released only by its owner),
 * so two parallel picks never read the same state. When Redis is down the pick runs in a database transaction
 * that holds a row lock (SELECT ... FOR UPDATE) instead.
 *
 * Read policy: both copies are read and the one with the higher position wins.
 *
 * Write policy: the DB copy is written on EVERY pick. Assignments are a few per minute, so one small upsert is
 * cheap, and a throttled write could lose picks after a Redis loss and break the split. The DB path also deletes
 * the Redis key when it can.
 */

export interface CursorCandidate {
  id: number;
  /** Positive integer share. */
  weight: number;
}

interface CursorState {
  /** The candidate list and weights this state was built for; a different list resets the cursor. */
  sig: string;
  /** SWRR running value per user id. */
  current: Record<string, number>;
}

interface StoredCursor {
  position: number;
  state: CursorState;
}

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_MS = 6000;
const LOCK_RETRY_MS = 20;
const RELEASE_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Smooth weighted round robin: every candidate gains its weight, the highest wins (the first on a tie, so the
 * order is deterministic), and the winner loses the total. Mutates `current`. Over one cycle of `sum(weights)`
 * picks each candidate wins exactly its weight.
 */
export function swrrPick(current: Record<string, number>, candidates: CursorCandidate[]): number | null {
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let best: CursorCandidate | null = null;
  for (const c of candidates) {
    current[c.id] = (current[c.id] ?? 0) + c.weight;
    if (!best || current[c.id] > current[best.id]) best = c;
  }
  current[best!.id] -= total;
  return best!.id;
}

const signature = (candidates: CursorCandidate[]) =>
  [...candidates].sort((a, b) => a.id - b.id).map((c) => `${c.id}:${c.weight}`).join(',');

export const cursorRedisKey = (tenantId: string, scope: string, role: UserRole) => `assignment-cursor:${tenantId}:${role}:${scope}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Advance the stored state by one pick. A changed candidate list starts a new cycle, with one log line. */
function advance(stored: StoredCursor | null, all: CursorCandidate[], available: CursorCandidate[], where: object) {
  const sig = signature(all);
  let state = stored?.state;
  if (state && state.sig !== sig) {
    logger.info('Assignment cursor reset: the candidate list changed', where);
    state = undefined;
  }
  const next: StoredCursor = { position: state ? stored!.position : 0, state: state ?? { sig, current: {} } };
  const id = swrrPick(next.state.current, available);
  next.position += 1;
  return { id, next };
}

const toStored = (row: { position: number; state: Prisma.JsonValue } | null): StoredCursor | null => {
  const state = row?.state as unknown as CursorState | null | undefined;
  return row && state?.sig !== undefined ? { position: row.position, state } : null;
};

async function pickViaRedis(tenantId: string, scope: string, role: UserRole, all: CursorCandidate[], available: CursorCandidate[]) {
  const key = cursorRedisKey(tenantId, scope, role);
  const lockKey = `${key}:lock`;
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  while ((await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new Error('Assignment cursor lock timeout');
    await sleep(LOCK_RETRY_MS);
  }
  try {
    // The copy with the higher position is the newer one: after a Redis outage the DB copy can be ahead of a stale key.
    const raw = await redis.get(key);
    const fromRedis: StoredCursor | null = raw ? JSON.parse(raw) : null;
    const fromDb = toStored(await prisma.assignmentCursor.findUnique({ where: { tenantId_scope_role: { tenantId, scope, role } } }));
    const stored = fromRedis && (!fromDb || fromRedis.position >= fromDb.position) ? fromRedis : fromDb;
    const { id, next } = advance(stored, all, available, { tenantId, scope, role });
    await redis.set(key, JSON.stringify(next));
    try {
      const state = next.state as unknown as Prisma.InputJsonValue;
      await prisma.assignmentCursor.upsert({
        where: { tenantId_scope_role: { tenantId, scope, role } },
        create: { tenantId, scope, role, position: next.position, state },
        update: { position: next.position, state },
      });
    } catch (error) {
      // Redis holds the truth right now; a missed DB copy only matters if Redis is lost before the next pick.
      logger.warn('Assignment cursor DB write failed', { tenantId, scope, role, error: (error as Error).message });
    }
    return id;
  } finally {
    await redis.eval(RELEASE_LUA, 1, lockKey, token).catch(() => undefined);
  }
}

async function pickViaDb(tenantId: string, scope: string, role: UserRole, all: CursorCandidate[], available: CursorCandidate[]) {
  const where = { tenantId_scope_role: { tenantId, scope, role } };
  const id = await prisma.$transaction(async (tx) => {
    await tx.assignmentCursor.upsert({ where, create: { tenantId, scope, role }, update: {} });
    await tx.$queryRaw`SELECT id FROM assignment_cursors WHERE tenant_id = ${tenantId} AND scope = ${scope} AND role = ${role}::"UserRole" FOR UPDATE`;
    const { id: picked, next } = advance(toStored(await tx.assignmentCursor.findUnique({ where })), all, available, { tenantId, scope, role });
    await tx.assignmentCursor.update({ where, data: { position: next.position, state: next.state as unknown as Prisma.InputJsonValue } });
    return picked;
  });
  // The DB copy is now newer than anything Redis holds: drop the Redis copy so it reloads from the DB.
  await redis.del(cursorRedisKey(tenantId, scope, role)).catch(() => undefined);
  return id;
}

/**
 * The next user id for `(tenant, scope, role)`. `all` is the whole candidate list (a change in it resets the
 * cursor); `available` is the part that may take an order now (the rest is skipped). Null when `available` is empty.
 */
export async function pickWithCursor(scope: string, role: UserRole, all: CursorCandidate[], available: CursorCandidate[]): Promise<number | null> {
  if (available.length === 0) return null;
  const tenantId = resolveTenantId();
  try {
    return await pickViaRedis(tenantId, scope, role, all, available);
  } catch (error) {
    logger.warn('Assignment cursor: Redis unavailable, using the database', { tenantId, scope, role, error: (error as Error).message });
    return pickViaDb(tenantId, scope, role, all, available);
  }
}
