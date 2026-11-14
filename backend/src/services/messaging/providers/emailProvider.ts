import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { MessageChannel } from '@prisma/client';
import prisma from '../../../utils/prisma';
import logger from '../../../utils/logger';
import { maskEmail } from '../../../utils/mask';
import { decryptProviderSecrets } from '../../../utils/providerCrypto';
import { getTenantId } from '../../../utils/tenantContext';
import { CallbackRequest, MessagingProvider, ParsedStatus, ProviderSendInput, ProviderSendResult } from '../types';

// ---------- Types ----------

export interface EmailConfig {
  provider: 'sendgrid' | 'smtp' | 'resend';
  /** API key for SendGrid/Resend, or SMTP password when provider is 'smtp'. */
  apiKey: string;
  fromEmail: string;
  fromName: string;
  // SMTP-specific
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
}

export const NOT_CONFIGURED_TEXT = 'Email provider not configured. Please configure email settings in Settings → Integrations.';

/**
 * Platform sender address: PLATFORM_EMAIL_FROM (the dedicated sending subdomain) when set, else
 * RESEND_FROM_EMAIL, else no-reply@codadminpro.com. An env value written as `Name <addr>` gives its address.
 */
export function platformFromAddress(): string {
  const raw = process.env.PLATFORM_EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'no-reply@codadminpro.com';
  return raw.match(/<([^<>]+)>/)?.[1]?.trim() || raw.trim();
}

// ---------- Config cache (tenant-keyed) ----------

