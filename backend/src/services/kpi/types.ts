/**
 * KPI layer types (M1-T15, F-250). Every KPI function returns a KpiResult.
 * Money values are strings with 2 decimals ("92000.00", Money.toApi). Rates are percent numbers
 * rounded half up to 1 decimal (71.0), or null when the denominator is 0 (F-251: "n/a").
 */
type KpiUnit = 'money' | 'percent' | 'count' | 'days' | 'minutes';

/**
 * Which date an order is placed on the time line by.
 *  - deliveryDate: revenue (F-250)
 *  - createdAt:    orders placed (confirmation rate)
 *  - cohort:       orders placed in the range, outcome read today (F-251, F-1008)
 *  - delivery:     orders closed in the range (F-251, second basis)
 */
type KpiDateBasis = 'deliveryDate' | 'createdAt' | 'cohort' | 'delivery';

/** The range and compute time every KPI result carries (ISO instants). */
export interface KpiMeta {
  from: string;
  to: string;
  asOf: string;
}

/** `{ from, to, asOf }` of a KPI range, computed now, plus any fields of `extra` (which may also set `asOf`). */
export function kpiMeta<E extends object = Record<never, never>>(from: Date, to: Date, extra?: E): KpiMeta & E {
  return { from: from.toISOString(), to: to.toISOString(), asOf: new Date().toISOString(), ...extra } as KpiMeta & E;
}

export interface KpiResult<T> {
  name: string;
  value: T;
  unit: KpiUnit;
  dateBasis: KpiDateBasis;
  /** Stable id of the formula, bumped when the formula changes: 'revenue.delivered.v1'. */
  formulaId: string;
  /** Start of the range, inclusive (ISO instant). */
  from: string;
  /** End of the range, exclusive (ISO instant). */
  to: string;
  /** When the number was computed (ISO instant). */
  asOf: string;
  /** Store currency, on money results. */
  currency?: string;
  /** Numerator and denominator (or other inputs) behind the value, so a page can show "376 of 778". */
  detail?: Record<string, number>;
}
