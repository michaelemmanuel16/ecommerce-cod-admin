import { MessageChannel } from '@prisma/client';
import prisma from '../../utils/prisma';
import { conversationPhone, phoneForms } from '../../utils/phone';

/** The Customer column that holds the opt-out flag of each channel. */
export const OPT_OUT_FLAG = {
  sms: 'smsOptOut',
  whatsapp: 'whatsappOptOut',
  email: 'emailOptOut',
} as const satisfies Record<MessageChannel, 'smsOptOut' | 'whatsappOptOut' | 'emailOptOut'>;

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

/**
 * The one way an opt-out changes. Opt-out is per phone: the flag changes on every customer of the tenant with that phone
 * (or email), and every change writes an OptOutEvent with its reason, one for each customer, or one with no customer
 * when nobody has the phone. Inbound STOP and START, staff, and the unsubscribe link all call this.
 */
export async function setOptOut(input: SetOptOutInput): Promise<{ customerIds: number[] }> {
  const { tenantId, channel, optedOut, reason } = input;
  const flag = OPT_OUT_FLAG[channel];
  const phone = input.phone ? conversationPhone(input.phone) : null;
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

export interface OptOutRow {
  /** One row for each channel a customer (or a bare phone) is opted out of. */
  key: string;
  channel: MessageChannel;
  customerId: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  area: string | null;
  /** When the latest opt-out event on this channel was written. Null for a flag set before events existed. */
  since: Date | null;
  /** The reason text of the event: stop_reply, resubscribe, staff, unsubscribe_link, import. */
  reason: string | null;
}

export interface OptOutListFilter { channel?: MessageChannel; q?: string; page: number; limit: number }

/**
 * Everyone this tenant may not message: customers whose flag is on, and phones that opted out with no customer behind them
 * (the latest event of the phone on that channel is an opt-out). Newest first. A phone that belongs to a customer is
 * judged by the customer's flag, as `isOptedOut` does.
 */
export async function listOptOuts(tenantId: string, filter: OptOutListFilter): Promise<{ items: OptOutRow[]; total: number; page: number; limit: number }> {
  const channels = filter.channel ? [filter.channel] : [MessageChannel.sms, MessageChannel.whatsapp, MessageChannel.email];
  const q = filter.q?.trim();
  const rows: OptOutRow[] = [];

  const flagsOn = channels.map((c) => ({ [OPT_OUT_FLAG[c]]: true }));
  const customers = await prisma.customer.findMany({
    where: { tenantId, OR: flagsOn },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true, area: true, smsOptOut: true, whatsappOptOut: true, emailOptOut: true },
  });
  const events = customers.length
    ? await prisma.optOutEvent.findMany({
      where: { tenantId, optedOut: true, channel: { in: channels }, customerId: { in: customers.map((c) => c.id) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { customerId: true, channel: true, createdAt: true, reason: true },
    })
    : [];
  const latest = new Map<string, { createdAt: Date; reason: string }>();
  for (const e of events) {
    const k = `${e.customerId}:${e.channel}`;
    if (!latest.has(k)) latest.set(k, { createdAt: e.createdAt, reason: e.reason });
  }
  for (const c of customers) {
    for (const channel of channels) {
      if (!c[OPT_OUT_FLAG[channel]]) continue;
      const ev = latest.get(`${c.id}:${channel}`);
      rows.push({
        key: `c${c.id}:${channel}`, channel, customerId: c.id, name: `${c.firstName} ${c.lastName}`.trim(), phone: c.phoneNumber, email: c.email,
        area: c.area, since: ev?.createdAt ?? null, reason: ev?.reason ?? null,
      });
    }
  }

  // Phones with no customer: only SMS and WhatsApp (an email address with no customer cannot be reached by the unsubscribe link either)
  const phoneChannels = channels.filter((c) => c !== MessageChannel.email);
  if (phoneChannels.length) {
    const phoneEvents = await prisma.optOutEvent.findMany({
      where: { tenantId, customerId: null, phone: { not: null }, channel: { in: phoneChannels } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['phone', 'channel'],
      select: { phone: true, channel: true, optedOut: true, createdAt: true, reason: true },
    });
    const bare = phoneEvents.filter((e) => e.optedOut && e.phone);
    if (bare.length) {
      const forms = Array.from(new Set(bare.flatMap((e) => phoneForms(e.phone!))));
      const owned = await prisma.customer.findMany({ where: { tenantId, OR: [{ phoneNumber: { in: forms } }, { alternatePhone: { in: forms } }] }, select: { phoneNumber: true, alternatePhone: true } });
      const ownedForms = new Set(owned.flatMap((c) => [...phoneForms(c.phoneNumber), ...(c.alternatePhone ? phoneForms(c.alternatePhone) : [])]));
      for (const e of bare) {
        if (phoneForms(e.phone!).some((f) => ownedForms.has(f))) continue;
        rows.push({ key: `p${e.phone}:${e.channel}`, channel: e.channel, customerId: null, name: null, phone: e.phone, email: null, area: null, since: e.createdAt, reason: e.reason });
      }
    }
  }

  const needle = q?.toLowerCase();
  // A phone typed the local way (0245550999) matches the stored +233245550999
  const digits = q?.replace(/\D/g, '').replace(/^(233|234|0)/, '');
  const matched = needle
    ? rows.filter((r) => (r.name ?? '').toLowerCase().includes(needle) || (r.email ?? '').toLowerCase().includes(needle) || (digits && (r.phone ?? '').replace(/\D/g, '').includes(digits)))
    : rows;
  matched.sort((a, b) => (b.since?.getTime() ?? 0) - (a.since?.getTime() ?? 0) || a.key.localeCompare(b.key));
  const start = (filter.page - 1) * filter.limit;
  return { items: matched.slice(start, start + filter.limit), total: matched.length, page: filter.page, limit: filter.limit };
}
