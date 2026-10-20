import { Country } from 'country-state-city';
import prisma from './prisma';
import { getTenantId } from './tenantContext';

const TTL_MS = 60_000;
const cache = new Map<string, { code: string; at: number }>();

/** Drop cached currency codes (setStoreCurrency does it after a change). */
export function clearCurrencyCache(): void {
  cache.clear();
}

/**
 * Store currency of a tenant (Tenant.currency, M1-T31), GHS by default.
 * Cached for 60 seconds per tenant: it is read on every email and MCP tool call.
 */
export async function currencyOfTenant(tenantId: string | null | undefined): Promise<string> {
  const key = tenantId ?? '';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.code;
  try {
    const tenant = tenantId ? await prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }) : null;
    const code = tenant?.currency || 'GHS';
    cache.set(key, { code, at: Date.now() });
    return code;
  } catch {
    return 'GHS';
  }
}

/** Store currency of the current tenant. */
export function getCurrency(): Promise<string> {
  return currencyOfTenant(getTenantId());
}

/** The one writer of Tenant.currency: saves the code and drops the cached value. */
export async function setStoreCurrency(tenantId: string, code: string): Promise<void> {
  await prisma.tenant.update({ where: { id: tenantId }, data: { currency: code } });
  clearCurrencyCache();
}

/**
 * Currency of a country, from a name ('Ghana') or an ISO2 code ('GH'). Picking a country sets the store
 * currency (decision O6). Null when the country is not known.
 */
export function currencyForCountry(country: string): string | null {
  const key = country.trim().toLowerCase();
  if (!key) return null;
  const found = Country.getCountryByCode(key.toUpperCase()) ?? Country.getAllCountries().find((c) => c.name.toLowerCase() === key);
  return found?.currency || null;
}
