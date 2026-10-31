import crypto from 'crypto';

/** M6-T06 (F-1158): the invite token. Only its SHA-256 hash is stored; the raw token lives in the link alone. */

export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashInviteToken = (raw: string): string => crypto.createHash('sha256').update(raw).digest('hex');

/** A new token: 32 random bytes as hex, its hash, and the date it stops working (7 days from `now`). */
export function newInviteToken(now: Date = new Date()): { raw: string; hash: string; expiresAt: Date } {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: hashInviteToken(raw), expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS) };
}

/** True from the expiry moment on. A missing date counts as expired: an invite always has one. */
export const isInviteExpired = (expiresAt: Date | null, now: Date = new Date()): boolean =>
  expiresAt === null || expiresAt.getTime() <= now.getTime();
