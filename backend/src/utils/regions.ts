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
