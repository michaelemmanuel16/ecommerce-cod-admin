import { MessageChannel } from '@prisma/client';
import prisma from '../../utils/prisma';
import { phoneLookupVariants } from '../../utils/phone';

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
