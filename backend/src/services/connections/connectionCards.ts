import { ConnectionEventLevel } from '@prisma/client';
import prisma from '../../utils/prisma';
import { loadProviderConfig } from '../payments/connectionConfig';
import { getDbSmsConfig } from '../messaging/providers/arkeselSmsProvider';
import { getDbEmailConfig } from '../messaging/providers/emailProvider';
import { getDbWhatsappConfig } from '../messaging/providers/whatsappCloudProvider';
import type { ConnectionName } from './connectionEventService';

/**
 * M9-T26 (F-1200, F-1206): one entry per card of the Connections page. There is no card for a delivery partner (O7)
 * and no partner sync status anywhere in this answer.
 */
export type CardStatus = 'connected' | 'not_connected' | 'error';

export interface Card {
  status: CardStatus;
  /** Short text when the card is in error or not connected */
  reason: string | null;
  lastEventAt: Date | null;
  [extra: string]: unknown;
}

/** A recent error row turns a connected card to error for this long, unless something newer is fine. */
export const ERROR_WINDOW_MS = 24 * 3600_000;

interface LastEvent {
  level: ConnectionEventLevel;
  message: string;
  createdAt: Date;
}

export interface StatusInput {
  configured: boolean;
  /** Reason shown when not configured */
  notConnectedReason: string;
  /** A problem seen in the stored connection itself (expired token, switched off) */
  configError?: string | null;
  lastEvent?: LastEvent | null;
  now?: Date;
}

/** Pure: the status rule for one card. Not set up -> not_connected; a config problem or a recent error row -> error; else connected. */
export function resolveStatus(input: StatusInput): { status: CardStatus; reason: string | null } {
  if (!input.configured) return { status: 'not_connected', reason: input.notConnectedReason };
  if (input.configError) return { status: 'error', reason: input.configError };
  const now = (input.now ?? new Date()).getTime();
  const last = input.lastEvent;
  if (last && last.level === 'error' && now - last.createdAt.getTime() < ERROR_WINDOW_MS) return { status: 'error', reason: last.message };
  return { status: 'connected', reason: null };
}

const card = (input: StatusInput, lastEventAt: Date | null, extra: Record<string, unknown> = {}): Card => ({
  ...resolveStatus(input),
  lastEventAt,
  ...extra,
});

export async function listConnectionCards(tenantId: string, now: Date = new Date()): Promise<Record<string, Card>> {
  // The latest row of each connection (any level): its time is lastEventAt, an error row can turn the card red
  const latest = await prisma.connectionEvent.findMany({
    where: { tenantId },
    distinct: ['connection'],
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { connection: true, level: true, message: true, createdAt: true },
  });
  const lastOf = (c: ConnectionName): LastEvent | null => latest.find((e) => e.connection === c) ?? null;
  const at = (c: ConnectionName) => lastOf(c)?.createdAt ?? null;

  const [sms, whatsapp, email, paystack, metaAccounts, formCount, lastCheckoutOrder] = await Promise.all([
    getDbSmsConfig(),
    getDbWhatsappConfig(),
    getDbEmailConfig(),
    loadProviderConfig(tenantId, 'paystack'),
    prisma.metaAdAccount.findMany({ select: { enabled: true, status: true, statusReason: true, lastPulledAt: true, lastPullError: true, failedPullCount: true } }),
    prisma.checkoutForm.count({ where: { archivedAt: null } }),
    // An order made by a connection test does not count as a checkout order
    prisma.order.findFirst({ where: { source: 'checkout_form', isTest: false }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);

  // SMS (Arkesel)
  const smsOff = !!sms && !sms.isEnabled;
  const smsCard = card(
    { configured: !!sms && sms.isEnabled, notConnectedReason: smsOff ? 'SMS is switched off' : 'Add your Arkesel API key', lastEvent: lastOf('sms'), now },
    at('sms'),
  );

  // WhatsApp (Meta Cloud API)
  const waConfigured = !!whatsapp && !!whatsapp.accessToken && !!whatsapp.phoneNumberId && whatsapp.isEnabled !== false;
  const waExpired = waConfigured && !!whatsapp.oauthTokenExpiry && new Date(whatsapp.oauthTokenExpiry).getTime() < now.getTime();
  const waCard = card(
    {
      configured: waConfigured,
      notConnectedReason: 'Connect your WhatsApp Business number',
      configError: waExpired ? 'The WhatsApp connection expired. Reconnect WhatsApp.' : null,
      lastEvent: lastOf('whatsapp'),
      now,
    },
    at('whatsapp'),
  );

  // Email: the tenant's own sender wins; else the platform Resend sender
  const platformEmail = !!process.env.PLATFORM_EMAIL_API_KEY || !!process.env.RESEND_API_KEY;
  const emailSource = email ? email.provider : platformEmail ? 'platform' : null;
  const emailCard = card(
    { configured: emailSource !== null, notConnectedReason: 'Add an email sender', lastEvent: lastOf('email'), now },
    at('email'),
    { provider: emailSource },
  );

  // Paystack
  const paystackOff = !!paystack && !paystack.isEnabled;
  const paystackCard = card(
    { configured: !!paystack && paystack.isEnabled, notConnectedReason: paystackOff ? 'Paystack is switched off' : 'Add your Paystack keys', lastEvent: lastOf('paystack'), now },
    at('paystack'),
    { mode: paystack?.mode ?? null },
  );

  // Meta Ads (M8)
  const enabledAccounts = metaAccounts.filter((a) => a.enabled);
  const liveAccounts = enabledAccounts.filter((a) => a.status === 'connected');
  const metaProblem =
    enabledAccounts.length > 0 && liveAccounts.length === 0
      ? enabledAccounts[0].statusReason || 'Meta Ads is disconnected. Reconnect Meta Ads.'
      : liveAccounts.find((a) => a.failedPullCount >= 2)?.lastPullError ?? null;
  const lastPull = metaAccounts.map((a) => a.lastPulledAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const metaCard = card(
    { configured: enabledAccounts.length > 0, notConnectedReason: 'Connect Meta Ads', configError: metaProblem, lastEvent: lastOf('meta'), now },
    [at('meta'), lastPull].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
    { accounts: enabledAccounts.length },
  );

  // Checkout website summary
  const checkoutCard = card(
    { configured: formCount > 0, notConnectedReason: 'Create a checkout form', lastEvent: lastOf('checkout'), now },
    lastCheckoutOrder?.createdAt ?? at('checkout'),
    { forms: formCount, lastOrderAt: lastCheckoutOrder?.createdAt ?? null },
  );

  return { sms: smsCard, whatsapp: waCard, email: emailCard, paystack: paystackCard, meta: metaCard, checkout: checkoutCard };
}
