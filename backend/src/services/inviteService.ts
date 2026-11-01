import { UserRole } from '@prisma/client';
import bcrypt from 'bcrypt';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenantOf, withoutTenant } from '../utils/tenantContext';
import { fullName, splitName } from '../utils/nameUtils';
import { Requester, assertMayManage } from '../utils/authUtils';
import { INVITE_TTL_DAYS, hashInviteToken, isInviteExpired, newInviteToken } from '../utils/inviteToken';
import { appUrl } from '../utils/appUrl';
import { isRecordNotFound } from '../utils/prismaErrors';
import { AppError } from '../middleware/errorHandler';
import { adminService } from './adminService';
import { auditService } from './auditService';
import { sendInviteEmail } from './emailService';
import { smsService } from './smsService';
import { whatsappService } from './whatsappService';
import { assertMayTouchRole, findRole } from './roleService';
import { StaffRow, findStaff, payMethodNotAllowed, payPolicyFor, staffSelect, staffStatus, staffView } from './staffService';
import { VEHICLE_TYPES, normalizeVehicleType } from './deliveryPartnerAdminService';
import type { RequestMeta } from './sessionService';
import type { InviteChannel, inviteStaffSchema } from '../validators/staffSchema';
import type { z } from 'zod';

/**
 * M6-T06 (F-1158): invite a person, resend, revoke, accept. Call inside the tenant context, except `acceptInvite` (public:
 * it finds the tenant from the token). Only the SHA-256 hash of the token is stored. The raw token is in the link alone, and
 * the message log never sees it. A password is never part of an invite.
 */

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

/** The amount per confirmed and delivered order when none is given (F-1158). */
const DEFAULT_PER_ORDER_AMOUNT = 8;

const INVALID_INVITE = 'This invite link is not valid or was already used. Ask for a new invite.';
const EXPIRED_INVITE = 'This invite link has expired. Ask for a new invite.';
const REDACTED = '[invite link]';
const CHANNEL_LABEL: Record<InviteChannel, string> = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

export interface InviteDelivery {
  channel: InviteChannel;
  sent: boolean;
  /** Why it was not sent (provider not set up, or the provider refused). The owner copies the link instead. */
  reason?: string;
}

type Invitee = Pick<StaffRow, 'firstName' | 'email' | 'phoneNumber'>;

/**
 * Send the link by the chosen channel. Never throws: a provider that is not set up or fails gives `sent: false`, and the
 * invite stays valid so the owner can hand over the link. SMS and WhatsApp logs get the text without the link.
 */
async function deliver(channel: InviteChannel, person: Invitee, inviter: string, link: string): Promise<InviteDelivery> {
  try {
    if (channel === 'email') {
      await sendInviteEmail(person.email, person.firstName, inviter, link);
      return { channel, sent: true };
    }
    const text = (url: string) => `Hi ${person.firstName}, ${inviter} invited you to join their team. Set your password here (works once, ${INVITE_TTL_DAYS} days): ${url}`;
    const message = { to: person.phoneNumber!, body: text(link), logBody: text(REDACTED) };
    const result = channel === 'sms' ? await smsService.sendSms(message) : await whatsappService.sendText(message);
    return result.providerMessageId ? { channel, sent: true } : { channel, sent: false, reason: `${CHANNEL_LABEL[channel]} is not set up` };
  } catch (error) {
    logger.warn('Invite link not delivered', { channel, error: error instanceof Error ? error.message : String(error) });
    return { channel, sent: false, reason: error instanceof Error ? error.message : 'Send failed' };
  }
}

const requirePhone = (channel: InviteChannel, phone: string | null | undefined) => {
  if (channel !== 'email' && !phone) throw new AppError('A phone number is needed to send the invite by SMS or WhatsApp', 400, 'PHONE_REQUIRED');
};

const inviterName = async (actor: Requester) => {
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
  return me ? fullName(me) : 'Your team';
};

/** The tail of invite and resend: build the link, send it, answer. `link` is in this answer only. */
async function sendLink(inviter: Promise<string>, person: StaffRow, token: { raw: string; expiresAt: Date }, channel: InviteChannel) {
  const link = appUrl(`/accept-invite?token=${token.raw}`);
  const delivery = await deliver(channel, person, await inviter, link);
  return { staff: staffView(person), link, expiresAt: token.expiresAt, delivery };
}

/**
 * Invite a person. The user is made inactive with the invite date (status Invited), holds the chosen role from today, and the
 * link goes out. The response carries `link` once, so the owner can copy it when the channel is not set up.
 */
