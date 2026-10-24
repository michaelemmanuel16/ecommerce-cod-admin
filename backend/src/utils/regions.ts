import { State } from 'country-state-city';

const regionsByCountry = new Map<string, string[]>();

/**
 * Regions (states) of a country by ISO2 code, from the `country-state-city` data.
 * Mirrors `getRegionsForCountry` in frontend/src/utils/countries.ts (which takes the country name).
 * Both sides must pin the same library version; each side has a test that pins the GH and NG counts.
 */
export function getRegionsForCountry(countryCode: string): string[] {
  const code = countryCode.toUpperCase();
  let regions = regionsByCountry.get(code);
  if (!regions) {
    regions = State.getStatesOfCountry(code).map((state) => state.name);
    regionsByCountry.set(code, regions);
  }
  return regions;
}

/**
 * Display grouping for a delivery state (COD-139): trimmed, with a trailing bracket dropped, so "Greater Accra (Tema)"
 * counts as "Greater Accra". Reports and the Customers list use it; stored data is not changed.
 * The frontend keeps a copy in frontend/src/utils/baseState.ts.
 */
export const baseState = (state: string | null | undefined): string => (state ?? '').replace(/\s*\(.*\)\s*$/, '').trim();

/** The report row a state falls in: its baseState, or "Not set" when blank. */
export const stateLabel = (state: string | null | undefined): string => baseState(state) || 'Not set';

/** Comparison key of a region name: lower case, the word "region" and any bracket suffix dropped, letters only. */
const regionKey = (s: string): string => baseState(s).toLowerCase().replace(/\bregion\b/g, '').replace(/[^a-z]/g, '');
/** The same key with a trailing word "state" dropped ("Lagos State"), used only when it leaves a known region. */
const stateStrippedKey = (s: string): string => baseState(s).toLowerCase().replace(/\bregion\b/g, '').replace(/\s+state\s*$/, '').replace(/[^a-z]/g, '');

/**
 * The region of the store's country that `value` names, or null (O3, M4-T19). Exact after cleaning, never a guess:
 * "Greater Accra Region", "greater accra" and "Greater Accra (Tema)" are "Greater Accra"; "Accra Central" is null.
 */
export function matchStoreRegion(value: string | null | undefined, regions: string[]): string | null {
  const key = regionKey(value ?? '');
  if (!key) return null;
  return regions.find((r) => regionKey(r) === key) ?? regions.find((r) => regionKey(r) === stateStrippedKey(value ?? '')) ?? null;
}
