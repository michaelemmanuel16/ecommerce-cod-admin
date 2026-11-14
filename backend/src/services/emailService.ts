import { maskEmail } from '../utils/mask';
import { MessageChannel, MessageStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { escapeHtml } from '../utils/sanitizer';
import logger from '../utils/logger';
import { getTenantId } from '../utils/tenantContext';
import { renderEmailTemplate } from './emailTemplateService';
import { ensureUnsubscribeToken, buildUnsubscribeUrl, applyUnsubscribe } from './unsubscribeService';
import * as Money from '../utils/money';
import { getCurrency } from '../utils/currency';
import { INVITE_TTL_DAYS } from '../utils/inviteToken';
import { emailProvider } from './messaging/providers/emailProvider';
import { messageSender } from './messaging/messageSender';

// The email adapter owns the provider calls and their config
export { getDbEmailConfig, clearEmailConfigCache } from './messaging/providers/emailProvider';

// ---------- Types ----------

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string; // override default fromEmail
  /** Extra SMTP headers (e.g. RFC 8058 List-Unsubscribe). */
  headers?: Record<string, string>;
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

// ---------- Unified send function ----------

/** Send one email with no log row (password reset, invites, digital delivery). Throws when it fails. */
export async function sendEmail(options: SendEmailOptions, meta: SendEmailMeta = {}): Promise<void> {
  const result = await emailProvider.send({
    tenantId: getTenantId(),
    to: options.to,
    subject: options.subject,
    body: options.html,
    from: options.from,
    headers: options.headers,
    sendAs: meta.as ?? 'tenant',
  });
  if (!result.accepted) throw new Error(result.error || 'Email send failed');
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

export async function sendInviteEmail(
  email: string,
  firstName: string,
  inviterName: string,
  inviteUrl: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'You are invited to join the team - COD Admin',
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>${escapeHtml(inviterName)} invited you to join their team. Click the link below to choose your password:</p>
      <p><a href="${inviteUrl}">Accept the invite</a></p>
      <p>This link works once and expires in ${INVITE_TTL_DAYS} days.</p>
    `,
  });
}

export async function sendEmailChangedNotice(
  oldEmail: string,
  firstName: string,
  newEmail: string
): Promise<void> {
  await sendEmail({
    to: oldEmail,
    subject: 'Your sign-in email was changed - COD Admin',
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>The sign-in email on your account was changed to ${escapeHtml(newEmail)}.</p>
      <p>If you did not do this, contact your account owner at once.</p>
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
    const skipped = await messageSender.send({
      tenantId: getTenantId(),
      channel: MessageChannel.email,
      to,
      templateName,
      orderId: order?.id,
      customerId: customer.id,
      sendAs: 'platform',
      skipReason: 'opted_out',
    });
    logger.info('send_email skipped — customer opted out', { orderId: order?.id, customerId: customer.id });
    return { sent: false, skipped: true, messageLogId: skipped.messageLogId, reason: 'opted_out' };
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

  // Build the merge context from order/customer/tenant. Workflow email is
  // marketing-class, so resolve the customer's unsubscribe token here too (MAN-81)
  // — minting it in parallel with the tenant/config reads. No customer (e.g. an
  // explicit `to` override) → no opt-out link, since there's nothing to opt out.
  const tenantId = getTenantId();
  const [tenant, currency, unsubscribeToken] = await Promise.all([
    tenantId
      ? prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      : Promise.resolve(null),
    getCurrency(),
    customer ? ensureUnsubscribeToken(customer) : Promise.resolve(''),
  ]);
  const unsubscribeUrl = unsubscribeToken ? buildUnsubscribeUrl(unsubscribeToken) : '';
  const { subject, html } = renderEmailTemplate(
    { subject: subjectTpl, body: bodyTpl },
    {
      customer_name: customer ? `${customer.firstName} ${customer.lastName}`.trim() : '',
      customer_email: customer?.email ?? to,
      store_name: tenant?.name ?? '',
      order_number: order ? String(order.id) : '',
      order_total: order
        ? Money.format(order.totalAmount, currency)
        : '',
      download_url: '',
      unsubscribe_url: unsubscribeUrl,
    },
  );

  // Footer fallback + RFC 8058 one-click headers for the marketing-class send.
  const { html: finalHtml, headers } = applyUnsubscribe(html, unsubscribeToken, unsubscribeUrl);

  const result = await messageSender.send({
    tenantId: getTenantId(),
    channel: MessageChannel.email,
    to,
    subject,
    body: finalHtml,
    headers,
    sendAs: 'platform',
    templateName,
    orderId: order?.id,
    customerId: customer?.id,
    metadata: { subject },
  });
  if (result.sent) return { sent: true, messageLogId: result.messageLogId };
  if (result.skipped) return { sent: false, skipped: true, messageLogId: result.messageLogId, reason: result.error };
  logger.error('send_email failed', { orderId: order?.id, to: maskEmail(to), error: result.error });
  return { sent: false, messageLogId: result.messageLogId, reason: 'send_failed' };
}
