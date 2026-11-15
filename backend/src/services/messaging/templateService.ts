import { MessageChannel, MessageTemplate, Prisma } from '@prisma/client';
import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { AppError } from '../../middleware/errorHandler';
import { sanitizeEmailHtml } from '../emailTemplateService';
import { getDbWhatsappConfig, WHATSAPP_API_URL } from './providers/whatsappCloudProvider';

/** The one templates service: SMS, WhatsApp and email templates in one list (M9-T09). */

export const AUTO_CONFIRM_KEY = 'auto_confirm';
/** The WhatsApp template the auto-confirm message uses until the tenant changes the row. Approved on Meta already. */
export const AUTO_CONFIRM_DEFAULT = {
  name: 'Order auto-confirm',
  metaTemplateName: 'order_auto_confirm',
  language: 'en_US',
  category: 'UTILITY',
  body: 'Hello {{1}},\n\nThank you for your order.\n\n*Package:* {{2}}\n*Order number:* #{{3}}\n*Pay on delivery:* {{4}}\n\nPlease confirm your order so we can send it out for delivery.',
  quickReplies: ['Yes, confirm', 'Change my order', 'Cancel my order'],
};

/** The status of a WhatsApp template that can be sent. Anything else (pending, rejected, paused, unknown) cannot. */
const SENDABLE = 'APPROVED';

export const statusOf = (t: Pick<MessageTemplate, 'metaStatus'>): string | null => t.metaStatus?.toLowerCase() ?? null;

/** A WhatsApp template can be picked for a send only when Meta approved it. Other channels have no approval. */
export function isSendable(t: Pick<MessageTemplate, 'channel' | 'metaStatus'>): boolean {
  return t.channel !== MessageChannel.whatsapp || t.metaStatus === SENDABLE;
}

/** 409 for a template that cannot be sent. */
export function assertSendable(t: Pick<MessageTemplate, 'name' | 'channel' | 'metaStatus'>): void {
  if (!isSendable(t)) {
    throw new AppError(`The template "${t.name}" is ${statusOf(t) ?? 'not approved'} on WhatsApp and cannot be sent`, 409, 'TEMPLATE_NOT_APPROVED');
  }
}

/** The `{{1}}` / `{{name}}` placeholders of a body, in order, no repeats. */
export function placeholders(body: string): string[] {
  return Array.from(new Set(Array.from(body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g), (m) => m[1])));
}

/** `base`, else `base (2)`, `base (3)` ... the first name no template of this tenant and channel has. */
export function freeName(taken: Iterable<string>, base: string): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!set.has(candidate)) return candidate;
  }
}

async function takenNames(tenantId: string, channel: MessageChannel): Promise<string[]> {
  const rows = await prisma.messageTemplate.findMany({ where: { tenantId, channel }, select: { name: true } });
  return rows.map((r) => r.name);
}

