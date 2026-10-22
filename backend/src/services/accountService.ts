import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import prisma from '../utils/prisma';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { withoutTenant } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { normalizePhone } from '../utils/phone';
import { validatePassword } from '../utils/validators';
import { isR2Configured, uploadToR2 } from '../config/r2';
import { uploadDir } from '../config/multer';
import { auditService } from './auditService';
import { sendEmailChangedNotice } from './emailService';
import logger from '../utils/logger';

/**
 * Self-service account (M3-T22): profile, photo and change password for the signed-in user.
 * Everything here acts on the caller's own row only; the id always comes from the token.
 */

const PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  phoneNumber: true,
  photoUrl: true,
  role: true,
  createdAt: true,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Audit rows must not turn a finished change into an error for the user. */
async function auditSafe(userId: number, action: string, ctx: AuditContext, metadata?: Record<string, unknown>) {
  try {
    await auditService.record({
      actorId: userId,
      channel: 'app',
      action,
      resource: 'user',
      resourceId: String(userId),
      metadata,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  } catch (err: any) {
    logger.error(`[account] audit row failed for ${action}`, { error: err.message });
  }
}

/** Full name splits on the last space; a single word goes to the first name. */
function splitName(full: string): { firstName: string; lastName: string } {
  const idx = full.lastIndexOf(' ');
  return idx === -1 ? { firstName: full, lastName: '' } : { firstName: full.slice(0, idx).trim(), lastName: full.slice(idx + 1).trim() };
}

export const accountService = {
  async getProfile(userId: number) {
    return prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
  },

  /** Whitelist: name, displayName, email, phone (also accepted as phoneNumber). Any other field is ignored. */
  async updateProfile(userId: number, body: Record<string, unknown>, ctx: AuditContext = {}) {
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
    if (!current) throw new AppError('User not found', 404);

    const data: Record<string, string | null> = {};

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (!name) throw new AppError('Name is required', 400);
      if (name.length > 120) throw new AppError('Name must be 120 characters or fewer', 400);
      Object.assign(data, splitName(name));
    }

    if (body.displayName !== undefined) {
      const display = body.displayName === null ? '' : typeof body.displayName === 'string' ? body.displayName.trim() : null;
      if (display === null) throw new AppError('Display name must be text', 400);
      if (display.length > 60) throw new AppError('Display name must be 60 characters or fewer', 400);
      data.displayName = display || null;
    }

    const phoneInput = body.phone !== undefined ? body.phone : body.phoneNumber;
    if (phoneInput !== undefined) {
      if (phoneInput === null || phoneInput === '') {
        data.phoneNumber = null;
      } else {
        const phone = typeof phoneInput === 'string' ? normalizePhone(phoneInput) : null;
        if (!phone) throw new AppError('Enter a valid Ghana or Nigeria phone number', 400);
        data.phoneNumber = phone;
      }
    }

    let newEmail: string | null = null;
    if (body.email !== undefined) {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new AppError('Enter a valid email address', 400);
      if (email !== current.email.toLowerCase()) {
        // Email is unique across the whole system and deactivated users keep theirs.
        const taken = await withoutTenant('account-email-check', () =>
          withSoftDeleted(() => prisma.user.findUnique({ where: { email }, select: { id: true } }))
        );
        if (taken && taken.id !== userId) throw new AppError('This email is already in use', 400);
        data.email = email;
        newEmail = email;
      }
    }

    if (Object.keys(data).length === 0) throw new AppError('No valid fields to update', 400);

    let user;
    try {
      user = await prisma.user.update({ where: { id: userId }, data, select: PROFILE_SELECT });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new AppError('This email is already in use', 400);
      throw err;
    }

    await auditSafe(userId, 'update_profile', ctx, { fields: Object.keys(data) });

    // The email changes at once; the old address is told (plan default for F-1221).
    if (newEmail) {
      sendEmailChangedNotice(current.email, current.firstName, newEmail).catch((err) =>
        logger.warn('[account] email-change notice not sent', { error: err.message })
      );
    }

    return user;
  },

  /** Store the photo first, then point the user at it: a failed upload keeps the old photo. */
  async setPhoto(userId: number, tenantId: string | null | undefined, file: Express.Multer.File, ctx: AuditContext = {}) {
    if (!hasImageSignature(file.buffer, file.mimetype)) throw new AppError('File is not a valid image', 400);

    const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
    const key = `avatars/${tenantId || 'shared'}/user-${userId}-${Date.now()}${ext}`;

    let photoUrl: string;
    if (isR2Configured()) {
      photoUrl = await uploadToR2(file.buffer, key, file.mimetype);
    } else {
      // Local fallback (dev/CI), same as the product image upload.
      const filename = path.basename(key);
      await fs.promises.writeFile(path.join(uploadDir, filename), file.buffer);
      photoUrl = `/uploads/${filename}`;
    }

    const user = await prisma.user.update({ where: { id: userId }, data: { photoUrl }, select: PROFILE_SELECT });
    await auditSafe(userId, 'update_photo', ctx);
    return user;
  },

  async removePhoto(userId: number, ctx: AuditContext = {}) {
    const user = await prisma.user.update({ where: { id: userId }, data: { photoUrl: null }, select: PROFILE_SELECT });
    await auditSafe(userId, 'remove_photo', ctx);
    return user;
  },

  /**
   * Checks the current password, sets the new one, ends every other session. `currentSessionId` is the
   * caller's own session (from the access token); without it every session of the user ends.
   */
  async changePassword(
    userId: number,
    currentPassword: unknown,
    newPassword: unknown,
    currentSessionId: number | undefined,
    ctx: AuditContext = {}
  ) {
    if (typeof currentPassword !== 'string' || !currentPassword) throw new AppError('Current password is required', 400);
    if (typeof newPassword !== 'string' || !newPassword) throw new AppError('New password is required', 400);
    if (newPassword.length > 72) throw new AppError('Password must be 72 characters or fewer', 400);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
    if (!user) throw new AppError('User not found', 404);

    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw new AppError('Current password is incorrect', 400);
    }

    const rules = validatePassword(newPassword);
    if (!rules.valid) throw new AppError(rules.errors.join('. '), 400);

    if (newPassword === currentPassword) throw new AppError('New password must be different from the current one', 400);

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { password: hashed, ...(currentSessionId === undefined && { refreshToken: null }) },
      }),
      prisma.userSession.deleteMany({
        where: { userId, ...(currentSessionId !== undefined && { id: { not: currentSessionId } }) },
      }),
    ]);

    await auditSafe(userId, 'change_password', ctx);
  },
};

/** The first bytes of the file must match the type the client claimed. */
function hasImageSignature(buf: Buffer, mimetype: string): boolean {
  if (!buf || buf.length < 12) return false;
  if (mimetype === 'image/png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimetype === 'image/webp') return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}
