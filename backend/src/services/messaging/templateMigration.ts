import { MessageChannel } from '@prisma/client';
import { prismaBase } from '../../utils/prisma';
import { freeName, placeholders } from './templateService';

/**
 * M9-T09 data move: the old SMS templates, the old email templates and the `notificationTemplates` text of the tenant
 * settings become MessageTemplate rows. Idempotent: a row that already moved is found by (tenant, legacySource, legacyId)
 * and left alone, so a second run changes nothing. Nothing is deleted from the old places.
 *
 * Runs once after `prisma migrate deploy`: `npm run migrate:templates` (backend/scripts/migrate-templates.ts).
 */

/** The four notification texts of the old settings screen, and the key each gets. */
export const NOTIFICATION_KEYS: Record<string, { key: string; label: string }> = {
  orderConfirmation: { key: 'order_confirmation', label: 'Order confirmation' },
  outForDelivery: { key: 'out_for_delivery', label: 'Out for delivery' },
  delivered: { key: 'delivered', label: 'Delivered' },
  paymentReminder: { key: 'payment_reminder', label: 'Payment reminder' },
};

export interface MigrationResult {
  sms: number;
  email: number;
  notification: number;
  /** Legacy email templates with no tenant: they belong to nobody, so they stay where they are. */
  skippedNoTenant: number;
}

export async function migrateLegacyTemplates(): Promise<MigrationResult> {
  const db = prismaBase;
  const result: MigrationResult = { sms: 0, email: 0, notification: 0, skippedNoTenant: 0 };
  const names = new Map<string, Set<string>>();
  const namesOf = async (tenantId: string, channel: MessageChannel) => {
    const k = `${tenantId}|${channel}`;
    if (!names.has(k)) {
      names.set(k, new Set((await db.messageTemplate.findMany({ where: { tenantId, channel }, select: { name: true } })).map((r) => r.name)));
    }
    return names.get(k)!;
  };
  const take = async (tenantId: string, channel: MessageChannel, base: string) => {
    const set = await namesOf(tenantId, channel);
    const name = freeName(set, base);
    set.add(name);
    return name;
  };

  for (const row of await db.smsTemplate.findMany({ orderBy: { id: 'asc' } })) {
    const done = await db.messageTemplate.findFirst({ where: { tenantId: row.tenantId, legacySource: 'sms_templates', legacyId: row.id }, select: { id: true } });
    if (done) continue;
    await db.messageTemplate.create({
      data: {
        tenantId: row.tenantId, channel: MessageChannel.sms, name: await take(row.tenantId, MessageChannel.sms, row.name),
        body: row.body, variables: placeholders(row.body), legacySource: 'sms_templates', legacyId: row.id,
      },
    });
    result.sms++;
  }

  for (const row of await db.emailTemplate.findMany({ orderBy: { id: 'asc' } })) {
    if (!row.tenantId) { result.skippedNoTenant++; continue; }
    const done = await db.messageTemplate.findFirst({ where: { tenantId: row.tenantId, legacySource: 'email_templates', legacyId: row.id }, select: { id: true } });
    if (done) continue;
    await db.messageTemplate.create({
      data: {
        tenantId: row.tenantId, channel: MessageChannel.email, name: await take(row.tenantId, MessageChannel.email, row.name),
        subject: row.subject, body: row.body, variables: placeholders(`${row.subject} ${row.body}`), legacySource: 'email_templates', legacyId: row.id,
      },
    });
    result.email++;
  }

  const configs = await db.systemConfig.findMany({ where: { tenantId: { not: null }, NOT: { notificationTemplates: { equals: null as any } } }, select: { tenantId: true, notificationTemplates: true } });
  for (const config of configs) {
    const tenantId = config.tenantId!;
    const json = (config.notificationTemplates ?? {}) as Record<string, { sms?: string; email?: string } | undefined>;
    for (const [field, { key, label }] of Object.entries(NOTIFICATION_KEYS)) {
      for (const channel of [MessageChannel.sms, MessageChannel.email] as const) {
        const text = json[field]?.[channel]?.trim();
        if (!text) continue;
        const done = await db.messageTemplate.findFirst({ where: { tenantId, channel, purpose: key, legacySource: 'notification_templates' }, select: { id: true } });
        if (done) continue;
        await db.messageTemplate.create({
          data: {
            tenantId, channel, name: await take(tenantId, channel, label), purpose: key,
            subject: channel === MessageChannel.email ? label : null, body: text, variables: placeholders(text), legacySource: 'notification_templates',
          },
        });
        result.notification++;
      }
    }
  }
  return result;
}