export const toApi = (t: MessageTemplate) => ({
  id: t.id,
  channel: t.channel,
  name: t.name,
  key: t.purpose,
  subject: t.subject,
  body: t.body,
  variables: t.variables,
  language: t.language,
  category: t.category,
  status: statusOf(t),
  rejectReason: t.metaRejectReason,
  metaTemplateName: t.metaTemplateName,
  components: t.components,
  quickReplies: t.quickReplies,
  sendable: isSendable(t),
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export interface ListFilter { channel?: MessageChannel; status?: string; q?: string }

export async function listTemplates(tenantId: string, filter: ListFilter = {}) {
  const where: Prisma.MessageTemplateWhereInput = { tenantId };
  if (filter.channel) where.channel = filter.channel;
  if (filter.status) where.metaStatus = filter.status.toUpperCase();
  if (filter.q) where.name = { contains: filter.q, mode: 'insensitive' };
  const rows = await prisma.messageTemplate.findMany({ where, orderBy: [{ channel: 'asc' }, { name: 'asc' }] });
  return rows.map(toApi);
}

export async function getTemplate(tenantId: string, id: number): Promise<MessageTemplate> {
  const row = await prisma.messageTemplate.findFirst({ where: { id, tenantId } });
  if (!row) throw new AppError('Template not found', 404, 'TEMPLATE_NOT_FOUND');
  return row;
}

/** The template of a tenant that code finds by key, for example the WhatsApp `auto_confirm`. */
export async function findByKey(tenantId: string, channel: MessageChannel, key: string): Promise<MessageTemplate | null> {
  return prisma.messageTemplate.findFirst({ where: { tenantId, channel, purpose: key }, orderBy: { id: 'asc' } });
}

/** The auto-confirm template. A tenant that has none yet gets the current one (the text that was hard coded). */
export async function getAutoConfirmTemplate(tenantId: string): Promise<MessageTemplate> {
  const found = await findByKey(tenantId, MessageChannel.whatsapp, AUTO_CONFIRM_KEY);
  if (found) return found;
  const d = AUTO_CONFIRM_DEFAULT;
  try {
    return await prisma.messageTemplate.create({
      data: {
        tenantId, channel: MessageChannel.whatsapp, name: freeName(await takenNames(tenantId, MessageChannel.whatsapp), d.name), purpose: AUTO_CONFIRM_KEY,
        body: d.body, variables: placeholders(d.body), language: d.language, category: d.category, quickReplies: d.quickReplies,
        metaTemplateName: d.metaTemplateName, metaStatus: SENDABLE,
      },
    });
  } catch (err: any) {
    if (err?.code !== 'P2002') throw err;
    return (await findByKey(tenantId, MessageChannel.whatsapp, AUTO_CONFIRM_KEY))
      ?? prisma.messageTemplate.findFirstOrThrow({ where: { tenantId, channel: MessageChannel.whatsapp, name: d.name } });
  }
}

export interface TemplateWrite {
  channel?: MessageChannel;
  name?: string;
  key?: string | null;
  subject?: string | null;
  body?: string;
  variables?: string[];
  language?: string;
  category?: string;
  status?: string;
  metaTemplateName?: string;
  components?: unknown[];
  quickReplies?: string[];
}

function columns(input: TemplateWrite, channel: MessageChannel) {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.key !== undefined) out.purpose = input.key;
  if (input.subject !== undefined) out.subject = input.subject;
  if (input.body !== undefined) {
    out.body = channel === MessageChannel.email ? sanitizeEmailHtml(input.body) : input.body;
    if (input.variables === undefined) out.variables = placeholders(input.body);
  }
  if (input.variables !== undefined) out.variables = input.variables;
  if (input.language !== undefined) out.language = input.language;
  if (input.category !== undefined) out.category = input.category;
  if (input.status !== undefined) out.metaStatus = input.status.toUpperCase();
  if (input.metaTemplateName !== undefined) out.metaTemplateName = input.metaTemplateName;
  if (input.components !== undefined) out.components = input.components;
  if (input.quickReplies !== undefined) out.quickReplies = input.quickReplies;
  return out;
}

const CLASH = new AppError('A template with this name already exists', 409, 'TEMPLATE_NAME_TAKEN');

export async function createTemplate(tenantId: string, input: TemplateWrite & { channel: MessageChannel; name: string; body: string }) {
  const data = columns(input, input.channel);
  if (input.channel === MessageChannel.whatsapp) {
    data.language ??= 'en_US';
    data.metaTemplateName ??= input.name;
    // A template written here is not approved until Meta says so (a sync reads it)
    data.metaStatus ??= 'PENDING';
  }
  try {
    return toApi(await prisma.messageTemplate.create({ data: { ...data, tenantId, channel: input.channel } as Prisma.MessageTemplateUncheckedCreateInput }));
  } catch (err: any) {
    if (err?.code === 'P2002') throw CLASH;
    throw err;
  }
}

export async function updateTemplate(tenantId: string, id: number, input: TemplateWrite) {
  const existing = await getTemplate(tenantId, id);
  if (input.subject !== undefined && existing.channel !== MessageChannel.email) throw new AppError('subject is for email templates only', 400);
  if (input.subject === null && existing.channel === MessageChannel.email) throw new AppError('An email template needs a subject', 400);
  const data = columns(input, existing.channel);
  if (existing.channel !== MessageChannel.whatsapp) {
    for (const f of ['language', 'category', 'metaStatus', 'metaTemplateName', 'components', 'quickReplies']) {
      if (f in data) throw new AppError(`${f} is for WhatsApp templates only`, 400);
    }
  }
  try {
    return toApi(await prisma.messageTemplate.update({ where: { id }, data: data as Prisma.MessageTemplateUncheckedUpdateInput }));
  } catch (err: any) {
    if (err?.code === 'P2002') throw CLASH;
    throw err;
  }
}

export async function deleteTemplate(tenantId: string, id: number): Promise<void> {
  await getTemplate(tenantId, id);
  await prisma.messageTemplate.delete({ where: { id } });
}

// ---- Sync from Meta ----

interface MetaTemplate {
  id?: string;
  name: string;
  language: string;
  category?: string;
  status?: string;
  components?: Array<{ type: string; text?: string; buttons?: Array<{ type: string; text: string }> }>;
  rejected_reason?: string;
}

const MAX_PAGES = 50;

async function fetchMetaTemplates(wabaId: string, token: string): Promise<MetaTemplate[]> {
  const all: MetaTemplate[] = [];
  let url: string | undefined = `${WHATSAPP_API_URL}/${wabaId}/message_templates?fields=name,language,category,status,components,rejected_reason&limit=100`;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err: any) {
      throw new AppError(`Could not reach Meta: ${err?.message ?? 'network error'}`, 400, 'META_SYNC_FAILED');
    }
    const payload: any = await response.json().catch(() => null);
    if (!response.ok || payload?.error) {
      // Meta's own text goes back to the screen
      const text = payload?.error?.error_user_msg || payload?.error?.message || `Meta answered ${response.status}`;
      throw new AppError(String(text), 400, 'META_SYNC_FAILED');
    }
    all.push(...(payload?.data ?? []));
    url = payload?.paging?.next;
  }
  return all;
}

