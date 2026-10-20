import * as Money from '../../utils/money';

/** Median of a list of numbers (M1-T21, T22). Even count: mean of the two middle values. Empty list: null. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** median(), rounded half up to dp decimals. Null for an empty list. */
export function medianRounded(values: number[], dp: number): number | null {
  const med = median(values);
  return med === null ? null : Money.roundHalfUp(med, dp).toNumber();
}
