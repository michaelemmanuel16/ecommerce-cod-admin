import bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId, runInTenantOf, withoutTenant } from '../utils/tenantContext';
import { fullName, splitName } from '../utils/nameUtils';
import { Requester, assertMayManage } from '../utils/authUtils';
import { hashInviteToken, isInviteExpired, newInviteToken } from '../utils/inviteToken';
import { AppError } from '../middleware/errorHandler';
import { adminService } from './adminService';
import { sendInviteEmail } from './emailService';
import { smsService } from './smsService';
import { whatsappService } from './whatsappService';
import { assertMayTouchRole, findRole } from './roleService';
import { findStaff, staffSelect, staffStatus, staffView } from './staffService';
import { VEHICLE_TYPES, normalizeVehicleType } from './deliveryPartnerAdminService';
import type { InviteChannel, inviteStaffSchema } from '../validators/staffSchema';
import type { z } from 'zod';

/**
 * M6-T06 (F-1158): invite a person, resend, revoke, accept. Call inside the tenant context, except `acceptInvite` (public:
 * it finds the tenant from the token). Only the SHA-256 hash of the token is stored. The raw token is in the link alone, and
 * the link is wiped from the message log once sent. A password is never part of an invite.
 */

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

/** The amount per confirmed and delivered order when none is given (F-1158). */
const DEFAULT_PER_ORDER_AMOUNT = 8;

const INVALID_INVITE = 'This invite link is not valid or was already used. Ask for a new invite.';
const EXPIRED_INVITE = 'This invite link has expired. Ask for a new invite.';
const REDACTED = '[invite link]';

export interface InviteDelivery {
  channel: InviteChannel;
  sent: boolean;
  /** Why it was not sent (provider not set up, or the provider refused). The owner copies the link instead. */
  reason?: string;
}

const linkOf = (rawToken: string) => `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite?token=${rawToken}`;

/**
 * Send the link by the chosen channel. Never throws: a provider that is not set up or fails gives `sent: false`, and the
 * invite stays valid so the owner can hand over the link. The message log keeps the text without the link.
 */
async function deliver(
  channel: InviteChannel,
  person: { firstName: string; email: string; phoneNumber: string | null },
  inviterName: string,
  link: string,
): Promise<InviteDelivery> {
  try {
    if (channel === 'email') {
      await sendInviteEmail(person.email, person.firstName, inviterName, link);
      return { channel, sent: true };
    }
    const body = `Hi ${person.firstName}, ${inviterName} invited you to join their team. Set your password here (works once, 7 days): ${link}`;
    const result = channel === 'sms'
      ? await smsService.sendSms({ to: person.phoneNumber!, body })
      : await whatsappService.sendText({ to: person.phoneNumber!, body });
    return result.providerMessageId
      ? { channel, sent: true }
      : { channel, sent: false, reason: `${channel === 'sms' ? 'SMS' : 'WhatsApp'} is not set up` };
  } catch (error) {
    logger.warn('Invite link not delivered', { channel, error: error instanceof Error ? error.message : String(error) });
    return { channel, sent: false, reason: error instanceof Error ? error.message : 'Send failed' };
  } finally {
    // The log row holds the text as sent, or as it failed; the token must not stay in the database either way.
    if (channel !== 'email') await redactLink(link);
  }
}

async function redactLink(link: string): Promise<void> {
  try {
    const rows = await prisma.messageLog.findMany({ where: { messageBody: { contains: link } }, select: { id: true, messageBody: true } });
    for (const row of rows) {
      await prisma.messageLog.update({ where: { id: row.id }, data: { messageBody: row.messageBody!.split(link).join(REDACTED) } });
    }
  } catch (error) {
    logger.error('Could not remove an invite link from the message log', { error: error instanceof Error ? error.message : String(error) });
  }
}

const requirePhone = (channel: InviteChannel, phone: string | null | undefined) => {
  if (channel !== 'email' && !phone) throw new AppError('A phone number is needed to send the invite by SMS or WhatsApp', 400, 'PHONE_REQUIRED');
};

const inviterName = async (actor: Requester) => {
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { firstName: true, lastName: true } });
  return me ? fullName(me) : 'Your team';
};

/**
 * Invite a person. The user is made inactive with the invite date (status Invited), holds the chosen role from today, and the
 * link goes out. The response carries `link` once, so the owner can copy it when the channel is not set up.
 */
