import { Prisma, UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId } from '../utils/tenantContext';

/**
 * M6-T13 (F-513): the assignment cursor, a smooth weighted round robin (nginx style).
 *
 * One source of truth: the `AssignmentCursor` row. Each pick runs in a transaction that locks the row
 * (SELECT ... FOR UPDATE), advances the state and writes it back. The row lock serializes parallel picks and
 * the state survives a restart. The plan row says "Redis cursor with database fallback"; that was changed on
 * review: a Redis copy next to the row needed reconciling (a reset on a list change sets position 0, so a stale
 * copy could win), and a few assignments a minute do not need a cache. Redis is not used and its outage cannot
 * affect a pick.
 */

export interface CursorCandidate {
  id: number;
  /** Positive integer share. */
  weight: number;
}

interface CursorState {
  /** The rotation and weights this state was built for; a different rotation starts a new cycle. */
  sig: string;
  /** SWRR running value per user id. */
  current: Record<string, number>;
}

/**
 * Smooth weighted round robin: every candidate gains its weight, the highest wins (the first on a tie, so the
 * order is deterministic), and the winner loses the total. Mutates `current`. Over one cycle of `sum(weights)`
 * picks each candidate wins exactly its weight. `candidates` must not be empty.
 */
export function swrrPick(current: Record<string, number>, candidates: CursorCandidate[]): number {
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  let best = candidates[0];
  for (const c of candidates) {
    current[c.id] = (current[c.id] ?? 0) + c.weight;
    if (current[c.id] > current[best.id]) best = c;
  }
  current[best.id] -= total;
  return best.id;
}

const signature = (candidates: CursorCandidate[]) =>
  [...candidates].sort((a, b) => a.id - b.id).map((c) => `${c.id}:${c.weight}`).join(',');

/**
 * The next user id for `(tenant, scope, role)`. `rotation` is the whole list (a change in it resets the cursor,
 * with one log line); `available` is the part of it that may take an order now (the rest is skipped, the cursor
 * is kept). `available` must not be empty.
 */
export async function pickWithCursor(scope: string, role: UserRole, rotation: CursorCandidate[], available: CursorCandidate[]): Promise<number> {
  const tenantId = resolveTenantId();
  const where = { tenantId_scope_role: { tenantId, scope, role } };
  return prisma.$transaction(async (tx) => {
    await tx.assignmentCursor.upsert({ where, create: { tenantId, scope, role }, update: {} });
    const [row] = await tx.$queryRaw<{ position: number; state: CursorState | null }[]>`
      SELECT position, state FROM assignment_cursors
      WHERE tenant_id = ${tenantId} AND scope = ${scope} AND role = ${role}::"UserRole" FOR UPDATE`;
    const sig = signature(rotation);
    const kept = row.state?.sig === sig ? row.state : null;
    if (row.state && !kept) logger.info('Assignment cursor reset: the candidate list changed', { tenantId, scope, role });
    const state = kept ?? { sig, current: {} };
    const id = swrrPick(state.current, available);
    await tx.assignmentCursor.update({
      where,
      data: { position: kept ? row.position + 1 : 1, state: state as unknown as Prisma.InputJsonValue },
    });
    return id;
  });
}
