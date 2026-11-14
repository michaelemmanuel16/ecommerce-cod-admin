import { MessageChannel, MessageStatus } from '@prisma/client';
import prisma from '../../../utils/prisma';
import logger from '../../../utils/logger';
import { decryptProviderSecrets } from '../../../utils/providerCrypto';
import { getTenantId } from '../../../utils/tenantContext';
import { refreshTokenIfNeeded } from '../../whatsappTokenRefreshService';
import {
  CallbackRequest, MessagingProvider, ParsedInbound, ParsedStatus, ProviderSendInput, ProviderSendResult,
} from '../types';

// WhatsApp Business Cloud API configuration
export const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  webhookVerifyToken: string;
  businessAccountId?: string;
  isEnabled: boolean;
  authMode?: 'manual' | 'oauth';
  oauthTokenExpiry?: string;
}

// Tenant-aware cached DB config to avoid per-message DB queries
const configCache = new Map<string, { data: any; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

export async function getDbWhatsappConfig(): Promise<any | null> {
  const tenantId = getTenantId() || '__default__';
  const now = Date.now();
  const cached = configCache.get(tenantId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const config = await prisma.systemConfig.findFirst({
      select: { whatsappProvider: true },
    });
    const provider = config?.whatsappProvider as any;
    const decrypted = provider ? decryptProviderSecrets('whatsappProvider', provider) : null;
    configCache.set(tenantId, { data: decrypted, fetchedAt: now });
    return decrypted;
  } catch (error: any) {
    logger.warn('Failed to read WhatsApp config from DB, falling back to env vars', { error: error.message });
    return null;
  }
}

/** Clear cached DB config (call after admin saves new settings). */
export function clearWhatsAppConfigCache(): void {
  configCache.clear();
}

async function getConfig(): Promise<WhatsAppConfig> {
  const dbConfig = await getDbWhatsappConfig();

  // DB config takes precedence when present and enabled
  if (dbConfig && dbConfig.accessToken && dbConfig.phoneNumberId) {
    return {
      accessToken: dbConfig.accessToken,
      phoneNumberId: dbConfig.phoneNumberId,
      appSecret: dbConfig.appSecret || process.env.WHATSAPP_APP_SECRET || '',
      webhookVerifyToken: dbConfig.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      isEnabled: dbConfig.isEnabled !== false,
      authMode: dbConfig.authMode,
      oauthTokenExpiry: dbConfig.oauthTokenExpiry,
    };
  }

  // Fall back to env vars
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    isEnabled: true,
  };
}

/** Meta error code (statuses[].errors[].code) -> short readable text */
export const WHATSAPP_FAILURE_REASONS: Record<number, string> = {
  130429: 'Too many messages sent at once. WhatsApp slowed this number down',
  131000: 'Something went wrong at WhatsApp',
  131008: 'The message had a missing or wrong field',
  131009: 'A message value was not valid',
  131026: 'This number is not on WhatsApp, or the customer cannot get messages from businesses',
  131031: 'The WhatsApp business account is locked',
  131047: 'More than 24 hours since the customer last wrote. Send a template instead',
  131049: 'WhatsApp declined to send this message to protect the customer experience',
  131051: 'This kind of message is not supported',
  131053: 'The media could not be uploaded',
  131056: 'Too many messages to this one number in a short time',
  132000: 'The template values do not match the template',
  132001: 'The template does not exist or is not approved',
  132012: 'A template value has the wrong format',
  132015: 'The template is paused because of low quality',
  132016: 'The template is disabled',
  190: 'The WhatsApp access token has expired. Connect WhatsApp again',
};

export function whatsappFailureReason(errors: any[] | undefined): string {
  const err = errors?.[0];
  if (!err) return 'WhatsApp could not deliver this message';
  const mapped = WHATSAPP_FAILURE_REASONS[Number(err.code)];
  if (mapped) return mapped;
  return String(err.title || err.message || 'WhatsApp could not deliver this message').substring(0, 200);
}

const STATUS_MAP: Record<string, MessageStatus> = {
  sent: MessageStatus.sent,
  delivered: MessageStatus.delivered,
  read: MessageStatus.read,
  failed: MessageStatus.failed,
};

