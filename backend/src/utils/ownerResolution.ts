import type { Prisma } from '@prisma/client';

/**
 * Canonical, deterministic tenant-owner selection (MSL-8 / MAN-85).
 *
 * Multi-store makes each Tenant carry a single denormalized owner
 * (`Tenant.ownerUserId`). When a tenant has more than one `super_admin`
 * (co-founder setups), owner selection MUST be deterministic and identical
 * everywhere it runs — the backfill migration (MAN-86), runtime owner
 * resolution (platformService, notificationService), and any re-run.
 *
 * The rule: among candidate `super_admin` users, pick the one with the
 * EARLIEST `createdAt`, breaking ties by the LOWEST `id`. `id` is a
 * monotonic autoincrement, so the ordering is total and stable across re-runs.
 *
 * Two equivalent forms — keep them in sync:
 *   - Prisma runtime:  `orderBy: OWNER_TIEBREAK_ORDER_BY`, take the first row.
 *   - SQL (migration): `ORDER BY created_at ASC, id ASC LIMIT 1`.
 */

/** Prisma orderBy encoding the canonical rule: createdAt asc, then id asc. */
export const OWNER_TIEBREAK_ORDER_BY: Prisma.UserOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * Equivalent SQL ordering for raw / migration use.
 * Keep in sync with OWNER_TIEBREAK_ORDER_BY.
 */
export const OWNER_TIEBREAK_SQL_ORDER = 'ORDER BY created_at ASC, id ASC';

type OwnerCandidate = { id: number; createdAt: Date };

/**
 * Deterministically pick the single owner from an in-memory candidate list,
 * per the canonical rule (earliest createdAt, then lowest id). Returns null
 * when the list is empty.
 *
 * Callers must pre-filter to eligible candidates (role = super_admin, active).
 * Pure and order-independent, so it is safe to reuse in tests and one-off scripts.
 */
export function pickDeterministicOwner<T extends OwnerCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, cur) => {
    const curTime = cur.createdAt.getTime();
    const bestTime = best.createdAt.getTime();
    if (curTime < bestTime) return cur;
    if (curTime === bestTime && cur.id < best.id) return cur;
    return best;
  });
}
