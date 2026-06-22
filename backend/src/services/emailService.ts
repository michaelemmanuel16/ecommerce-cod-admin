import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { MessageChannel, MessageDirection, MessageStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import { escapeHtml } from '../utils/sanitizer';
import logger from '../utils/logger';
import { getTenantId } from '../utils/tenantContext';
import { renderEmailTemplate } from './emailTemplateService';

// ---------- Types ----------

interface EmailConfig {
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

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string; // override default fromEmail
}

/**
 * Which sending identity to use:
 * - 'tenant'   → the tenant's own BYO provider (DB config / env fallback). For marketing.
 * - 'platform' → CodAdmin's own transactional provider (PLATFORM_EMAIL_* env only),
 *                sent from a dedicated CodAdmin subdomain so bulk can't damage its
 *                reputation. For order/status/digital-delivery/unsubscribe email.
 */
export interface SendEmailMeta {
  as?: 'platform' | 'tenant';
}

// ---------- Config cache (tenant-keyed, same pattern as smsService) ----------

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
      fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@codadminpro.com',
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
    fromEmail: process.env.PLATFORM_EMAIL_FROM || 'noreply@mail.codadminpro.com',
    fromName: process.env.PLATFORM_EMAIL_FROM_NAME || 'COD Admin',
    smtpHost: process.env.PLATFORM_EMAIL_SMTP_HOST,
    smtpPort: process.env.PLATFORM_EMAIL_SMTP_PORT ? parseInt(process.env.PLATFORM_EMAIL_SMTP_PORT, 10) : undefined,
    smtpSecure: process.env.PLATFORM_EMAIL_SMTP_SECURE === 'true',
  };
}

// ---------- Provider-specific senders ----------

// ---------- Provider client caches ----------

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

async function sendViaSendGrid(config: EmailConfig, options: SendEmailOptions): Promise<void> {
  if (sgApiKey !== config.apiKey) {
    sgMail.setApiKey(config.apiKey);
    sgApiKey = config.apiKey;
  }
  const from = options.from || `${config.fromName} <${config.fromEmail}>`;
  await sgMail.send({ to: options.to, from, subject: options.subject, html: options.html });
}

async function sendViaResend(config: EmailConfig, options: SendEmailOptions): Promise<void> {
  if (!resendClient || resendApiKey !== config.apiKey) {
    resendClient = new Resend(config.apiKey);
    resendApiKey = config.apiKey;
  }
  const from = options.from || `${config.fromName} <${config.fromEmail}>`;
  await resendClient.emails.send({ from, to: options.to, subject: options.subject, html: options.html });
}

async function sendViaSmtp(config: EmailConfig, options: SendEmailOptions): Promise<void> {
  const transporter = getSmtpTransporter(config);
  const from = options.from || `${config.fromName} <${config.fromEmail}>`;
  await transporter.sendMail({ from, to: options.to, subject: options.subject, html: options.html });
}

// ---------- Helpers ----------

function maskEmail(email: string): string {
  return email.replace(/(.{2}).*(@.*)/, '$1***$2');
}

// ---------- Unified send function ----------

export async function sendEmail(options: SendEmailOptions, meta: SendEmailMeta = {}): Promise<void> {
  const sendAs = meta.as ?? 'tenant';
  const config = sendAs === 'platform' ? getPlatformConfig() : await getConfig();

  if (!config.apiKey) {
    logger.warn('Email not configured — cannot send email', { sendAs, to: maskEmail(options.to), subject: options.subject });
    throw new Error('Email provider not configured. Please configure email settings in Settings → Integrations.');
  }

  logger.info('Sending email', { sendAs, provider: config.provider, to: maskEmail(options.to), subject: options.subject });

  switch (config.provider) {
    case 'sendgrid':
      await sendViaSendGrid(config, options);
      break;
    case 'resend':
      await sendViaResend(config, options);
      break;
    case 'smtp':
      await sendViaSmtp(config, options);
      break;
    default:
      throw new Error(`Unsupported email provider: ${config.provider}`);
  }

  logger.info('Email sent successfully', { provider: config.provider, to: maskEmail(options.to) });
}

// ---------- Pre-built email functions ----------

