import { MessageChannel, MessageStatus } from '@prisma/client';
import prisma from '../../../utils/prisma';
import logger from '../../../utils/logger';
import { decryptProviderSecrets, isProviderEnabled } from '../../../utils/providerCrypto';
import { getTenantId } from '../../../utils/tenantContext';
import { getBackendUrl } from '../../../utils/url';
import { CallbackRequest, MessagingProvider, ParsedStatus, ProviderSendInput, ProviderSendResult } from '../types';
import { recordConnectionEvent } from '../../connections/connectionEventService';

// Arkesel SMS API
const ARKESEL_API_URL = 'https://sms.arkesel.com/api/v2/sms/send';

export interface SmsConfig {
  apiKey: string;
  senderId: string;
  isEnabled: boolean;
}

// Tenant-aware cached DB config with 60s TTL (mirrors WhatsApp pattern)
const configCache = new Map<string, { data: SmsConfig | null; fetchedAt: number }>();
const CONFIG_CACHE_TTL = 60_000;

export async function getDbSmsConfig(): Promise<SmsConfig | null> {
  const tenantId = getTenantId() || '__default__';
  const now = Date.now();
  const cached = configCache.get(tenantId);
  if (cached && now - cached.fetchedAt < CONFIG_CACHE_TTL) {
    return cached.data;
  }

  try {
    const config = await prisma.systemConfig.findFirst({ select: { smsProvider: true } });
    const provider = config?.smsProvider as any;
    const decrypted = provider ? decryptProviderSecrets('smsProvider', provider) : null;

    if (!decrypted || !decrypted.authToken) {
      configCache.set(tenantId, { data: null, fetchedAt: now });
      return null;
    }

    const smsConfig: SmsConfig = {
      apiKey: decrypted.authToken,
      senderId: decrypted.senderId || 'CODAdmin',
      isEnabled: isProviderEnabled(decrypted),
    };

    configCache.set(tenantId, { data: smsConfig, fetchedAt: now });
    return smsConfig;
  } catch (error: any) {
    logger.warn('Failed to read SMS config from DB', { error: error.message });
    return null;
  }
}

export function clearSmsConfigCache(): void {
  configCache.clear();
}

/** Arkesel delivery-report status word -> our status */
const STATUS_MAP: Record<string, MessageStatus> = {
  delivered: MessageStatus.delivered,
  failed: MessageStatus.failed,
  rejected: MessageStatus.failed,
};

/** Arkesel failure word -> short readable text */
export const ARKESEL_FAILURE_REASONS: Record<string, string> = {
  failed: 'The network could not deliver this SMS',
  rejected: 'The SMS was rejected by the network or the sender ID',
};

/** The per-message delivery-report URL (`callback_url` of the v2 send API). Null when no token is set. */
export function arkeselCallbackUrl(): string | null {
  const token = process.env.ARKESEL_CALLBACK_TOKEN;
  if (!token) return null;
  return `${getBackendUrl().replace(/\/+$/, '')}/api/sms/webhook?token=${encodeURIComponent(token)}`;
}

/** The report fields worth keeping. The callback token (in the URL query) is never stored. */
function reportPayload(src: Record<string, any>): Record<string, any> {
  const { token: _token, ...rest } = src;
  return rest;
}

export const arkeselSmsProvider: MessagingProvider = {
  channel: MessageChannel.sms,
  name: 'arkesel',

  async isEnabled() {
    const config = await getDbSmsConfig();
    return !!config && config.isEnabled;
  },

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const config = await getDbSmsConfig();
    if (!config || !config.isEnabled) return { accepted: false, error: 'provider_disabled' };

    try {
      const callbackUrl = arkeselCallbackUrl();
      const response = await fetch(ARKESEL_API_URL, {
        method: 'POST',
        headers: { 'api-key': config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: config.senderId,
          message: input.body ?? '',
          recipients: [input.to],
          ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        }),
      });
      const data: any = await response.json();
      if (!response.ok) {
        const errorMsg = data?.message || JSON.stringify(data);
        if (input.tenantId) await recordConnectionEvent({ tenantId: input.tenantId, connection: 'sms', level: 'error', message: `Arkesel API error ${response.status}: ${errorMsg}` });
        return { accepted: false, error: `Arkesel API error ${response.status}: ${errorMsg}` };
      }
      return { accepted: true, providerMessageId: data?.data?.[0]?.id || undefined };
    } catch (error: any) {
      if (input.tenantId) await recordConnectionEvent({ tenantId: input.tenantId, connection: 'sms', level: 'error', message: error.message || 'Arkesel request failed' });
      return { accepted: false, error: error.message || 'Arkesel request failed' };
    }
  },

  parseStatusCallback(req: CallbackRequest): ParsedStatus[] {
    // Arkesel's docs show the report as query parameters (`sms_id`, `status`); older reports use a body.
    const src = { ...(req.query ?? {}), ...(req.body ?? {}) } as Record<string, any>;
    const messageId = src.messageId ?? src.sms_id ?? src.id;
    const status = src.status;
    if (!messageId || !status) return [];
    const word = String(status).toLowerCase();
    const mapped = STATUS_MAP[word];
    if (!mapped) {
      logger.debug('Unknown SMS delivery status', { providerMessageId: messageId, status });
      return [];
    }
    return [{
      providerMessageId: String(messageId),
      status: mapped,
      occurredAt: new Date(),
      providerStatus: word,
      failureReason: mapped === MessageStatus.failed ? (ARKESEL_FAILURE_REASONS[word] ?? ARKESEL_FAILURE_REASONS.failed) : undefined,
      payload: reportPayload(src),
    }];
  },
};