// Keyed by tenant so one tenant's encrypted provider key/fromEmail is never
// served to another under per-recipient/bulk cross-tenant sends (C2).
const configCache = new Map<string, { data: EmailConfig | null; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

// Exported for unit testing of tenant-keyed cache isolation (mirrors getDbSmsConfig).
export async function getDbEmailConfig(): Promise<EmailConfig | null> {
  const tenantId = getTenantId() || '__default__';
  const now = Date.now();
  const cached = configCache.get(tenantId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const config = await prisma.systemConfig.findFirst({
      select: { emailProvider: true },
    });
    const provider = config?.emailProvider as any;
    const decrypted = provider ? decryptProviderSecrets('emailProvider', provider) : null;

    let result: EmailConfig | null = null;
    if (decrypted && decrypted.apiKey && decrypted.provider) {
      result = {
        provider: decrypted.provider,
        apiKey: decrypted.apiKey,
        fromEmail: decrypted.fromEmail || 'noreply@codadminpro.com',
        fromName: decrypted.fromName || 'COD Admin',
        smtpHost: decrypted.smtpHost,
        smtpPort: decrypted.smtpPort,
        smtpSecure: decrypted.smtpSecure,
      };
    }

    configCache.set(tenantId, { data: result, fetchedAt: now });
    return result;
  } catch (error: any) {
    logger.warn('Failed to read email config from DB, falling back to env vars', { error: error.message });
    return null;
  }
}

/** Clear cached config (call after admin saves new settings). */
export function clearEmailConfigCache(): void {
  configCache.clear();
  sgApiKey = null;
  resendClient = null;
  resendApiKey = null;
  smtpTransporter = null;
  smtpConfigKey = null;
}

async function getConfig(): Promise<EmailConfig> {
  const dbConfig = await getDbEmailConfig();

  if (dbConfig) {
    return dbConfig;
  }

  // Fall back to env vars
  if (process.env.SENDGRID_API_KEY) {
    return {
      provider: 'sendgrid',
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.EMAIL_FROM || 'noreply@codadminpro.com',
      fromName: process.env.EMAIL_FROM_NAME || 'COD Admin',
    };
  }

  if (process.env.RESEND_API_KEY) {
    return {
      provider: 'resend',
      apiKey: process.env.RESEND_API_KEY,
      fromEmail: platformFromAddress(),
      fromName: process.env.EMAIL_FROM_NAME || 'COD Admin',
    };
  }

  // Return a config that will fail gracefully
  return {
    provider: 'sendgrid',
    apiKey: '',
    fromEmail: 'noreply@codadminpro.com',
    fromName: 'COD Admin',
  };
}

/**
 * Platform transactional config — env only, never DB/tenant-scoped (C2b).
 * Throws if unset so transactional sends fail loudly instead of silently
 * borrowing a tenant's provider. No caching: it's a cheap env read.
 */
function getPlatformConfig(): EmailConfig {
  const provider = (process.env.PLATFORM_EMAIL_PROVIDER || 'resend') as EmailConfig['provider'];
  const apiKey = process.env.PLATFORM_EMAIL_API_KEY || '';
  if (!apiKey) {
    throw new Error('PLATFORM_EMAIL_NOT_CONFIGURED: set PLATFORM_EMAIL_API_KEY to send transactional email.');
  }
  return {
    provider,
    apiKey,
    fromEmail: platformFromAddress(),
    fromName: process.env.PLATFORM_EMAIL_FROM_NAME || 'COD Admin',
    smtpHost: process.env.PLATFORM_EMAIL_SMTP_HOST,
    smtpPort: process.env.PLATFORM_EMAIL_SMTP_PORT ? parseInt(process.env.PLATFORM_EMAIL_SMTP_PORT, 10) : undefined,
    smtpSecure: process.env.PLATFORM_EMAIL_SMTP_SECURE === 'true',
  };
}

// ---------- Sender identity ----------

/**
 * A store name goes into the From header: remove CR, LF and the characters that end or split
 * a header value or an address (< > " , ; \), then cut it to 64 characters.
 */
export function safeDisplayName(name: string | null | undefined): string {
  return (name ?? '').replace(/[\r\n<>",;\\]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 64).trim();
}

/**
 * Who the email is from. Tenant SMTP keeps the tenant's own from address. Every other
 * provider sends with the store name as the display name, and replies go to the store owner.
 */
export async function resolveSenderIdentity(
  config: EmailConfig,
  tenantId: string | null,
): Promise<{ from: string; replyTo?: string }> {
  let storeName: string | null = null;
  let ownerEmail: string | null = null;
  if (tenantId) {
    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      storeName = tenant?.name ?? null;
      const owner = await prisma.user.findFirst({
        where: { tenantId, role: 'super_admin', isActive: true },
        orderBy: { id: 'asc' },
        select: { email: true },
      });
      ownerEmail = owner?.email ?? null;
    } catch (error: any) {
      logger.warn('Could not read store name or owner for the email sender', { error: error.message });
    }
  }
  const displayName = safeDisplayName(storeName) || safeDisplayName(config.fromName) || 'COD Admin';
  const from = `"${displayName}" <${config.fromEmail}>`;
  if (config.provider === 'smtp') return { from };
  return { from, replyTo: ownerEmail ?? undefined };
}

// ---------- Provider clients ----------

let sgApiKey: string | null = null;

let resendClient: Resend | null = null;
let resendApiKey: string | null = null;

let smtpTransporter: nodemailer.Transporter | null = null;
let smtpConfigKey: string | null = null;

function getSmtpTransporter(config: EmailConfig): nodemailer.Transporter {
  const key = `${config.fromEmail}:${config.apiKey}:${config.smtpHost}:${config.smtpPort}`;
  if (smtpTransporter && smtpConfigKey === key) return smtpTransporter;
  smtpTransporter = nodemailer.createTransport({
    host: config.smtpHost || 'smtp.gmail.com',
    port: config.smtpPort || 587,
    secure: config.smtpSecure || false,
    auth: { user: config.fromEmail, pass: config.apiKey },
  });
  smtpConfigKey = key;
  return smtpTransporter;
}

export const emailProvider: MessagingProvider = {
  channel: MessageChannel.email,
  name: 'resend',

  async isEnabled(_tenantId, opts) {
    if (opts?.sendAs === 'platform') return !!process.env.PLATFORM_EMAIL_API_KEY;
    const config = await getConfig();
    return !!config.apiKey;
  },

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    const sendAs = input.sendAs ?? 'tenant';
    let config: EmailConfig;
    try {
      config = sendAs === 'platform' ? getPlatformConfig() : await getConfig();
    } catch (error: any) {
      return { accepted: false, error: error.message };
    }

    if (!config.apiKey) {
      logger.warn('Email not configured — cannot send email', { sendAs, to: maskEmail(input.to), subject: input.subject });
      return { accepted: false, error: NOT_CONFIGURED_TEXT };
    }

    logger.info('Sending email', { sendAs, provider: config.provider, to: maskEmail(input.to), subject: input.subject });

    try {
      const identity = input.from ? { from: input.from, replyTo: undefined } : await resolveSenderIdentity(config, input.tenantId);
      const message = {
        to: input.to,
        from: identity.from,
        subject: input.subject ?? '',
        html: input.body ?? '',
        headers: input.headers,
      };

      let providerMessageId: string | undefined;
      switch (config.provider) {
        case 'sendgrid': {
          if (sgApiKey !== config.apiKey) {
            sgMail.setApiKey(config.apiKey);
            sgApiKey = config.apiKey;
          }
          const res: any = await sgMail.send({ ...message, ...(identity.replyTo ? { replyTo: identity.replyTo } : {}) });
          providerMessageId = res?.[0]?.headers?.['x-message-id'];
          break;
        }
        case 'resend': {
          if (!resendClient || resendApiKey !== config.apiKey) {
            resendClient = new Resend(config.apiKey);
            resendApiKey = config.apiKey;
          }
          // The Resend SDK does not throw when the API refuses a message: it answers `{ data, error }`. Without this check a
          // refused send (unverified domain, bad key) read as sent, and the invite said "sent" when nothing went out.
          const res: any = await resendClient.emails.send({
            ...message,
            ...(identity.replyTo ? { replyTo: identity.replyTo } : {}),
          });
          if (res?.error) throw new Error(`Resend refused the message: ${res.error.message}`);
          providerMessageId = res?.data?.id;
          break;
        }
        case 'smtp': {
          const info = await getSmtpTransporter(config).sendMail(message);
          providerMessageId = info?.messageId;
          break;
        }
        default:
          throw new Error(`Unsupported email provider: ${config.provider}`);
      }

      logger.info('Email sent successfully', { provider: config.provider, to: maskEmail(input.to) });
      return { accepted: true, providerMessageId, provider: config.provider };
    } catch (error: any) {
      return { accepted: false, error: error.message || 'Email send failed', provider: config.provider };
    }
  },

  // No Resend webhook in this codebase yet: email delivery statuses are not recorded.
  parseStatusCallback(_req: CallbackRequest): ParsedStatus[] {
    return [];
  },
};
