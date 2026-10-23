import prisma from '../utils/prisma';
import { getRegionsForCountry, matchStoreRegion } from '../utils/regions';
import { resolveTenantId } from '../utils/tenantContext';
import { countryCodeOfTenant } from './locationService';
import { DIGITAL } from './kpi/rates';

/**
 * Region normalisation (decision O3, M4-T19). An order's region is a value of the store country's region list.
 * "Greater Accra Region" is stored as "Greater Accra". A value that names no region is kept as typed and shows in the
 * review list (`unmappedRegions`); it is not guessed. The review list is a query over orders: it needs no table.
 */

async function storeRegions(tenantId?: string | null): Promise<string[]> {
  return getRegionsForCountry(await countryCodeOfTenant(resolveTenantId(tenantId)));
}

/** The store region `value` names, or the trimmed value itself when it names none (or the store has no region list). */
export async function normalizeOrderRegion<T extends string | null | undefined>(value: T, tenantId?: string | null): Promise<T | string> {
  if (typeof value !== 'string') return value;
  const regions = await storeRegions(tenantId);
  return matchStoreRegion(value, regions) ?? value.trim();
}

export interface UnmappedRegion {
  /** The value as stored on the orders. Empty text reads as "(blank)". */
  value: string;
  orders: number;
  /** The region it would map to, when it names one exactly (an old order saved before normalisation); null otherwise. */
  suggestion: string | null;
}

/** Distinct order regions that are not in the store's list, with how many orders carry each. Most orders first. */
export async function unmappedRegions(): Promise<UnmappedRegion[]> {
  const regions = await storeRegions();
  const groups = await prisma.order.groupBy({
    by: ['deliveryState'],
    where: { deletedAt: null, status: { notIn: DIGITAL }, OR: [{ deliveryState: null }, { deliveryState: { notIn: regions } }] },
    _count: { _all: true },
  });
  return groups
    .map((g) => ({
      value: g.deliveryState?.trim() || '(blank)',
      orders: g._count._all,
      suggestion: matchStoreRegion(g.deliveryState, regions),
    }))
    .sort((a, b) => b.orders - a.orders || a.value.localeCompare(b.value));
}
