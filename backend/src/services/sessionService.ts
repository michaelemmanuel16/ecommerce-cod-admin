import crypto from 'crypto';
import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { generateAccessToken, generateRefreshToken } from '../utils/jwt';
import { deviceLabel } from '../utils/deviceLabel';
import { AppError } from '../middleware/errorHandler';
import { runInTenantOf } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { getUserPermissions } from './permissionService';
import type { User } from '@prisma/client';

/**
 * Signed-in sessions (M3-T23, F-1224). One UserSession per login, holding the SHA-256 hash of the
 * current refresh token. Every refresh rotates the token inside its own session.
 *
 * A user without a tenant (platform admin) cannot own a session row (tenantId is required), so that
 * user keeps the old single `User.refreshToken` flow. The column stays for now: a user who only has
 * the old value still refreshes once, and that refresh moves them onto a session.
 */

export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

export interface SessionUser {
  id: number;
  email: string;
  role: any;
  tenantId?: string | null;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export const requestMeta = (req: { ip?: string; get?(name: string): string | undefined }): RequestMeta => ({
  ip: req.ip ?? null,
  userAgent: req.get?.('user-agent') ?? null,
});

const claims = (user: SessionUser) => ({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId ?? null });

export const sessionService = {
  /**
   * Sign a verified user in (login and accept-invite share it): start the session, stamp the last login and read the role
   * permissions together. Returns what the login answer carries; the controller sends it.
   */
  async signIn(user: User, meta: RequestMeta) {
    return runInTenantOf(user.tenantId, 'auth-login', async () => {
      const startSession = async () => {
        if (user.tenantId) {
          // One session per login (M3-T23)
          const { accessToken, refreshToken } = await sessionService.start({ ...user, tenantId: user.tenantId }, meta);
          await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
          return { accessToken, refreshToken };
        }
        // A user without a tenant cannot own a session row: old single-token flow
        const tokenClaims = { id: user.id, email: user.email, role: user.role, tenantId: null };
        const accessToken = generateAccessToken(tokenClaims);
        const refreshToken = generateRefreshToken(tokenClaims);
        await prisma.user.update({ where: { id: user.id }, data: { refreshToken, lastLogin: new Date() } });
        return { accessToken, refreshToken };
      };
      // The union of the roles the user holds: the same function as GET /api/auth/me (M6-T04)
      const tokens = await startSession();
      const permissions = await getUserPermissions({ id: user.id, role: user.role });
      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isPlatformAdmin: user.isPlatformAdmin || false,
          commissionAmount: Money.orZero(user.commissionAmount),
          preferences: user.preferences,
        },
        tokens,
        permissions,
      };
    });
  },

  /**
   * Start a session for a user of a tenant. Call inside that tenant's context. Returns both tokens;
   * the access token carries the session id (`sid`).
   */
  async start(user: SessionUser & { tenantId: string }, meta: RequestMeta) {
    const refreshToken = generateRefreshToken(claims(user));
    const session = await prisma.userSession.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        deviceLabel: deviceLabel(meta.userAgent),
        ip: meta.ip ?? null,
      },
    });
    const accessToken = generateAccessToken({ ...claims(user), sid: session.id });
    return { session, accessToken, refreshToken };
  },

  /**
   * Swap the session's token for a new one. The update only matches while the session still holds the
   * token that was presented, so two calls with the same old token cannot both win.
   */
  async rotate(session: { id: number; tokenHash: string }, user: SessionUser, meta: RequestMeta) {
    const refreshToken = generateRefreshToken(claims(user));
    const { count } = await prisma.userSession.updateMany({
      where: { id: session.id, tokenHash: session.tokenHash },
      data: {
        tokenHash: hashToken(refreshToken),
        lastSeenAt: new Date(),
        ...(meta.ip && { ip: meta.ip }),
      },
    });
    if (count === 0) throw new AppError('Invalid refresh token', 401);
    const accessToken = generateAccessToken({ ...claims(user), sid: session.id });
    return { accessToken, refreshToken };
  },

  async list(userId: number, currentSessionId?: number) {
    const rows = await prisma.userSession.findMany({
      where: { userId },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      select: { id: true, deviceLabel: true, ip: true, lastSeenAt: true, createdAt: true },
    });
    return rows.map((s) => ({ ...s, current: s.id === currentSessionId }));
  },

  /** Ends one of the user's own sessions. Returns false when it is not theirs (or does not exist). */
  async revoke(userId: number, sessionId: number): Promise<boolean> {
    const { count } = await prisma.userSession.deleteMany({ where: { id: sessionId, userId } });
    return count > 0;
  },

  /**
   * Ends every session of the user except the given one. The caller has a session, so the old
   * User.refreshToken value (a pre-session device) is never theirs: it goes too.
   */
  async revokeOthers(userId: number, keepSessionId: number): Promise<number> {
    const [{ count }] = await prisma.$transaction([
      prisma.userSession.deleteMany({ where: { userId, id: { not: keepSessionId } } }),
      prisma.user.updateMany({ where: { id: userId }, data: { refreshToken: null } }),
    ]);
    return count;
  },

  /** Ends all sessions and clears the old column. Used on deactivate and on password reset. */
  async revokeAll(userId: number): Promise<void> {
    await prisma.userSession.deleteMany({ where: { userId } });
    // the user may already be deactivated, so skip the soft-delete filter
    await withSoftDeleted(() => prisma.user.updateMany({ where: { id: userId }, data: { refreshToken: null } }));
  },
};
