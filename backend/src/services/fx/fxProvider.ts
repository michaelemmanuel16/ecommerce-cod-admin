/**
 * FX rate provider adapter (M1-T30). One fetch method, so the provider can change without touching the service.
 *
 * Current provider: ExchangeRate-API Open Access, https://open.er-api.com/v6/latest/<BASE>
 * (docs https://www.exchangerate-api.com/docs/free). Checked 2026-10-20: no key, one update every 24 hours,
 * lists GHS and NGN, caching allowed, re-distribution not allowed, attribution required (the Settings tab links
 * to the provider), rate limited (one request a day is always safe; the job asks once per base per run).
 */
export interface FxProvider {
  readonly name: string;
  /** Rates of 1 unit of `base`: { NGN: 112.4, USD: 0.08, ... }. Throws when the provider cannot answer. */
  fetchRates(base: string): Promise<Record<string, number>>;
}

export const FX_PROVIDER_ATTRIBUTION = { name: 'ExchangeRate-API', url: 'https://www.exchangerate-api.com' } as const;

class ExchangeRateApiProvider implements FxProvider {
  readonly name = FX_PROVIDER_ATTRIBUTION.name;

  async fetchRates(base: string): Promise<Record<string, number>> {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`FX provider answered HTTP ${res.status}`);
    const body = (await res.json()) as { result?: string; rates?: Record<string, number>; 'error-type'?: string };
    if (body.result !== 'success' || !body.rates) throw new Error(`FX provider error: ${body['error-type'] ?? 'no rates in the answer'}`);
    return body.rates;
  }
}

let provider: FxProvider = new ExchangeRateApiProvider();

export function getFxProvider(): FxProvider {
  return provider;
}

/** Swap the provider (tests use a fake; no network in tests). */
export function setFxProvider(next: FxProvider): void {
  provider = next;
}