export async function inviteStaff(actor: Requester, input: InviteStaffInput) {
  requirePhone(input.channel, input.phoneNumber);

  // The role: a role of the tenant (its preset is the base role, `manager` for a custom role as in assignToRole), or a UserRole.
  let base: UserRole;
  if (input.roleId !== undefined) {
    const role = await findRole(input.roleId);
    assertMayTouchRole(actor, role);
    base = role.presetRole ?? 'manager';
  } else {
    base = input.role!;
  }

  const isDelivery = base === 'delivery_agent';
  if (isDelivery && input.payMethod === 'per_order') {
    throw new AppError('A delivery partner has no per-order amount here. Their fee is set in the partner fee rule.', 400, 'FEE_NOT_EDITABLE');
  }
  const vehicleType = input.vehicleType ? normalizeVehicleType(input.vehicleType) : null;
  if (input.vehicleType && !vehicleType) {
    throw new AppError(`Vehicle type must be one of: ${VEHICLE_TYPES.join(', ')}`, 400, 'INVALID_VEHICLE_TYPE');
  }
  const payMethod = isDelivery && input.payMethod === 'none' ? 'fee_rule' : input.payMethod;
  const commissionAmount = payMethod === 'per_order' ? (input.amount ?? DEFAULT_PER_ORDER_AMOUNT) : 0;

  const token = newInviteToken();
  // createUser checks the rank (the actor must outrank the base role; an admin cannot invite an Owner-level role) and the email.
  const created = await adminService.createUser(actor, {
    email: input.email,
    ...splitName(input.name),
    phoneNumber: input.phoneNumber || undefined,
    role: base,
    roleId: input.roleId,
    commissionAmount,
    vehicleType: vehicleType ?? undefined,
    vehicleId: input.vehicleId || undefined,
    location: input.city || undefined,
    preferences: { payMethod },
    access: 'invite',
    invite: { tokenHash: token.hash, expiresAt: token.expiresAt },
  });

  const link = linkOf(token.raw);
  const delivery = await deliver(input.channel, created, await inviterName(actor), link);
  return { staff: staffView(await findStaff(created.id)), link, expiresAt: token.expiresAt, delivery };
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
  const target = await findInvited(actor, id);
  requirePhone(channel, target.phoneNumber);
  const token = newInviteToken();
  await prisma.user.update({ where: { id }, data: { inviteTokenHash: token.hash, inviteExpiresAt: token.expiresAt } });
  const link = linkOf(token.raw);
  const delivery = await deliver(channel, target, await inviterName(actor), link);
  return { staff: staffView(await findStaff(id)), link, expiresAt: token.expiresAt, delivery };
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

/**
 * Public. Spend the token: the person chooses a password and becomes active. One use: the claim is a conditional write, so
 * two requests with the same token cannot both win. Unknown or used token: 400 (one message). Expired: 410. Returns the user
 * for the caller to sign in.
 */
export async function acceptInvite(token: string, password: string) {
  const tokenHash = hashInviteToken(token);
  const invited = await withoutTenant('auth-accept-invite', () => prisma.user.findFirst({
    where: { inviteTokenHash: tokenHash, isActive: false, kind: 'person' },
    select: { id: true, tenantId: true, inviteExpiresAt: true },
  }));
  if (!invited) throw new AppError(INVALID_INVITE, 400, 'INVITE_INVALID');
  if (isInviteExpired(invited.inviteExpiresAt)) throw new AppError(EXPIRED_INVITE, 410, 'INVITE_EXPIRED');

  const hashed = await bcrypt.hash(password, 10);

  return runInTenantOf(invited.tenantId, 'auth-accept-invite', async () => {
    const claimed = await prisma.user.updateMany({
      where: { id: invited.id, inviteTokenHash: tokenHash, isActive: false },
      data: { password: hashed, isActive: true, inviteTokenHash: null, inviteExpiresAt: null, invitedAt: null, refreshToken: null },
    });
    if (claimed.count === 0) throw new AppError(INVALID_INVITE, 400, 'INVITE_INVALID');
    await prisma.auditLog.create({
      data: { tenantId: resolveTenantId(), userId: invited.id, action: 'staff_invite_accept', resource: 'user', resourceId: String(invited.id), metadata: {} },
    });
    return prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
  });
}