export async function inviteStaff(actor: Requester, input: InviteStaffInput) {
  requirePhone(input.channel, input.phoneNumber);
  const inviter = inviterName(actor);

  // The role: a role of the tenant (its preset is the base role, `manager` for a custom role as in assignToRole), or a UserRole.
  let base: UserRole;
  if (input.roleId !== undefined) {
    const role = await findRole(input.roleId);
    assertMayTouchRole(actor, role);
    base = role.presetRole ?? 'manager';
  } else {
    base = input.role!;
  }

  const policy = payPolicyFor(base);
  const payMethod = input.payMethod ?? policy.defaultMethod;
  if (!(policy.methods as readonly string[]).includes(payMethod)) throw payMethodNotAllowed();
  const vehicleType = input.vehicleType ? normalizeVehicleType(input.vehicleType) : undefined;
  if (input.vehicleType && !vehicleType) {
    throw new AppError(`Vehicle type must be one of: ${VEHICLE_TYPES.join(', ')}`, 400, 'INVALID_VEHICLE_TYPE');
  }

  // createUser checks the rank (the actor must outrank the base role; an admin cannot invite an Owner-level role) and the email.
  // The controller writes the one audit row (staff_invite).
  const { inviteToken, inviteExpiresAt, ...person } = await adminService.createUser(actor, {
    email: input.email,
    ...splitName(input.name),
    phoneNumber: input.phoneNumber || undefined,
    role: base,
    roleId: input.roleId,
    commissionAmount: payMethod === 'per_order' ? (input.amount ?? DEFAULT_PER_ORDER_AMOUNT) : 0,
    vehicleType: vehicleType ?? undefined,
    vehicleId: input.vehicleId || undefined,
    location: input.city || undefined,
    preferences: { payMethod },
    access: 'invite',
    select: staffSelect,
    skipAudit: true,
  }) as unknown as StaffRow & { inviteToken: string; inviteExpiresAt: Date };

  return sendLink(inviter, person, { raw: inviteToken, expiresAt: inviteExpiresAt }, input.channel);
}

/** A person who is still Invited, and the actor may manage; else 404 / 403 / 409 NOT_INVITED. */
async function findInvited(actor: Requester, id: number) {
  const target = await findStaff(id);
  assertMayManage(actor, target);
  if (staffStatus(target) !== 'invited') throw new AppError('This person is not waiting on an invite', 409, 'NOT_INVITED');
  return target;
}

/** A new token and a new 7 days. The old link stops working at once. */
export async function resendInvite(actor: Requester, id: number, channel: InviteChannel) {
  const inviter = inviterName(actor);
  const target = await findInvited(actor, id);
  requirePhone(channel, target.phoneNumber);
  const token = newInviteToken();
  const person = await prisma.user.update({
    where: { id }, data: { inviteTokenHash: token.hash, inviteExpiresAt: token.expiresAt }, select: staffSelect,
  });
  return sendLink(inviter, person, token, channel);
}

/**
 * The link stops working. The person is soft-deleted (Deleted tab): they never had a login, so "deactivated" would put a
 * never-accepted person among people who left. Restoring from the Deleted tab brings them back as Invited (T05), and the
 * owner sends a new invite.
 */
export async function revokeInvite(actor: Requester, id: number) {
  await findInvited(actor, id);
  const row = await prisma.user.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
    select: staffSelect,
  });
  return staffView(row);
}

/** The filter of a person who can still accept: Invited (inactive, not deleted, invite date set) with this token. */
const stillInvited = (tokenHash: string) =>
  ({ inviteTokenHash: tokenHash, isActive: false, deletedAt: null, invitedAt: { not: null }, kind: 'person' as const });

/** The person behind a token, or 400 (unknown or used, one message) or 410 (expired). Reads only. */
async function findInvite(tokenHash: string) {
  const invited = await withoutTenant('auth-accept-invite', () => prisma.user.findFirst({
    where: stillInvited(tokenHash),
    select: { id: true, tenantId: true, inviteExpiresAt: true },
  }));
  if (!invited) throw new AppError(INVALID_INVITE, 400, 'INVITE_INVALID');
  if (isInviteExpired(invited.inviteExpiresAt)) throw new AppError(EXPIRED_INVITE, 410, 'INVITE_EXPIRED');
  return invited;
}

/** Public. Is the link still good? The accept page asks when it opens, so a dead link says so before a password is typed. Writes nothing. */
export async function checkInvite(token: string): Promise<void> {
  await findInvite(hashInviteToken(token));
}

/**
 * Public. Spend the token: the person chooses a password and becomes active. One use: the claim is one conditional update on
 * a person who is still Invited (inactive, not deleted, invite date set), so two requests with the same token cannot both
 * win, and a person deactivated or deleted since the invite cannot accept. Unknown or used token: 400 (one message).
 * Expired: 410. Returns the user for the caller to sign in.
 */
export async function acceptInvite(token: string, password: string, meta: RequestMeta) {
  const tokenHash = hashInviteToken(token);
  const invited = await findInvite(tokenHash);

  const hashed = await bcrypt.hash(password, 10);

  return runInTenantOf(invited.tenantId, 'auth-accept-invite', async () => {
    let user;
    try {
      user = await prisma.user.update({
        where: stillInvited(tokenHash),
        data: { password: hashed, isActive: true, inviteTokenHash: null, inviteExpiresAt: null, invitedAt: null, refreshToken: null },
      });
    } catch (error) {
      if (isRecordNotFound(error)) throw new AppError(INVALID_INVITE, 400, 'INVITE_INVALID');
      throw error;
    }
    await auditService.record({
      action: 'staff_invite_accept', resource: 'user', resourceId: String(user.id),
      actorId: user.id, actorKind: 'person', channel: 'app', ipAddress: meta.ip, userAgent: meta.userAgent,
    }).catch((error) => logger.error('Failed to write audit row', { action: 'staff_invite_accept', error }));
    return user;
  });
}
