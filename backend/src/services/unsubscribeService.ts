import crypto from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { getBackendUrl } from '../utils/url';
import { appendUnsubscribeFooter } from './emailTemplateService';

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
 * Look up a customer by unsubscribe token. Unscoped on purpose — the token is
 * globally unique + random, and the public routes carry no tenant context.
 * Returns null for an unknown/forged/empty token.
 */
export async function findCustomerByUnsubscribeToken(
  token: string,
): Promise<{ id: number; emailOptOut: boolean } | null> {
  if (!token) return null;
  return prisma.customer.findUnique({
    where: { unsubscribeToken: token },
    select: { id: true, emailOptOut: true },
  });
}

/**
 * Perform the opt-out for a token. Idempotent — re-running on an already
 * opted-out customer is a no-op. Returns true if the token resolved to a
 * customer, false if the token is unknown/forged. Only the POST route calls
 * this; GET never mutates.
 */
export async function optOutByUnsubscribeToken(token: string): Promise<boolean> {
  const customer = await findCustomerByUnsubscribeToken(token);
  if (!customer) return false;
  if (!customer.emailOptOut) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { emailOptOut: true },
    });
    logger.info('Customer unsubscribed from email', { customerId: customer.id });
  }
  return true;
}