/** Statuses in one `change.value` of a Meta webhook. */
export function parseStatusesFromValue(value: any): ParsedStatus[] {
  const out: ParsedStatus[] = [];
  for (const s of value?.statuses || []) {
    const mapped = STATUS_MAP[s?.status];
    if (!s?.id || !mapped) {
      logger.warn('Unknown WhatsApp status update', { providerMessageId: s?.id, status: s?.status });
      continue;
    }
    out.push({
      providerMessageId: String(s.id),
      status: mapped,
      occurredAt: s.timestamp ? new Date(parseInt(s.timestamp, 10) * 1000) : new Date(),
      providerStatus: s.status,
      failureReason: mapped === MessageStatus.failed ? whatsappFailureReason(s.errors) : undefined,
      payload: s,
    });
  }
  return out;
}

function changeValues(req: CallbackRequest): any[] {
  const values: any[] = [];
  for (const entry of req.body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'messages' && change.value) values.push(change.value);
    }
  }
  return values;
}

export const whatsappCloudProvider: MessagingProvider = {
  channel: MessageChannel.whatsapp,
  name: 'whatsapp_cloud',

  async isEnabled() {
    const config = await getConfig();
    return !!config.accessToken && !!config.phoneNumberId && config.isEnabled;
  },

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    let config = await getConfig();
    if (!config.accessToken || !config.phoneNumberId || !config.isEnabled) {
      return { accepted: false, error: 'provider_disabled' };
    }

    // On-demand token refresh for OAuth mode — only triggers when cron has failed
    // (within 1 day of expiry rather than 7, since cron handles proactive refresh)
    if (config.authMode === 'oauth' && config.oauthTokenExpiry) {
      const expiryMs = new Date(config.oauthTokenExpiry).getTime();
      const oneDay = 24 * 60 * 60 * 1000;
      if (expiryMs - Date.now() < oneDay) {
        try {
          const result = await refreshTokenIfNeeded();
          if (result.refreshed) {
            config = await getConfig(); // re-read so this send uses the new token
          }
        } catch (err: any) {
          logger.warn('On-demand token refresh failed, proceeding with current token', { error: err.message });
        }
      }
    }

    let payload: object;
    if (input.template) {
      const { name, languageCode = 'en_US', bodyParams = [], headerParams = [], buttonPayloads = [] } = input.template;
      const components: any[] = [];
      if (headerParams.length > 0) {
        components.push({ type: 'header', parameters: headerParams.map((text) => ({ type: 'text', text })) });
      }
      if (bodyParams.length > 0) {
        components.push({ type: 'body', parameters: bodyParams.map((text) => ({ type: 'text', text })) });
      }
      buttonPayloads.forEach((p, i) => {
        components.push({ type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload: p }] });
      });
      payload = {
        messaging_product: 'whatsapp',
        to: input.to,
        type: 'template',
        template: {
          name,
          language: { code: languageCode },
          components: components.length > 0 ? components : undefined,
        },
      };
    } else {
      payload = { messaging_product: 'whatsapp', to: input.to, type: 'text', text: { body: input.body ?? '' } };
    }

    try {
      const response = await fetch(`${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        return { accepted: false, error: `WhatsApp API error ${response.status}: ${errorBody}` };
      }
      const data = (await response.json()) as { messages?: Array<{ id: string }> };
      return { accepted: true, providerMessageId: data.messages?.[0]?.id };
    } catch (error: any) {
      return { accepted: false, error: error.message || 'WhatsApp request failed' };
    }
  },

  parseStatusCallback(req: CallbackRequest): ParsedStatus[] {
    return changeValues(req).flatMap(parseStatusesFromValue);
  },

  parseInbound(req: CallbackRequest): ParsedInbound[] {
    const out: ParsedInbound[] = [];
    for (const value of changeValues(req)) {
      for (const m of value.messages || []) {
        let buttonPayload: string | null = null;
        let text = '';
        if (m.type === 'text') text = m.text?.body || '';
        else if (m.type === 'button') { text = m.button?.text || ''; buttonPayload = m.button?.payload || null; }
        else if (m.type === 'interactive') {
          text = m.interactive?.button_reply?.title || '';
          buttonPayload = m.interactive?.button_reply?.id || null;
        }
        out.push({
          providerMessageId: m.id,
          from: m.from,
          type: m.type,
          text,
          buttonPayload,
          contextMessageId: m.context?.id ?? null,
          occurredAt: m.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000) : new Date(),
          raw: m,
        });
      }
    }
    return out;
  },
};