/** Pull the tenant's WhatsApp templates from Meta and upsert them by (tenant, Meta name, language). */
export async function syncWhatsappTemplates(tenantId: string): Promise<{ created: number; updated: number; total: number }> {
  const config = await getDbWhatsappConfig();
  const token = config?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN;
  const wabaId = config?.wabaId || config?.businessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token || !wabaId) throw new AppError('WhatsApp is not set up. Connect WhatsApp with its business account first.', 400, 'WHATSAPP_NOT_SET_UP');
  if (!/^\d+$/.test(String(wabaId))) throw new AppError('The WhatsApp business account id is not valid', 400, 'WHATSAPP_NOT_SET_UP');

  const remote = await fetchMetaTemplates(String(wabaId), String(token));
  const taken = new Set(await takenNames(tenantId, MessageChannel.whatsapp));
  let created = 0;
  let updated = 0;

  for (const t of remote) {
    if (!t?.name || !t?.language) continue;
    const body = t.components?.find((c) => c.type === 'BODY')?.text ?? '';
    const quickReplies = (t.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []).filter((b) => b.type === 'QUICK_REPLY').map((b) => b.text);
    const fields = {
      body,
      variables: placeholders(body),
      category: t.category ?? null,
      metaStatus: (t.status ?? 'PENDING').toUpperCase(),
      metaRejectReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
      components: (t.components ?? []) as unknown as Prisma.InputJsonValue,
      quickReplies: quickReplies as unknown as Prisma.InputJsonValue,
    };
    const existing = await prisma.messageTemplate.findFirst({ where: { tenantId, channel: MessageChannel.whatsapp, metaTemplateName: t.name, language: t.language } });
    if (existing) {
      await prisma.messageTemplate.update({ where: { id: existing.id }, data: fields });
      updated++;
      continue;
    }
    // Same Meta name in another language: the name shows the language so both rows keep a unique name
    const name = freeName(taken, taken.has(t.name) ? `${t.name} (${t.language})` : t.name);
    taken.add(name);
    await prisma.messageTemplate.create({
      data: { ...fields, tenantId, channel: MessageChannel.whatsapp, name, language: t.language, metaTemplateName: t.name },
    });
    created++;
  }
  logger.info('WhatsApp templates synced', { tenantId, created, updated, total: remote.length });
  return { created, updated, total: remote.length };
}

/**
 * The gate every WhatsApp template send passes: a template this tenant has stored under that Meta name and language
 * must be approved. A name nothing stored (a built-in one that was never synced) is left to Meta.
 */
export async function assertTemplateNameSendable(tenantId: string, metaName: string, language: string | undefined): Promise<void> {
  const row = await prisma.messageTemplate.findFirst({
    where: { tenantId, channel: MessageChannel.whatsapp, metaTemplateName: metaName, ...(language ? { language } : {}) },
    orderBy: { id: 'asc' },
  });
  if (row) assertSendable(row);
}
