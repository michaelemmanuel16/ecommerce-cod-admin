import { getDbEmailConfig } from '../emailService';
import { getDbSmsConfig } from '../smsService';
import { getDbWhatsappConfig } from '../whatsappService';
import logger from '../../utils/logger';
import { InboxChannel } from './inboxEvents';

export interface ChannelAvailability {
  available: boolean;
  /** Why the channel cannot be used, shown beside the disabled switch. */
  hint?: string;
}

export type TenantChannels = Record<InboxChannel, ChannelAvailability>;

const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (error) {
    logger.warn('Inbox: could not read channel config', { channel: label, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

/** Which external channels the current tenant has connected. Run inside the tenant context. In-app is always available. */
export async function getTenantChannels(): Promise<TenantChannels> {
  const [email, sms, whatsapp] = await Promise.all([
    safe('email', getDbEmailConfig),
    safe('sms', getDbSmsConfig),
    safe('whatsapp', getDbWhatsappConfig),
  ]);
  const emailOn = !!email || !!process.env.SENDGRID_API_KEY || !!process.env.RESEND_API_KEY;
  return {
    inApp: { available: true },
    email: emailOn ? { available: true } : { available: false, hint: 'Connect email in Connections to turn this on.' },
    sms: sms?.isEnabled ? { available: true } : { available: false, hint: 'Connect SMS in Connections to turn this on.' },
    whatsapp: whatsapp?.isEnabled ? { available: true } : { available: false, hint: 'Connect WhatsApp in Connections to turn this on.' },
  };
}
