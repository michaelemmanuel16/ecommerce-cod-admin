import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { tenantStorage } from '../utils/tenantContext';
import { MessageChannel, MessageDirection, MessageStatus, EmailCampaignStatus } from '@prisma/client';
import { sendEmail } from '../services/emailService';
import { renderEmailTemplate } from '../services/emailTemplateService';
import {
  ensureUnsubscribeToken,
  buildUnsubscribeUrl,
  applyUnsubscribe,
} from '../services/unsubscribeService';

// A synthesized Paystack placeholder (`<phone>@codadminpro.com`) is never a real
// inbox; getRecipients already excludes it, but the worker re-checks so a stale
// enqueue can't bounce a fake address and hurt sender reputation (MAN-82 guard).
export const PLACEHOLDER_EMAIL_DOMAIN = '@codadminpro.com';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

// Dummy queue under test so jobs are inert (no Redis); send logic is unit-tested
// directly via processCampaignRecipient.
export const emailCampaignQueue = process.env.NODE_ENV === 'test'
  ? ({
    process: () => { },
    on: () => { },
    add: () => { },
    close: () => Promise.resolve(),
  } as any)
  : new Bull('email-campaign', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  });

export interface CampaignJobData {
  campaignId: number;
  customerId: number;
  tenantId: string | null;
  // Resolved once at enqueue time (constant per campaign) so the worker renders
  // {{store_name}} without a tenant lookup per recipient. Falls back to a lookup
  // if absent (e.g. a job enqueued before this field existed).
  storeName?: string;
}

export interface CampaignRecipientResult {
  sent: boolean;
  skipped?: boolean;
  messageLogId?: number;
  reason?: string;
}

/**
 * Enqueue one job per recipient. A deterministic jobId
 * (`campaign:<id>:cust:<id>`) makes Bull drop a duplicate enqueue for the same
 * recipient, the first layer of the idempotency guarantee (the DB partial-unique
 * index + the in-worker `already_sent` check are the others).
 */
export async function enqueueCampaignRecipient(data: CampaignJobData): Promise<void> {
  await emailCampaignQueue.add('send-campaign-email', data, {
    jobId: `campaign:${data.campaignId}:cust:${data.customerId}`,
  });
}

/**
 * Send one campaign email to one customer using the tenant's BYO email provider
 * (`as: 'tenant'`) — marketing class, so it carries the RFC 8058 unsubscribe
 * footer + headers. Idempotent: a prior `sent` MessageLog for this
 * (campaignId, customerId) short-circuits, so a BullMQ retry can't double-send;
 * a leftover `pending`/`failed` row is reused rather than duplicated. Never
 * throws on a provider failure — it records `failed` and returns so one bad
 * recipient can't fail the whole queue.
 */
export async function processCampaignRecipient(
  data: CampaignJobData,
): Promise<CampaignRecipientResult> {
  const run = async (): Promise<CampaignRecipientResult> => {
    const campaign = await prisma.emailCampaign.findUnique({ where: { id: data.campaignId } });
    if (!campaign) {
      logger.warn('campaign email skipped — campaign not found', { campaignId: data.campaignId });
      return { sent: false, skipped: true, reason: 'campaign_not_found' };
    }

    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) {
      return { sent: false, skipped: true, reason: 'customer_not_found' };
    }

    const to = customer.email;
    const ineligible =
      !to || customer.emailOptOut || to.endsWith(PLACEHOLDER_EMAIL_DOMAIN);
    if (ineligible) {
      const reason = !to
        ? 'no_recipient'
        : customer.emailOptOut
          ? 'opted_out'
          : 'placeholder_email';
      await prisma.messageLog.create({
        data: {
          customerId: customer.id,
          campaignId: campaign.id,
          channel: MessageChannel.email,
          direction: MessageDirection.outbound,
          templateName: `campaign:${campaign.id}`,
          messageBody: '',
          status: MessageStatus.skipped,
          metadata: { to, reason },
        },
      });
      return { sent: false, skipped: true, reason };
    }

    // Idempotency (H1): reuse any prior row for this (campaign, customer); a prior
    // `sent` wins, so a retry is a no-op.
    const existing = await prisma.messageLog.findFirst({
      where: { campaignId: campaign.id, customerId: customer.id, channel: MessageChannel.email },
      select: { id: true, status: true },
    });
    if (existing?.status === MessageStatus.sent) {
      return { sent: false, skipped: true, messageLogId: existing.id, reason: 'already_sent' };
    }

    // Marketing-class send → resolve unsubscribe token for merge tags. Store name
    // arrives in the job data; only fall back to a lookup if it wasn't threaded.
    const storeName = data.storeName
      ?? (data.tenantId
        ? (await prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { name: true } }))?.name ?? ''
        : '');
    const unsubscribeToken = await ensureUnsubscribeToken(customer);
    const unsubscribeUrl = buildUnsubscribeUrl(unsubscribeToken);

    const rendered = renderEmailTemplate(
      { subject: campaign.subject, body: campaign.body },
      {
        customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
        customer_email: to as string,
        store_name: storeName,
        unsubscribe_url: unsubscribeUrl,
      },
    );
    const { html: finalHtml, headers } = applyUnsubscribe(
      rendered.html,
      unsubscribeToken,
      unsubscribeUrl,
    );

    const log = existing
      ? await prisma.messageLog.update({
        where: { id: existing.id },
        data: { status: MessageStatus.pending, messageBody: finalHtml, errorMessage: null },
      })
      : await prisma.messageLog.create({
        data: {
          customerId: customer.id,
          campaignId: campaign.id,
          channel: MessageChannel.email,
          direction: MessageDirection.outbound,
          templateName: `campaign:${campaign.id}`,
          messageBody: finalHtml,
          status: MessageStatus.pending,
          metadata: { to, subject: rendered.subject },
        },
      });

    try {
      await sendEmail({ to: to as string, subject: rendered.subject, html: finalHtml, headers }, { as: 'tenant' });
      await prisma.messageLog.update({
        where: { id: log.id },
        data: { status: MessageStatus.sent, sentAt: new Date() },
      });
      await maybeCompleteCampaign(campaign.id);
      return { sent: true, messageLogId: log.id };
    } catch (error: any) {
      await prisma.messageLog.update({
        where: { id: log.id },
        data: { status: MessageStatus.failed, errorMessage: error.message?.substring(0, 500) },
      });
      logger.error('campaign email failed', { campaignId: campaign.id, customerId: customer.id, error: error.message });
      await maybeCompleteCampaign(campaign.id);
      return { sent: false, messageLogId: log.id, reason: 'send_failed' };
    }
  };

  return data.tenantId ? tenantStorage.run({ tenantId: data.tenantId }, run) : run();
}

// Flip the campaign to `completed` once no recipient row is still pending. Cheap
// count per job; setting completed more than once (last two jobs racing) is a
// harmless idempotent write.
async function maybeCompleteCampaign(campaignId: number): Promise<void> {
  const pending = await prisma.messageLog.count({
    where: { campaignId, status: MessageStatus.pending },
  });
  if (pending === 0) {
    await prisma.emailCampaign.update({
      where: { id: campaignId },
      data: { status: EmailCampaignStatus.completed },
    });
  }
}

if (process.env.NODE_ENV !== 'test') {
  emailCampaignQueue.process('send-campaign-email', async (job: Bull.Job) =>
    processCampaignRecipient(job.data),
  );

  emailCampaignQueue.on('failed', (job: Bull.Job | undefined, err: Error) => {
    logger.error('campaign email job failed', { jobId: job?.id, error: err.message });
  });
}

export default emailCampaignQueue;
