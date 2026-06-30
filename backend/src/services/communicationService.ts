import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel, MessageStatus, EmailCampaignStatus } from '@prisma/client';
import whatsappService, { ORDER_STATUS_TEMPLATES } from './whatsappService';
import { smsService } from './smsService';
import { sanitizeEmailHtml } from './emailTemplateService';
import { getTenantId } from '../utils/tenantContext';
import { enqueueCampaignRecipient, PLACEHOLDER_EMAIL_DOMAIN } from '../queues/emailCampaignQueue';

interface AudienceFilter {
  state?: string;
  productId?: number;
  hasOrdered?: boolean;
}

// The customers a bulk send targets, before email eligibility. An explicit
// customerIds selection and the filter fields compose (AND).
function buildAudienceWhere(params: { customerIds?: number[]; filter?: AudienceFilter }): any {
  const where: any = { isActive: true };
  if (params.customerIds && params.customerIds.length > 0) where.id = { in: params.customerIds };
  const f = params.filter;
  if (f?.state) where.state = f.state;
  if (f?.hasOrdered) where.totalOrders = { gt: 0 };
  if (f?.productId) {
    where.orders = { some: { orderItems: { some: { productId: f.productId } } } };
  }
  return where;
}

// The single definition of "email-eligible": a real address, not opted out, and
// not a synthesized Paystack placeholder (MAN-82 — never a marketing recipient).
// Shared by the recipient preview and the bulk-send enqueue so the rule lives once.
const EMAIL_ELIGIBLE = {
  email: { not: null },
  emailOptOut: false,
  NOT: { email: { endsWith: PLACEHOLDER_EMAIL_DOMAIN } },
} as const;

// The three eligibility denominators for an audience: total active, no-address,
// and opted-out (real address but unsubscribed or a synthesized placeholder).
// Shared by the pre-send banner (getEmailAudience) and the campaign snapshot
// (bulkSendEmail) so "X of Y can be emailed" counts the same way in both. The
// remainder (audienceTotal − noEmail − optedOut) is the emailable set, exactly
// the EMAIL_ELIGIBLE partition.
async function audienceDenominators(base: any) {
  const placeholder = { email: { endsWith: PLACEHOLDER_EMAIL_DOMAIN } };
  const [audienceTotal, noEmailCount, optedOutCount] = await Promise.all([
    prisma.customer.count({ where: base }),
    prisma.customer.count({ where: { ...base, email: null } }),
    prisma.customer.count({
      where: { ...base, email: { not: null }, OR: [{ emailOptOut: true }, placeholder] },
    }),
  ]);
  return { audienceTotal, noEmailCount, optedOutCount };
}

// Salesgee-style history breakdown: stored send-time denominators (audience →
// no-email → opted-out → emailable) plus live MessageLog status aggregation.
// `sent` counts anything that left the system (sent/delivered/read); `delivered`
// is the post-send subset. A no-address/opt-out recipient is a neutral skip,
// never a red Failed (D-CRIT).
function campaignStats(
  campaign: { audienceTotal: number; noEmailCount: number; optedOutCount: number; totalRecipients: number },
  counts: Partial<Record<MessageStatus, number>>,
) {
  const sent = (counts.sent ?? 0) + (counts.delivered ?? 0) + (counts.read ?? 0);
  const delivered = (counts.delivered ?? 0) + (counts.read ?? 0);
  return {
    audienceTotal: campaign.audienceTotal,
    noEmail: campaign.noEmailCount,
    optedOut: campaign.optedOutCount,
    emailable: campaign.totalRecipients,
    waiting: counts.pending ?? 0,
    sent,
    delivered,
    failed: counts.failed ?? 0,
    skipped: counts.skipped ?? 0,
  };
}

