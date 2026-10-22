import { City, Country, State } from 'country-state-city';
import { currencyOfTenant } from '../utils/currency';
import { GH_TOWNS } from '../data/towns/GH';

// Countries where we keep our own town list; every other country uses country-state-city.
const OWN_TOWNS: Record<string, Record<string, string[]>> = { GH: GH_TOWNS };

const norm = (s: string): string => s.trim().toLowerCase();

/** Towns of one state, A-Z. Own list when we have one for the country, else the library's cities. */
export function getTowns(countryCode: string, stateName: string): string[] {
  const code = countryCode.toUpperCase();
  const own = OWN_TOWNS[code];
  if (own) {
    // Checkout stores some states as "Greater Accra (Tema)"; that is still Greater Accra.
    const key = Object.keys(own).find((k) => norm(k) === norm(stateName.replace(/\s*\(.*\)\s*$/, '')));
    return key ? own[key] : [];
  }
  const state = State.getStatesOfCountry(code).find((s) => norm(s.name) === norm(stateName));
  if (!state) return [];
  const names = City.getCitiesOfState(code, state.isoCode).map((c) => c.name);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** Towns for every state of a country, keyed by state name. Sent to the public checkout with the regions. */
export function getTownsByState(countryCode: string, stateNames: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of stateNames) out[s] = getTowns(countryCode, s);
  return out;
}

// Store country of a tenant. Tenant has no country column, so it comes from the store currency
// (same rule as the frontend's getCountryByCurrency). GHS is the default, as in currencyOfTenant.
const COUNTRY_CODES = ['GH', 'NG', 'KE', 'ZA', 'UG', 'TZ', 'RW', 'ET', 'ZM', 'ZW'];

export async function countryCodeOfTenant(tenantId: string | null | undefined): Promise<string> {
  const currency = await currencyOfTenant(tenantId);
  return COUNTRY_CODES.find((code) => Country.getCountryByCode(code)?.currency === currency) ?? 'GH';
}

/** Towns for the states a checkout form offers (`regions.available`), for its country name ('Ghana'). */
export function townsForForm(countryName: string | null | undefined, regions: unknown): Record<string, string[]> {
  const key = (countryName || 'Ghana').trim().toLowerCase();
  const code = Country.getAllCountries().find((c) => c.name.toLowerCase() === key || c.isoCode.toLowerCase() === key)?.isoCode ?? 'GH';
  const available = (regions as { available?: unknown } | null)?.available;
  const states = Array.isArray(available)
    ? available.filter((s): s is string => typeof s === 'string')
    : State.getStatesOfCountry(code).map((s) => s.name);
  return getTownsByState(code, states);
}
