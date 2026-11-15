import { MessageChannel } from '@prisma/client';
import prisma from '../../utils/prisma';
import { normalizeInternationalPhone, phoneLookupVariants } from '../../utils/phone';

/** The Customer column that holds the opt-out flag of each channel. */
export const OPT_OUT_FLAG = {
  sms: 'smsOptOut',
  whatsapp: 'whatsappOptOut',
  email: 'emailOptOut',
} as const satisfies Record<MessageChannel, 'smsOptOut' | 'whatsappOptOut' | 'emailOptOut'>;

/** Every stored form of a phone: E.164, local with 0, bare digits. */
export function phoneForms(phone: string): string[] {
  const digits = phone.replace(/\D/g, '');
  return Array.from(new Set([...phoneLookupVariants(phone), ...(digits ? phoneLookupVariants(`+${digits}`) : [])]));
}

/**
 * Whether a message to this address on this channel is blocked by an opt-out. The one check every non-reply send uses.
 * A customer with the phone (or email) is the source of truth, whether or not `customerId` is given: any of them opted out means opted out.
 * With no customer at all, the latest OptOutEvent for the phone and channel decides (a `stop_reply` with no later `resubscribe`).
 */
export async function isOptedOut(tenantId: string, channel: MessageChannel, phone: string, customerId?: number | null): Promise<boolean> {
  const flag = OPT_OUT_FLAG[channel];
  const isEmail = channel === MessageChannel.email && phone.includes('@');
  const forms = isEmail ? [] : phoneForms(phone);

  const or: any[] = [];
  if (customerId) or.push({ id: customerId });
  if (isEmail) or.push({ email: { equals: phone, mode: 'insensitive' } });
  else if (forms.length) or.push({ phoneNumber: { in: forms } }, { alternatePhone: { in: forms } });

  const customers: Array<Record<string, any>> = (or.length
    ? await prisma.customer.findMany({ where: { tenantId, OR: or }, select: { [flag]: true } })
    : []) ?? [];
  if (customers.length) return customers.some((c) => c[flag] === true);

  const where: any = { tenantId, channel };
  if (isEmail) where.email = { equals: phone, mode: 'insensitive' };
  else if (forms.length) where.phone = { in: forms };
  else return false;
  const latest = await prisma.optOutEvent.findFirst({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { optedOut: true } });
  return latest?.optedOut === true;
}

export type OptOutReason = 'stop_reply' | 'resubscribe' | 'staff' | 'unsubscribe_link';

export interface SetOptOutInput {
  tenantId: string;
  /** The number the change is for. Every customer of the tenant with this phone changes together. */
  phone?: string | null;
  /** An email address, for the email channel: every customer with it changes together. */
  email?: string | null;
  /** A customer that is part of the change even when the phone and email match nobody else. */
  customerId?: number | null;
  channel: MessageChannel;
  optedOut: boolean;
  reason: OptOutReason;
  actorId?: number | null;
}

/** E.164 as the events store it. */
const eventPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return normalizeInternationalPhone(`+${digits}`) ?? `+${digits}`;
};

/**
 * The one way an opt-out changes. Opt-out is per phone: the flag changes on every customer of the tenant with that phone
 * (or email), and every change writes an OptOutEvent with its reason, one for each customer, or one with no customer
 * when nobody has the phone. Inbound STOP and START, staff, and the unsubscribe link all call this.
 */
export async function setOptOut(input: SetOptOutInput): Promise<{ customerIds: number[] }> {
  const { tenantId, channel, optedOut, reason } = input;
  const flag = OPT_OUT_FLAG[channel];
  const phone = input.phone ? eventPhone(input.phone) : null;
  const forms = input.phone ? phoneForms(input.phone) : [];

  const or: any[] = [];
  if (input.customerId) or.push({ id: input.customerId });
  if (forms.length) or.push({ phoneNumber: { in: forms } }, { alternatePhone: { in: forms } });
  if (input.email) or.push({ email: { equals: input.email, mode: 'insensitive' } });
  const customers = or.length
    ? await prisma.customer.findMany({ where: { tenantId, OR: or }, select: { id: true } })
    : [];
  const ids = customers.map((c) => c.id);

  if (ids.length) {
    await prisma.customer.updateMany({ where: { tenantId, id: { in: ids } }, data: { [flag]: optedOut } });
  }
  const base = {
    tenantId, phone, email: input.email ?? null, channel, optedOut, reason, actorId: input.actorId ?? null,
  };
  await prisma.optOutEvent.createMany({
    data: ids.length ? ids.map((customerId) => ({ ...base, customerId })) : [{ ...base, customerId: null }],
  });
  return { customerIds: ids };
}

/** Flags per channel and the history of one customer. Null when the customer is not in the tenant. */
export async function getCustomerOptOuts(tenantId: string, customerId: number) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, phoneNumber: true, smsOptOut: true, whatsappOptOut: true, emailOptOut: true },
  });
  if (!customer) return null;
  const events = await prisma.optOutEvent.findMany({
    where: { tenantId, customerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: { id: true, channel: true, optedOut: true, reason: true, actorId: true, createdAt: true },
  });
  return {
    customerId: customer.id,
    flags: { sms: customer.smsOptOut, whatsapp: customer.whatsappOptOut, email: customer.emailOptOut },
    events,
  };
}
