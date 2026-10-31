import { newHashedToken, sha256Hex } from './crypto';

/** M6-T06 (F-1158): the invite token. Only its SHA-256 hash is stored; the raw token lives in the link alone. */

export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const hashInviteToken = sha256Hex;

/** A new token that stops working 7 days from `now`. */
export const newInviteToken = (now: Date = new Date()) => newHashedToken(INVITE_TTL_DAYS * DAY_MS, now);

/** True from the expiry moment on. A missing date counts as expired: an invite always has one. */
export const isInviteExpired = (expiresAt: Date | null, now: Date = new Date()): boolean =>
  expiresAt === null || expiresAt.getTime() <= now.getTime();