export const communicationService = {
  async getMessages(params: {
    page?: number;
    limit?: number;
    channel?: MessageChannel;
    status?: MessageStatus;
    orderId?: number;
    customerId?: number;
    startDate?: string;
    endDate?: string;
  }) {
    return whatsappService.getMessages(params);
  },

  async getStats(startDate?: string, endDate?: string) {
    return whatsappService.getStats(startDate, endDate);
  },

  async getRecipients(filters: {
    state?: string;
    productId?: number;
    hasOrdered?: boolean;
    channel: 'sms' | 'whatsapp' | 'email';
  }) {
    const where: any = buildAudienceWhere({
      filter: { state: filters.state, productId: filters.productId, hasOrdered: filters.hasOrdered },
    });
    if (filters.channel === 'sms') where.smsOptOut = false;
    if (filters.channel === 'whatsapp') where.whatsappOptOut = false;
    if (filters.channel === 'email') Object.assign(where, EMAIL_ELIGIBLE);

    // Preview listing only — capped. The bulk send enqueues via cursor pagination
    // (bulkSendEmail) and is not bounded by this cap.
    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
        email: true,
        state: true,
        area: true,
        smsOptOut: true,
        whatsappOptOut: true,
        emailOptOut: true,
      },
      orderBy: { firstName: 'asc' },
      take: 1000,
    });
    return customers;
  },

  // Counts-only audience summary for the pre-send eligibility banner (D-CRIT).
  // getRecipients caps at 1000 and only returns the emailable list, so it can't
  // surface the no-address / opted-out breakdown — this can. Filter is the same
  // shape as a campaign's audience.
  async getEmailAudience(filter: { state?: string; productId?: number; hasOrdered?: boolean }) {
    const base = buildAudienceWhere({ filter });
    const { audienceTotal, noEmailCount, optedOutCount } = await audienceDenominators(base);
    return {
      audienceTotal,
      noEmail: noEmailCount,
      optedOut: optedOutCount,
      emailable: audienceTotal - noEmailCount - optedOutCount,
    };
  },

  async bulkSendSms(customerIds: number[], message: string) {
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, smsOptOut: false, isActive: true },
      select: { id: true, phoneNumber: true },
    });

    const results = [];
    for (const customer of customers) {
      try {
        const result = await smsService.sendSms({
          to: customer.phoneNumber,
          body: message,
          customerId: customer.id,
        });
        results.push({ customerId: customer.id, success: true, messageLogId: result.messageLogId });
      } catch (error: any) {
        results.push({ customerId: customer.id, success: false, error: error.message });
      }
    }

    logger.info('Bulk SMS completed', {
      total: customers.length,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });
    return { total: customers.length, results };
  },

  async bulkSendWhatsApp(customerIds: number[], templateKey: string, customLink?: string) {
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, whatsappOptOut: false, isActive: true },
      select: { id: true, firstName: true, lastName: true, phoneNumber: true },
    });

    const templateConfig = ORDER_STATUS_TEMPLATES[templateKey];
    if (!templateConfig) {
      throw new Error(`Unknown WhatsApp template: ${templateKey}`);
    }

    const results = [];
    for (const customer of customers) {
      try {
        const bodyParams = [
          `${customer.firstName} ${customer.lastName}`.trim(),
          'your order',
        ];
        if (customLink) bodyParams.push(customLink);

        const result = await whatsappService.sendTemplate({
          to: customer.phoneNumber,
          templateName: templateConfig.templateName,
          bodyParams,
          customerId: customer.id,
        });
        results.push({ customerId: customer.id, success: true, messageLogId: result.messageLogId });
      } catch (error: any) {
        results.push({ customerId: customer.id, success: false, error: error.message });
      }
    }

    logger.info('Bulk WhatsApp completed', {
      total: customers.length,
      sent: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });
    return { total: customers.length, results };
  },

  // ---- Bulk email campaigns (queued; tenant BYO provider) ----

  // Compose → audience → send. Snapshots the resolved, sanitized subject/body and
  // the eligibility denominators onto a new EmailCampaign, then enqueues ONE job
  // per eligible recipient (cursor-paginated, no silent cap — real max audience =
  // all eligible). Sends only on this explicit call; saving a template never sends.
  async bulkSendEmail(params: {
    customerIds?: number[];
    filter?: AudienceFilter;
    title: string;
    subject?: string;
    htmlBody?: string;
    templateId?: number;
  }) {
    const tenantId = getTenantId();
    // Store name is constant for the whole campaign — resolve it once and thread
    // it through the job data so the worker doesn't re-fetch the tenant per recipient.
    const tenant = tenantId
      ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } })
      : null;
    const storeName = tenant?.name ?? '';

    // Content snapshot: a saved template (already sanitized on save) or inline
    // subject/body (sanitize the body here).
    let subject: string;
    let body: string;
    if (params.templateId) {
      const tpl = await prisma.emailTemplate.findUnique({ where: { id: params.templateId } });
      if (!tpl) throw new Error('Email template not found');
      subject = tpl.subject;
      body = tpl.body;
    } else {
      if (!params.subject || !params.htmlBody) {
        throw new Error('subject and htmlBody are required when no templateId is given');
      }
      subject = params.subject;
      body = sanitizeEmailHtml(params.htmlBody);
    }

    const base = buildAudienceWhere(params);

    // Denominators for the eligibility breakdown (D-CRIT), snapshotted at send time.
    const { audienceTotal, noEmailCount, optedOutCount } = await audienceDenominators(base);

    const campaign = await prisma.emailCampaign.create({
      data: { title: params.title, subject, body, status: EmailCampaignStatus.queued, audienceTotal, noEmailCount, optedOutCount, totalRecipients: 0 },
    });

    // Enqueue eligible recipients via cursor pagination so a large audience never
    // loads in one query or blocks the request.
    const eligibleWhere = { ...base, ...EMAIL_ELIGIBLE };
    const PAGE = 500;
    let enqueued = 0;
    let cursor: number | undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.customer.findMany({
        where: eligibleWhere,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      await Promise.all(
        batch.map((c) =>
          enqueueCampaignRecipient({ campaignId: campaign.id, customerId: c.id, tenantId, storeName }),
        ),
      );
      enqueued += batch.length;
      cursor = batch[batch.length - 1].id;
      if (batch.length < PAGE) break;
    }

    const updated = await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: {
        totalRecipients: enqueued,
        status: enqueued > 0 ? EmailCampaignStatus.sending : EmailCampaignStatus.completed,
      },
    });

    logger.info('Bulk email campaign queued', { campaignId: campaign.id, audienceTotal, enqueued });
    return updated;
  },

  async getCampaigns() {
    const campaigns = await prisma.emailCampaign.findMany({ orderBy: { createdAt: 'desc' } });
    if (campaigns.length === 0) return [];

    const grouped = await prisma.messageLog.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: campaigns.map((c) => c.id) } },
      _count: { _all: true },
    });
    const byCampaign: Record<number, Partial<Record<MessageStatus, number>>> = {};
    for (const g of grouped) {
      if (g.campaignId == null) continue;
      (byCampaign[g.campaignId] ||= {})[g.status] = g._count._all;
    }
    return campaigns.map((c) => ({ ...c, stats: campaignStats(c, byCampaign[c.id] || {}) }));
  },

  async getCampaign(id: number) {
    const campaign = await prisma.emailCampaign.findUnique({ where: { id } });
    if (!campaign) return null;
    const grouped = await prisma.messageLog.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const counts: Partial<Record<MessageStatus, number>> = {};
    for (const g of grouped) counts[g.status] = g._count._all;
    return { ...campaign, stats: campaignStats(campaign, counts) };
  },

  async getTemplates() {
    return prisma.smsTemplate.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async createTemplate(data: { name: string; body: string }) {
    return prisma.smsTemplate.create({ data });
  },

  async updateTemplate(id: number, data: { name?: string; body?: string }) {
    return prisma.smsTemplate.update({ where: { id }, data });
  },

  async deleteTemplate(id: number) {
    return prisma.smsTemplate.delete({ where: { id } });
  },

  // ---- Email templates (tenant-scoped; body sanitized on save) ----
  async getEmailTemplates() {
    return prisma.emailTemplate.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async createEmailTemplate(data: { name: string; subject: string; body: string }) {
    return prisma.emailTemplate.create({
      data: { name: data.name, subject: data.subject, body: sanitizeEmailHtml(data.body) },
    });
  },

  async updateEmailTemplate(id: number, data: { name?: string; subject?: string; body?: string }) {
    return prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.subject !== undefined ? { subject: data.subject } : {}),
        ...(data.body !== undefined ? { body: sanitizeEmailHtml(data.body) } : {}),
      },
    });
  },

  async deleteEmailTemplate(id: number) {
    return prisma.emailTemplate.delete({ where: { id } });
  },

  async getOptOutCustomers(page = 1, limit = 20) {
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where: { OR: [{ smsOptOut: true }, { whatsappOptOut: true }] },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
          smsOptOut: true,
          whatsappOptOut: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { firstName: 'asc' },
      }),
      prisma.customer.count({
        where: { OR: [{ smsOptOut: true }, { whatsappOptOut: true }] },
      }),
    ]);
    return {
      customers,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  },

  async updateCustomerOptOut(
    customerId: number,
    data: { smsOptOut?: boolean; whatsappOptOut?: boolean },
  ) {
    return prisma.customer.update({ where: { id: customerId }, data });
  },
};
