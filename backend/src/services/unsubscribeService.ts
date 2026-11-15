import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { getBackendUrl } from '../utils/url';
import { runInTenantOf, withoutTenant } from '../utils/tenantContext';
import { appendUnsubscribeFooter } from './emailTemplateService';
import { OPT_OUT_FLAG, setOptOut } from './messaging/optOutService';
import { MessageChannel } from '@prisma/client';

/**
 * Email unsubscribe plumbing (MAN-81).
 *
 * The customer-facing unsubscribe link is built from a stored 32-byte random hex
 * token (Customer.unsubscribeToken — unguessable, not derived from the id; mirrors
 * DownloadToken's randomness). The token is globally unique, so the public routes
 * look customers up by it WITHOUT tenant context.
 *
 * Opt-out is a POST-only side effect (see unsubscribeRoutes): mail scanners and
 * link prefetchers auto-visit GET links, which would silently unsubscribe people.
 */

/** Build the public unsubscribe URL for a token. */
export function buildUnsubscribeUrl(token: string): string {
  return `${getBackendUrl()}/api/public/unsubscribe/${token}`;
}

/**
 * Apply marketing-class unsubscribe artifacts to a rendered email body (MAN-81).
 * Shared by the workflow send_email path and (Phase 2) bulk campaigns so neither
 * re-implements the footer-fallback + RFC 8058 header wiring.
 *
 * `token` is only used to detect whether the merchant already placed the link
 * (the hex token survives HTML-escaping, the full URL's slashes don't). An empty
 * url (no customer) leaves the body untouched and sets no headers.
 */
export function applyUnsubscribe(
  html: string,
  token: string,
  url: string,
): { html: string; headers?: Record<string, string> } {
  if (!url) return { html };
  return {
    html: html.includes(token) ? html : appendUnsubscribeFooter(html, url),
    headers: {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/**
 * Return the customer's unsubscribe token, minting + persisting a fresh random
 * one if absent. Called lazily before a marketing send so the link always
 * resolves to a real token.
 */
export async function ensureUnsubscribeToken(
  customer: { id: number; unsubscribeToken?: string | null },
): Promise<string> {
  if (customer.unsubscribeToken) return customer.unsubscribeToken;
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.customer.update({
    where: { id: customer.id },
    data: { unsubscribeToken: token },
  });
  return token;
}

/**
 * Look up a customer by unsubscribe token (withoutTenant). Unscoped on purpose — the token is
 * globally unique + random, and the public routes carry no tenant context.
 * Returns null for an unknown/forged/empty token.
 */
export async function findCustomerByUnsubscribeToken(
  token: string,
): Promise<{ id: number; emailOptOut: boolean; smsOptOut: boolean; whatsappOptOut: boolean; phoneNumber: string; email: string | null; tenantId: string | null } | null> {
  if (!token) return null;
  return withoutTenant('unsubscribe', () =>
    prisma.customer.findUnique({
      where: { unsubscribeToken: token },
      select: { id: true, emailOptOut: true, smsOptOut: true, whatsappOptOut: true, phoneNumber: true, email: true, tenantId: true },
    })
  );
}

/**
 * Perform the opt-out for a token: email always, and the channel the link names when it names one (M9-T10). Each change
 * is an OptOutEvent with reason `unsubscribe_link`. Idempotent: a channel already opted out is not written again.
 * Returns true if the token resolved to a customer, false if it is unknown/forged or the customer is gone.
 * Only the POST route calls this; GET never mutates.
 */
export async function optOutByUnsubscribeToken(token: string, extraChannel?: MessageChannel): Promise<boolean> {
  const customer = await findCustomerByUnsubscribeToken(token);
  if (!customer) return false;
  const channels = Array.from(new Set<MessageChannel>([MessageChannel.email, ...(extraChannel ? [extraChannel] : [])]));
  for (const channel of channels) {
    if (customer[OPT_OUT_FLAG[channel]]) continue;
    // The token gave us the tenant: the write itself is scoped to it. A legacy NULL-tenant customer must still be able to unsubscribe.
    if (!customer.tenantId) {
      await runInTenantOf(null, 'unsubscribe', () => prisma.customer.update({ where: { id: customer.id }, data: { [OPT_OUT_FLAG[channel]]: true } }));
      continue;
    }
    await runInTenantOf(customer.tenantId, 'unsubscribe', () => setOptOut({
      tenantId: customer.tenantId!, customerId: customer.id, phone: channel === MessageChannel.email ? null : customer.phoneNumber,
      email: channel === MessageChannel.email ? customer.email : null, channel, optedOut: true, reason: 'unsubscribe_link',
    }));
    logger.info('Customer unsubscribed', { customerId: customer.id, channel });
  }
  return true;
}

export interface StoreBrand {
  /** The store name, or null when the customer belongs to no store. */
  name: string | null;
  /** An https address, or null. */
  logo: string | null;
  /** A 6-digit hex colour (#RRGGBB). */
  color: string;
}

export const DEFAULT_BRAND_COLOR = '#111827';
const HEX = /^#([0-9a-f]{6})$/i;
const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/** `#abc` -> `#aabbcc`; anything that is not a hex colour -> null. Only these ever reach the page's style. */
export function cleanHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  const m = short.exec(t);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  return HEX.test(t) ? t.toLowerCase() : null;
}

/**
 * The look of the store for the public unsubscribe page: its name and logo, and the button colour of its latest active
 * checkout form (the colour its customers already know). A store with no form gets a neutral dark.
 */
export async function getStoreBrand(tenantId: string | null): Promise<StoreBrand> {
  if (!tenantId) return { name: null, logo: null, color: DEFAULT_BRAND_COLOR };
  const [tenant, form] = await runInTenantOf(tenantId, 'unsubscribe', () => Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, logo: true } }),
    prisma.checkoutForm.findFirst({ where: { tenantId, isActive: true, archivedAt: null }, orderBy: { updatedAt: 'desc' }, select: { styling: true } }),
  ]));
  const styling = (form?.styling ?? {}) as { buttonColor?: unknown; accentColor?: unknown };
  const logo = tenant?.logo && /^https:\/\//i.test(tenant.logo) ? tenant.logo : null;
  return { name: tenant?.name?.trim() || null, logo, color: cleanHex(styling.buttonColor) ?? cleanHex(styling.accentColor) ?? DEFAULT_BRAND_COLOR };
}
