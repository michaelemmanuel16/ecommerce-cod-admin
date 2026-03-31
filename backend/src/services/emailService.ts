import sgMail from '@sendgrid/mail';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import prisma from '../utils/prisma';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import { escapeHtml } from '../utils/sanitizer';
import logger from '../utils/logger';

// ---------- Types ----------

interface EmailConfig {
  provider: 'sendgrid' | 'smtp' | 'resend';
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

// ---------- Config cache (same pattern as whatsappService) ----------

let cachedConfig: { data: EmailConfig | null; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000; // 60 seconds

async function getDbEmailConfig(): Promise<EmailConfig | null> {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.fetchedAt < CACHE_TTL_MS) {
    return cachedConfig.data;
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

    cachedConfig = { data: result, fetchedAt: now };
    return result;
  } catch (error: any) {
    logger.warn('Failed to read email config from DB, falling back to env vars', { error: error.message });
    return null;
  }
}

/** Clear cached config (call after admin saves new settings). */
export function clearEmailConfigCache(): void {
  cachedConfig = null;
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

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  const config = await getConfig();

  if (!config.apiKey) {
    logger.warn('Email not configured — cannot send email', { to: maskEmail(options.to), subject: options.subject });
    throw new Error('Email provider not configured. Please configure email settings in Settings → Integrations.');
  }

  logger.info('Sending email', { provider: config.provider, to: maskEmail(options.to), subject: options.subject });

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