export async function sendPasswordResetEmail(
  email: string,
  firstName: string,
  resetUrl: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Reset your password - COD Admin',
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>We received a request to reset your password. Click the link below to set a new password:</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link will expire in 15 minutes.</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
    `,
  });
}

export async function sendTestEmail(toEmail: string, fromName?: string): Promise<void> {
  await sendEmail({
    to: toEmail,
    subject: `Test Email from ${fromName || 'COD Admin'}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1f2937;">Email Configuration Test</h2>
        <p>This is a test email to verify your email integration is working correctly.</p>
        <p style="color: #6b7280; font-size: 14px;">Sent at: ${new Date().toLocaleString()}</p>
      </div>
    `,
  });
}

// ---------- Workflow send_email action (MAN-79) ----------

/**
 * Config for a workflow `send_email` action. `templateId` references a saved
 * EmailTemplate; otherwise inline `subject`/`body` is used. `body` is the
 * canonical inline-body field; `message` is read only as a fallback for drafts
 * saved before the field was renamed.
 */
export interface WorkflowEmailConfig {
  templateId?: number;
  subject?: string;
  body?: string;
  message?: string;
  to?: string;
}

export interface WorkflowEmailContext {
  orderId?: number;
}

export interface WorkflowEmailResult {
  sent: boolean;
  skipped?: boolean;
  messageLogId?: number;
  reason?: string;
}

/**
 * Send the email for a workflow `send_email` action — the one shared path used
 * by both the live BullMQ worker (workflowQueue) and the synchronous executor
 * (workflowService). Resolves the order's customer + tenant, renders the chosen
 * EmailTemplate (or inline subject/body) with the six merge tags, and sends via
 * the platform transactional provider.
 *
 * Writes a MessageLog(email) row (pending → sent/failed) and is idempotent: a
 * prior `sent` log for the same (orderId, templateName) short-circuits, so a
 * BullMQ retry re-running the action list can't re-send. Never throws on a send
 * failure — it records `failed` and returns, so one bad recipient can't trigger
 * a job-wide retry storm.
 */
export async function sendWorkflowEmail(
  config: WorkflowEmailConfig,
  context: WorkflowEmailContext,
): Promise<WorkflowEmailResult> {
  const order = context.orderId
    ? await prisma.order.findUnique({
        where: { id: context.orderId },
        include: { customer: true },
      })
    : null;
  const customer = order?.customer;

  // Recipient: explicit override wins, else the order customer's email.
  const to = config.to || customer?.email || null;
  if (!to) {
    logger.warn('send_email skipped — no recipient email', { orderId: context.orderId });
    return { sent: false, skipped: true, reason: 'no_recipient' };
  }

  // Resolve content: a saved template, else inline subject/body.
  let templateName = 'inline';
  let subjectTpl = config.subject || '';
  let bodyTpl = config.body ?? config.message ?? '';
  if (config.templateId) {
    const tpl = await prisma.emailTemplate.findUnique({ where: { id: config.templateId } });
    if (!tpl) {
      logger.warn('send_email skipped — template not found', { templateId: config.templateId });
      return { sent: false, skipped: true, reason: 'template_not_found' };
    }
    templateName = tpl.name;
    subjectTpl = tpl.subject;
    bodyTpl = tpl.body;
  }

  // Respect opt-out (records a skipped log so the campaign/history can show it).
  if (customer?.emailOptOut) {
    const log = await prisma.messageLog.create({
      data: {
        orderId: order?.id,
        customerId: customer.id,
        channel: MessageChannel.email,
        direction: MessageDirection.outbound,
        templateName,
        messageBody: '',
        status: MessageStatus.skipped,
        metadata: { to, reason: 'opted_out' },
      },
    });
    logger.info('send_email skipped — customer opted out', { orderId: order?.id, customerId: customer.id });
    return { sent: false, skipped: true, messageLogId: log.id, reason: 'opted_out' };
  }

  // Idempotency (H1): a prior successful send for this (order, template) wins,
  // so a BullMQ retry of the action list cannot double-send.
  if (order) {
    const existing = await prisma.messageLog.findFirst({
      where: {
        orderId: order.id,
        channel: MessageChannel.email,
        templateName,
        status: MessageStatus.sent,
      },
      select: { id: true },
    });
    if (existing) {
      logger.info('send_email skipped — already sent', { orderId: order.id, templateName });
      return { sent: false, skipped: true, messageLogId: existing.id, reason: 'already_sent' };
    }
  }

  // Build the merge context from order/customer/tenant.
  const tenantId = getTenantId();
  const [tenant, sysConfig] = await Promise.all([
    tenantId
      ? prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      : Promise.resolve(null),
    prisma.systemConfig.findFirst({ select: { currency: true } }),
  ]);
  const currency = sysConfig?.currency || 'GHS';
  const { subject, html } = renderEmailTemplate(
    { subject: subjectTpl, body: bodyTpl },
    {
      customer_name: customer ? `${customer.firstName} ${customer.lastName}`.trim() : '',
      customer_email: customer?.email ?? to,
      store_name: tenant?.name ?? '',
      order_number: order ? String(order.id) : '',
      order_total: order
        ? `${currency} ${Number(order.totalAmount).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : '',
      download_url: '',
    },
  );

  const messageLog = await prisma.messageLog.create({
    data: {
      orderId: order?.id,
      customerId: customer?.id,
      channel: MessageChannel.email,
      direction: MessageDirection.outbound,
      templateName,
      messageBody: html,
      status: MessageStatus.pending,
      metadata: { to, subject },
    },
  });

  try {
    await sendEmail({ to, subject, html }, { as: 'platform' });
    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: { status: MessageStatus.sent, sentAt: new Date() },
    });
    return { sent: true, messageLogId: messageLog.id };
  } catch (error: any) {
    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: { status: MessageStatus.failed, errorMessage: error.message?.substring(0, 500) },
    });
    logger.error('send_email failed', { orderId: order?.id, to: maskEmail(to), error: error.message });
    return { sent: false, messageLogId: messageLog.id, reason: 'send_failed' };
  }
}
